import { ApiProperty } from '@nestjs/swagger';

export class bearerTokenType {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}

// 예전 tokenType({ refreshToken, accessToken })은 ADR 0012로 제거됐다:
// 이제 리프레시 토큰은 httpOnly 쿠키로만 오가며, body에는 절대 실리지 않는다.
