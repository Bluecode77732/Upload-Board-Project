import { ApiProperty } from '@nestjs/swagger';

export class bearerTokenType {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}

// The former tokenType ({ refreshToken, accessToken }) was removed with ADR 0012:
// the refresh token now travels only as an httpOnly cookie, never in a body.
