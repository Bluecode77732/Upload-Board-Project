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
  async userLocalLoginPassport(
    @Request() req: { user: { id: number } },
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
  async signOut(
    @UserId() userId: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.signOut(userId);

    this.clearRefreshCookie(response);

    return { success: true };
  }

  private extractRefreshCookie(request: ExpressRequest): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_TOKEN_COOKIE];

    return typeof value === 'string' ? value : undefined;
  }

  // Strict + narrow Path: the cookie is XHR-only and must reach /auth/token/* alone (ADR 0012).
  private refreshCookieBaseOptions() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      path: '/auth/token',
      secure: this.configService.getOrThrow<string>('ENV') === 'prod',
    };
  }

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

  private clearRefreshCookie(response: Response) {
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.refreshCookieBaseOptions());
  }
}
