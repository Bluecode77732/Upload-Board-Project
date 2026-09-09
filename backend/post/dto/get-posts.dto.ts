// 목적: GET /post 목록 조회 쿼리(페이지네이션, 제목 검색, 작성자 필터, 정렬)를 제한하고 화이트리스트로 걸러낸다.
// 사용처: PostController.getPosts()에서 @Query()로 바인딩되어 값이 PostService.getPosts()로 전달된다.
// 근거: ADR 0023은 게시글 목록 조회가 ADR 0021의 read layer를 새로 만들지 않고 그대로 확장해야 한다고 정한다 — 이 DTO가 GetFilesDto와 같은 모양을 따르는 이유이며, 두 엔드포인트가 같은 규칙 하나를 공유하게 한다.

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

// 클라이언트가 지정할 수 있는 정렬 키는 이것뿐이다. 리터럴 튜플로 만들어 PostService가
// 이를 기반으로 total Record의 키를 잡을 수 있게 한다 — 컬럼 매핑 없이 여기에 키를
// 추가하면 컴파일 에러가 나고, 어떤 클라이언트 문자열도 컬럼명으로 쿼리에 도달하지 못한다 (ADR 0021).
export const POST_SORT_FIELDS = ['createdAt', 'title', 'id'] as const;
export type PostSortField = (typeof POST_SORT_FIELDS)[number];

export class GetPostsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Number of posts to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: 'Number of posts to skip',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;

  // 길이를 제한한다: 검색어는 ILIKE 패턴이 되므로, 제한 없이 두면 정당한 용도 없이
  // 패턴 매칭 비용만 무한정 늘어난다.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on the title. Wildcards are escaped, so % and _ match literally. Blank or whitespace-only is treated as absent.',
    maxLength: 100,
    example: 'holiday',
  })
  search?: string;

  @IsOptional()
  @IsIn(POST_SORT_FIELDS)
  @ApiPropertyOptional({
    description: 'Column to sort by. Only these keys are accepted.',
    enum: POST_SORT_FIELDS,
    default: 'createdAt',
  })
  sortBy: PostSortField = 'createdAt';

  @IsOptional()
  @IsIn(SORT_ORDERS)
  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: SORT_ORDERS,
    default: 'DESC',
  })
  order: SortOrder = 'DESC';

  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({
    description: 'Return only the posts written by this user.',
    minimum: 1,
  })
  creatorId?: number;
}
