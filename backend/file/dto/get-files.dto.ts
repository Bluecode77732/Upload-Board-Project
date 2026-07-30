// Purpose: bounds the GET /file list query (take/skip) so the endpoint can never scan the full table.
// Usage: bound via @Query() in FileController.getFiles(); values forwarded to FileService.getFiles().
// Rationale: getFiles() was unpaginated (a documented Known Gap); list inputs need DTO validation at the boundary.

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

// The only sort keys a client may name. Kept as a literal tuple so FileService can key a
// total Record off it: adding a key here without a column mapping is a compile error, and
// no client string ever reaches the query as a column name (ADR 0021).
export const FILE_SORT_FIELDS = ['createdAt', 'title', 'id'] as const;
export type FileSortField = (typeof FILE_SORT_FIELDS)[number];

// 'ASC' | 'DESC' matches TypeORM's orderBy direction argument exactly.
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

  // Bounded length: the term becomes an ILIKE pattern, and an unbounded one is a
  // free pattern-matching cost with no legitimate use (no title is that long).
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
