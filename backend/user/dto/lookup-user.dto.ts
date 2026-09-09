// 목적: GET /user/lookup의 쿼리 DTO — 정확히 일치하는 이메일을, 파일 이전(transfer) 제안이
//   필요로 하는 숫자 id로 해석한다 (ADR 0050 프론트엔드 UI).
// 사용처: UserController.findByEmail()에서 @Query()로 바인딩되어 UserService로 그대로 전달된다.
// 근거: GetUsersDto가 아니라 별도 DTO로 둔다 — 이건 페이지네이션이 있는 부분 일치 검색이 아니라
//   단건 정확 일치 조회이므로, 둘이 상속할 만한 검증을 공유하지 않는다.

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class LookupUserDto {
  @IsEmail()
  @ApiProperty({
    description: 'Exact email to resolve to a user id.',
    example: 'user@example.com',
  })
  email!: string;
}
