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

  async issueToken(user: Pick<UserEntity, 'id'>, isRefreshToken: boolean) {
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
      ...(isRefreshToken ? { jti: randomUUID() } : {}),
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

  // Issues a fresh access/refresh pair and anchors the refresh token server-side
  // (single write — plain repository call, no transaction needed).
  async issueTokenPair(user: Pick<UserEntity, 'id'>) {
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
