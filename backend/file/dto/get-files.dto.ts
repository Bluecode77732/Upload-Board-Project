// 목적: GET /file 목록 조회(take/skip)를 제한해 엔드포인트가 전체 테이블을 스캔할 수 없게 한다.
// 사용처: FileController.getFiles()에서 @Query()로 바인딩되고, 값은 FileService.getFiles()로 전달된다.
// 근거: getFiles()가 페이지네이션 없이 동작하던 시절이 있었다(문서화된 Known Gap) — 목록 입력도 경계에서 DTO 검증이 필요하다.

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

// 클라이언트가 지정할 수 있는 정렬 키는 이것뿐이다. 리터럴 튜플로 둬야 FileService가 이걸 기준으로
// total Record를 만들 수 있다 — 컬럼 매핑 없이 여기 키만 추가하면 컴파일 에러가 나고,
// 클라이언트 문자열이 컬럼명으로 그대로 쿼리에 도달하는 일도 없다(ADR 0021).
export const FILE_SORT_FIELDS = ['createdAt', 'title', 'id'] as const;
export type FileSortField = (typeof FILE_SORT_FIELDS)[number];

// 'ASC' | 'DESC'는 TypeORM의 orderBy 방향 인자와 정확히 일치한다.
export const SORT_ORDERS = ['DESC', 'ASC'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class GetFilesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Number of files to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: 'Number of files to skip',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;

  // 길이 제한: 검색어가 ILIKE 패턴이 되므로, 제한이 없으면 아무 쓸모도 없이 패턴 매칭
  // 비용만 무한정 늘어난다(그렇게 긴 제목은 없다).
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
  @IsIn(FILE_SORT_FIELDS)
  @ApiPropertyOptional({
    description: 'Column to sort by. Only these keys are accepted.',
    enum: FILE_SORT_FIELDS,
    default: 'createdAt',
  })
  sortBy: FileSortField = 'createdAt';

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
    description: 'Return only the files created by this user.',
    minimum: 1,
  })
  creatorId?: number;
}
