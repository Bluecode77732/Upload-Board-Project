import {
  ClassSerializerInterceptor,
  Controller,
  Post,
  Headers,
  Request,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guard/local-auth.guard';
import { JwtAuthGuard } from './guard/jwt-auth.guard';
import {
  ApiBasicAuth,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from 'backend/user/dto/create-user.dto';
import { UserEntity } from 'backend/user/entity/user.entity';
import { bearerTokenType } from './dto/token-types.auth.dto';
import { UserId } from 'backend/user/decorator/userId.decorator';
import type { Request as ExpressRequest, Response } from 'express';

// The refresh token travels only in this httpOnly cookie (ADR 0012) — never in a response body.
const REFRESH_TOKEN_COOKIE = 'refreshToken';

@Controller('auth')
@ApiTags('Authentication API')
// register returns a UserEntity — without this, @Exclude fields (password,
// refreshTokenHash) leak in the response (Never Do Group 3).
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @ApiBasicAuth()
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'Created user.', type: UserEntity })
  @ApiOperation({
    description: 'Register with Basic Token (base64 email:password)',
  })
  // 목적: Basic 토큰 헤더를 그대로 서비스에 전달해 계정을 생성한다.
  // 이유: 회원가입 자격 증명은 body DTO가 아니라 헤더로 받기로 한 결정(ADR 0001) — 컨트롤러는
  //       파싱을 하지 않고 원문 헤더만 옮긴다.
  // 방법: AuthService.register에 위임, 응답은 방금 생성된 UserEntity(직렬화 인터셉터가 password 등을 걸러냄).
  register(@Headers('authorization') rawToken: string) {
    return this.authService.register(rawToken);
  }

  @Post('signin')
  @ApiBasicAuth()
  @ApiResponse({
    status: 201,
    description:
      'Sign in succeeded. The refresh token is set as an httpOnly cookie (SameSite=Strict, Path=/auth/token); only the access token is returned in the body.',
    type: bearerTokenType,
    example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
  })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  // 목적: Basic 토큰 로그인 — 액세스 토큰은 본문으로, 리프레시 토큰은 httpOnly 쿠키로 내려준다.
  // 이유: 리프레시 토큰은 응답 본문에 절대 실리지 않는다(ADR 0012) — XSS로 JS가 읽을 수 있는
  //       곳에 두지 않기 위함이다.
  // 방법: AuthService.signIn으로 토큰 쌍을 받아 setRefreshCookie로 쿠키만 굽고, 본문은
  //       accessToken만 반환한다.
  async signIn(
    @Headers('authorization') rawToken: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { refreshToken, accessToken } =
      await this.authService.signIn(rawToken);

    this.setRefreshCookie(response, refreshToken);

    return { accessToken };
  }

  @Post('token/refresh')
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiResponse({
    status: 201,
    description:
      'Rotates the refresh token (new httpOnly cookie) and returns a new access token.',
    type: bearerTokenType,
    example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
  })
  @ApiResponse({
    status: 401,
    description:
      'Missing/invalid refresh cookie (AUTH_TOKEN_INVALID) or reuse of a rotated-out token (AUTH_REFRESH_REUSED — session invalidated).',
  })
  // 목적: 쿠키의 리프레시 토큰을 회전시켜 새 액세스 토큰을 발급한다.
  // 이유: 리프레시 토큰은 body/header가 아니라 쿠키로만 오가므로(ADR 0012), 컨트롤러가 직접
  //       쿠키 파싱을 서비스 밖에서 반복하지 않도록 extractRefreshCookie로 좁혀 넘긴다.
  // 방법: extractRefreshCookie로 쿠키값을 꺼내 AuthService.rotateRefreshToken에 위임 —
  //       미제출/재생 탐지 판정은 전부 서비스 책임이고, 컨트롤러는 성공 시 새 쿠키만 굽는다.
  async rotateAccessToken(
    @Req() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { refreshToken, accessToken } =
      await this.authService.rotateRefreshToken(
        this.extractRefreshCookie(request),
      );

    this.setRefreshCookie(response, refreshToken);

    return { accessToken };
  }

  @UseGuards(LocalAuthGuard)
  @Post('signin/local')
  @ApiOperation({ description: 'Sign in using Passport local strategy.' })
  @ApiResponse({
    status: 201,
    description:
      'Sign in succeeded. The refresh token is set as an httpOnly cookie; only the access token is returned in the body.',
    type: bearerTokenType,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiBody({ type: CreateUserDto, required: true })
  // 목적: Passport local 전략으로 이미 검증된 사용자에게 토큰 쌍을 발급한다.
  // 이유: LocalAuthGuard가 자격 증명 검증을 먼저 끝내고 request.user를 채워주므로, 이 핸들러는
  //       발급만 하면 된다 — signIn과 자격 증명 검증 방식만 다를 뿐 발급 이후 흐름은 동일하다.
  // 방법: guard가 채운 req.user(id/role)를 issueTokenPair에 그대로 넘기고, 나머지는 signIn과
  //       동일하게 쿠키/본문을 나눈다.
  async userLocalLoginPassport(
    @Request() req: { user: Pick<UserEntity, 'id' | 'role'> },
    @Res({ passthrough: true }) response: Response,
  ) {
    const { refreshToken, accessToken } = await this.authService.issueTokenPair(
      req.user,
    );

    this.setRefreshCookie(response, refreshToken);

    return { accessToken };
  }

  @UseGuards(JwtAuthGuard)
  @Post('signout')
  @ApiBearerAuth()
  @ApiResponse({
    status: 201,
    description:
      'Signed out: the stored refresh-token hash is invalidated and the cookie is cleared.',
  })
  @ApiResponse({ status: 401, description: 'Missing/invalid access token.' })
  // 목적: 현재 세션을 종료한다 — 서버 측 앵커와 브라우저 쿠키를 모두 지운다.
  // 이유: 앵커만 지우고 쿠키를 남기면 브라우저가 이미 무효화된 리프레시 토큰을 계속 들고 있게
  //       된다 — 두 쪽 다 지워야 실제로 "로그아웃"이 된다.
  // 방법: @UserId로 얻은 인증된 본인 id로 AuthService.signOut(해시 null화) 호출 후
  //       clearRefreshCookie로 쿠키를 지운다.
  async signOut(
    @UserId() userId: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.signOut(userId);

    this.clearRefreshCookie(response);

    return { success: true };
  }

  // 목적: 요청 쿠키에서 리프레시 토큰 원문을 꺼낸다.
  // 이유: rotateAccessToken이 쿠키 파싱 세부사항(타입 좁히기)을 몰라도 되게 분리한다.
  // 방법: REFRESH_TOKEN_COOKIE 키로 조회 후 문자열일 때만 반환, 아니면 undefined
  //       (AuthService.rotateRefreshToken이 이를 "토큰 없음" 401로 처리한다).
  private extractRefreshCookie(request: ExpressRequest): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_TOKEN_COOKIE];

    return typeof value === 'string' ? value : undefined;
  }

  // 목적: 리프레시 쿠키에 공통으로 적용되는 옵션(만료 제외)을 한 곳에 모은다.
  // 이유: set/clear 양쪽이 옵션이 어긋나면 clearCookie가 실제로는 쿠키를 못 지운다
  //       (브라우저는 옵션이 일치해야 같은 쿠키로 인식) — 그래서 이 헬퍼로 공유한다.
  // 방법: httpOnly + SameSite=Strict + Path=/auth/token(XHR 전용, 리프레시 엔드포인트로만
  //       범위 제한, ADR 0012)를 고정하고, Secure는 ENV가 prod일 때만 켠다.
  private refreshCookieBaseOptions() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      path: '/auth/token',
      secure: this.configService.getOrThrow<string>('ENV') === 'prod',
    };
  }

  // 목적: 리프레시 토큰을 httpOnly 쿠키로 응답에 굽는다.
  // 이유: signIn/rotateAccessToken/userLocalLoginPassport 세 핸들러가 동일한 쿠키 설정을
  //       중복 작성하지 않도록 한 곳에 모은다.
  // 방법: refreshCookieBaseOptions에 REFRESH_TOKEN_SECRET_EXPIRES_IN(초)을 밀리초로 환산한
  //       maxAge를 더해 response.cookie를 호출한다.
  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...this.refreshCookieBaseOptions(),
      maxAge:
        Number(
          this.configService.getOrThrow<number>(
            'REFRESH_TOKEN_SECRET_EXPIRES_IN',
          ),
        ) * 1000,
    });
  }

  // 목적: 로그아웃 시 브라우저의 리프레시 쿠키를 지운다.
  // 이유: setRefreshCookie와 옵션이 어긋나면 브라우저가 다른 쿠키로 취급해 삭제가 안 먹는다.
  // 방법: refreshCookieBaseOptions를 그대로 재사용해 response.clearCookie 호출.
  private clearRefreshCookie(response: Response) {
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.refreshCookieBaseOptions());
  }
}
