// 목적: GET /user 목록 조회 쿼리(페이지네이션, 이메일 검색, 정렬)를 제한하고 화이트리스트로 걸러낸다.
// 사용처: UserController.findAll()에서 @Query()로 바인딩되어 값이 UserService.findAll()로 전달된다.
// 근거: findAll()은 원래 findAndCount()를 무조건 호출해 모든 행을 반환했다(문서화된 Never
// Do Group 2 부채, ROADMAP 실행 순서 #2) — 이제 admin 콘솔이 유저 검색을 필요로 하면서
// (admin/README.md "What was adapted"), search/sortBy/order를 추가해 GET /file과 동등하게 맞춘다(ADR 0021).

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SORT_ORDERS } from 'backend/file/dto/get-files.dto';
// `import type`이 필요하다: emitDecoratorMetadata + isolatedModules 조합에서는
// 데코레이터가 붙은 시그니처에 쓰이는 타입을 value-import로 내보낼 수 없다.
import type { SortOrder } from 'backend/file/dto/get-files.dto';

// 클라이언트가 지정할 수 있는 정렬 키는 이것뿐이다. 리터럴 튜플로 만들어 UserService가
// 이를 기반으로 total Record의 키를 잡을 수 있게 한다 — 컬럼 매핑 없이 여기에 키를
// 추가하면 컴파일 에러가 나고, 어떤 클라이언트 문자열도 컬럼명으로 쿼리에 도달하지 못한다
// (ADR 0021 패턴). `role`은 의도적으로 제외했다 — 3단계 문자열 enum은 정렬 의미가 거의 없다.
export const USER_SORT_FIELDS = ['createdAt', 'email', 'id'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class GetUsersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Number of users to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: 'Number of users to skip',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;

  // 길이를 제한한다: 검색어는 ILIKE 패턴이 되므로, 제한 없이 두면 정당한 용도 없이
  // 패턴 매칭 비용만 무한정 늘어난다 (이메일이 그렇게 길 일은 없다).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on the email. Wildcards are escaped, so % and _ match literally. Blank or whitespace-only is treated as absent.',
    maxLength: 100,
    example: 'user@example.com',
  })
  search?: string;

  @IsOptional()
  @IsIn(USER_SORT_FIELDS)
  @ApiPropertyOptional({
    description: 'Column to sort by. Only these keys are accepted.',
    enum: USER_SORT_FIELDS,
    default: 'createdAt',
  })
  sortBy: UserSortField = 'createdAt';

  @IsOptional()
  @IsIn(SORT_ORDERS)
  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: SORT_ORDERS,
    default: 'DESC',
  })
  order: SortOrder = 'DESC';
}
