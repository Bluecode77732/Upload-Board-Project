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

// 회원가입 비밀번호 최소 강도 — app.module.ts의 ACCESS_TOKEN_SECRET/REFRESH_TOKEN_SECRET Joi
// 패턴(대/소문자·숫자·기호 모두 포함)을 그대로 미러링해, 시크릿에 적용한 것과 같은 강도
// 기준을 사용자 비밀번호에도 적용한다. 길이만 32자에서 10자로 낮췄다 — 시크릿은 기계가
// 생성하는 고엔트로피 값이지만 이건 사람이 직접 타이핑하는 값이기 때문.
const PASSWORD_STRENGTH_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  // 목적: `Authorization: Basic base64(email:password)` 헤더에서 email/password를 뽑아낸다.
  // 이유: 회원가입·로그인 모두 바디 DTO가 아니라 Basic 토큰으로 자격 증명을 받는다(ADR 0001) —
  //       두 호출부(register, signIn)가 같은 파싱 로직을 공유해야 형식 검증이 갈라지지 않는다.
  // 방법: "Basic " 접두사 → base64 디코드 → "email:password" 콜론 분리, 각 단계에서 형식이
  //       어긋나면 동일한 AUTH_BAD_TOKEN_FORMAT 400으로 즉시 실패시킨다.
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

  // 목적: Basic 토큰으로 넘어온 자격 증명으로 새 계정을 만든다.
  // 이유: `POST /user`는 존재하지 않고 가입 경로는 오직 `POST /auth/register`뿐이다 —
  //       가입도 로그인과 같은 Basic 토큰 형식을 쓰기로 한 결정(ADR 0001)의 절반. Basic
  //       토큰 파싱 경로는 DTO/ValidationPipe를 거치지 않으므로, 비밀번호 강도 검증을
  //       여기서 직접 하지 않으면 빈 문자열도 그대로 해시되어 저장된다.
  // 방법: PASSWORD_STRENGTH_PATTERN 미달 시 AUTH_WEAK_PASSWORD 400을 먼저 던지고,
  //       이메일 중복을 걸러 AUTH_EMAIL_TAKEN 400을 던진 뒤, HASH_ROUNDS만큼 bcrypt
  //       해시해 저장 — 응답은 방금 쓴 행을 다시 읽어 반환한다(캐시된 인메모리 값이
  //       아니라 DB 확정값).
  async register(rawToken: string) {
    const { email, password } = this.parseBasicToken(rawToken);

    if (!PASSWORD_STRENGTH_PATTERN.test(password)) {
      throw new BadRequestException({
        code: ErrorCode.AUTH_WEAK_PASSWORD,
        message:
          'Password must be at least 10 characters and include lowercase, uppercase, a digit, and a symbol.',
      });
    }

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

  // 목적: email/password 자격 증명이 실제 계정과 맞는지 확인하고 그 사용자 엔티티를 돌려준다.
  // 이유: `signIn`(Basic 토큰 로그인)이 "누가 이 비밀번호를 아는가"를 판정하는 유일한 경로다 —
  //       판정 로직을 여기 한 곳에 모아 signIn과 갈라지지 않게 한다.
  // 방법: 이메일로 조회 후 존재/불일치 두 실패 케이스를 동일한 AUTH_INVALID_CREDENTIALS
  //       메시지로 합쳐 던진다 — 계정 존재 여부를 외부에 흘리지 않기 위함.
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
      // jti는 모든 리프레시 토큰을 유일하게 만든다 — 없으면 같은 초에 발급된 토큰들이
      // 동일한 서명을 갖게 되어 재사용 탐지가 무력화된다.
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

  // 목적: JWT 문자열이 위조되지 않았고 올바른 종류(access/refresh)로 쓰이고 있는지 확인한다.
  // 이유: 두 토큰은 별도 시크릿으로 서명되지만 구조적으로는 둘 다 유효한 JWT다 — 시크릿만
  //       맞으면 리프레시 토큰을 액세스 토큰으로 재생(replay)할 수 있는 구멍을 막아야 한다
  //       (Dual Token Authority, ADR 0002).
  // 방법: `isRefreshToken`에 대응하는 시크릿으로 검증 → `payload.type`이 기대한 종류와
  //       일치하는지 재확인. 서명 실패든 type 불일치든 내부 사유를 노출하지 않고 동일한
  //       generic 401(AUTH_TOKEN_INVALID)로 합친다.
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

  // 목적: 리프레시 토큰 원문을 DB에 저장 가능한 고정 길이 앵커 값으로 바꾼다.
  // 이유: `refreshTokenHash` 컬럼에 원문 토큰을 그대로 저장하면 DB 유출 시 세션이 통째로
  //       탈취된다 — 회전/재생 탐지에는 "제시된 토큰이 마지막 발급분과 같은가"만 판별하면
  //       되므로 원문 보관이 필요 없다(ADR 0012).
  // 방법: SHA-256 사용 — bcrypt가 아닌 이유는 JWT 문자열이 bcrypt의 72바이트 입력 한도를
  //       넘고 이미 고엔트로피라 느린 해시가 주는 이점이 없기 때문.
  private hashRefreshToken(token: string) {
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

  // 목적: 쿠키로 들어온 리프레시 토큰을 검증하고 새 토큰 쌍으로 회전시킨다.
  // 이유: 리프레시 토큰은 재사용을 탐지해야 탈취된 토큰의 장기 악용을 막을 수 있다 —
  //       회전 없이 동일 리프레시 토큰을 계속 쓰면 한 번 유출된 토큰이 만료 전까지
  //       영구 세션이 된다(ADR 0012).
  // 방법: 서명/타입 검증(verifyToken) → 사용자의 저장된 해시와 원문 재해시를 대조 —
  //       불일치는 이미 회전되어 폐기된(rotated-out) 토큰의 재생이므로 해시를 즉시
  //       null로 지워 세션을 강제 종료하고 AUTH_REFRESH_REUSED로 응답, 일치 시에만
  //       issueTokenPair로 새 쌍을 발급한다.
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

  // 목적: 현재 세션의 리프레시 앵커를 지워 그 계정의 리프레시 토큰을 더 이상 쓸 수 없게 한다.
  // 이유: 계정당 앵커 컬럼이 하나뿐이라(one session per account) 로그아웃은 "그 하나를
  //       지운다"로 충분히 표현된다 — 별도의 세션 테이블이 없다.
  // 방법: `refreshTokenHash`를 null로 업데이트. 쿠키 자체를 지우는 것은 컨트롤러(응답 쿠키
  //       clear) 책임이고 이 메서드는 서버 측 앵커만 담당한다.
  async signOut(userId: number) {
    await this.userRepository.update(userId, { refreshTokenHash: null });
  }

  // 목적: Basic 토큰 로그인 — 자격 증명을 확인하고 새 액세스/리프레시 토큰 쌍을 발급한다.
  // 이유: `POST /auth/signin`은 body DTO가 아니라 Basic 토큰으로 로그인받기로 한 결정
  //       (ADR 0001)의 나머지 절반 — register와 같은 파싱 경로를 재사용해 형식 검증이
  //       갈라지지 않게 한다.
  // 방법: parseBasicToken으로 자격 증명 분리 → validateUser로 대조 → issueTokenPair로
  //       발급 및 리프레시 앵커 기록까지 위임한다.
  async signIn(rawToken: string) {
    const { email, password } = this.parseBasicToken(rawToken);
    const user = await this.validateUser(email, password);

    return this.issueTokenPair(user);
  }
}
