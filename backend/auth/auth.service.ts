import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserEntity } from 'backend/user/entity/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Payload } from './interface/payload-interface';
import { ErrorCode } from 'backend/common/error-code';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  parseBasicToken(rawToken: string) {
    const basicToken = rawToken.split(' ');

    if (basicToken.length !== 2) {
      throw new BadRequestException({
        code: ErrorCode.AUTH_BAD_TOKEN_FORMAT,
        message: 'Bad token format.',
      });
    }

    const [basic, token] = basicToken;

    if (basic.toLowerCase() !== 'basic') {
      throw new BadRequestException({
        code: ErrorCode.AUTH_BAD_TOKEN_FORMAT,
        message: 'Bad token format.',
      });
    }

    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const tokenSplit = decoded.split(':');

    if (tokenSplit.length !== 2) {
      throw new BadRequestException({
        code: ErrorCode.AUTH_BAD_TOKEN_FORMAT,
        message: 'Bad token format.',
      });
    }

    const [email, password] = tokenSplit;

    return { email, password };
  }

  async register(rawToken: string) {
    const { email, password } = this.parseBasicToken(rawToken);

    const user = await this.userRepository.findOne({ where: { email } });

    if (user) {
      throw new BadRequestException({
        code: ErrorCode.AUTH_EMAIL_TAKEN,
        message: 'User already exists.',
      });
    }

    const hash = await bcrypt.hash(
      password,
      this.configService.getOrThrow<number>('HASH_ROUNDS'),
    );

    await this.userRepository.save({ email, password: hash });

    return this.userRepository.findOne({ where: { email } });
  }

  async validateUser(email: string, password: string) {
    const user = await this.userRepository.findOne({ where: { email } });

    if (!user) {
      throw new BadRequestException({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      throw new BadRequestException({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    return user;
  }

  // 목적: sub/type(+role)을 실은 서명된 JWT 한 장을 발급한다.
  // 이유: 클라이언트가 자기 role을 알려면(admin UI 라우트 게이팅) 매 요청마다 별도 조회를 시키는
  //       대신 이미 디코드하고 있는 액세스 토큰에 실어 보내는 편이 왕복을 줄인다(ADR 0028).
  // 방법: role은 액세스 토큰에만 싣는다 — refresh 토큰 payload는 최소로 유지하고, RolesGuard/
  //       AuthUser는 이 클레임을 절대 읽지 않고 JwtStrategy.validate의 매 요청 DB 조회 결과만
  //       신뢰하므로, 여기 실리는 role은 순수 광고용(advisory)이며 강등 후 최대 access-token TTL
  //       만큼만 클라이언트 UI에 stale하게 보일 뿐 서버 판정에는 영향이 없다.
  async issueToken(
    user: Pick<UserEntity, 'id' | 'role'>,
    isRefreshToken: boolean,
  ) {
    const refreshSecret = this.configService.getOrThrow<string>(
      'REFRESH_TOKEN_SECRET',
    );
    const accessSecret = this.configService.getOrThrow<string>(
      'ACCESS_TOKEN_SECRET',
    );

    const payload: Payload = {
      sub: user.id,
      type: isRefreshToken ? 'refresh' : 'access',
      // jti makes every refresh token unique — same-second issuance would
      // otherwise produce identical signatures, blinding reuse detection.
      ...(isRefreshToken ? { jti: randomUUID() } : { role: user.role }),
    };

    return this.jwtService.signAsync(payload, {
      secret: isRefreshToken ? refreshSecret : accessSecret,
      expiresIn: isRefreshToken
        ? this.configService.getOrThrow<number>(
            'REFRESH_TOKEN_SECRET_EXPIRES_IN',
          )
        : this.configService.getOrThrow<number>(
            'ACCESS_TOKEN_SECRET_EXPIRES_IN',
          ),
    });
  }

  // Verifies a bare JWT with the matching secret AND the type claim — never one
  // without the other (Dual Token Authority). Any failure surfaces as a generic 401.
  async verifyToken(token: string, isRefreshToken: boolean) {
    try {
      const payload = await this.jwtService.verifyAsync<Payload>(token, {
        secret: this.configService.getOrThrow<string>(
          isRefreshToken ? 'REFRESH_TOKEN_SECRET' : 'ACCESS_TOKEN_SECRET',
        ),
      });

      if (payload.type !== (isRefreshToken ? 'refresh' : 'access')) {
        throw new Error('Token type mismatch.');
      }

      return payload;
    } catch {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: 'Invalid or expired token.',
      });
    }
  }

  private hashRefreshToken(token: string) {
    // SHA-256, not bcrypt: JWT strings exceed bcrypt's 72-byte input limit and
    // are high-entropy — a fast hash is sufficient (ADR 0012).
    return createHash('sha256').update(token).digest('hex');
  }

  // 목적: 새 액세스/리프레시 토큰 쌍을 발급하고 리프레시 토큰을 서버 측에 앵커링한다.
  // 이유: issueToken이 액세스 토큰에 role을 실으려면(ADR 0028) 호출자가 id뿐 아니라 role도 쥐고
  //       있어야 한다 — 기존에는 id만 요구했다.
  // 방법: 단일 쓰기(트랜잭션 불필요)로 refreshTokenHash를 갱신한 뒤 두 토큰을 반환한다.
  async issueTokenPair(user: Pick<UserEntity, 'id' | 'role'>) {
    const refreshToken = await this.issueToken(user, true);
    const accessToken = await this.issueToken(user, false);

    await this.userRepository.update(user.id, {
      refreshTokenHash: this.hashRefreshToken(refreshToken),
    });

    return { refreshToken, accessToken };
  }

  // Rotation with reuse detection: the presented token must match the stored
  // hash; a mismatch means a rotated-out token was replayed — kill the session.
  async rotateRefreshToken(rawToken: string | undefined) {
    if (!rawToken) {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: 'No refresh token.',
      });
    }

    const payload = await this.verifyToken(rawToken, true);

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: 'No active session.',
      });
    }

    if (user.refreshTokenHash !== this.hashRefreshToken(rawToken)) {
      await this.userRepository.update(user.id, { refreshTokenHash: null });
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_REFRESH_REUSED,
        message: 'Refresh token reuse detected.',
      });
    }

    return this.issueTokenPair(user);
  }

  async signOut(userId: number) {
    await this.userRepository.update(userId, { refreshTokenHash: null });
  }

  async signIn(rawToken: string) {
    const { email, password } = this.parseBasicToken(rawToken);
    const user = await this.validateUser(email, password);

    return this.issueTokenPair(user);
  }
}
