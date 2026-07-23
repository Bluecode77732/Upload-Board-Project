import { Controller, Post, Headers, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guard/local-auth.guard';
import {
  ApiBasicAuth,
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserEntity } from 'src/user/entity/user.entity';
import { bearerTokenType, tokenType } from './dto/token-types.auth.dto';

@Controller('auth')
@ApiTags('Authentication API')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    description: 'Sign in succeeded.',
    type: tokenType,
    schema: {
      example: {
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  signIn(@Headers('authorization') rawToken: string) {
    return this.authService.signIn(rawToken);
  }

  @Post('token/refresh')
  @ApiBearerAuth()
  @ApiResponse({
    status: 201,
    description: 'Issues a new access token using a refresh token.',
    type: bearerTokenType,
    example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Provide the refresh token from /auth/signin.',
  })
  async refreshAccessToken(@Headers('authorization') rawToken: string) {
    const payload = await this.authService.parseBearerToken(rawToken, true);

    return {
      accessToken: await this.authService.issueToken(
        { id: payload.sub },
        false,
      ),
    };
  }

  @UseGuards(LocalAuthGuard)
  @Post('signin/local')
  @ApiOperation({ description: 'Sign in using Passport local strategy.' })
  @ApiResponse({
    status: 201,
    description: 'Issues refresh and access tokens.',
    type: tokenType,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiBody({ type: CreateUserDto, required: true })
  async userLocalLoginPassport(@Request() req: { user: { id: number } }) {
    return {
      refreshToken: await this.authService.issueToken(req.user, true),
      accessToken: await this.authService.issueToken(req.user, false),
    };
  }
}
