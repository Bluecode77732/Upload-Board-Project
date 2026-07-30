// Purpose: bounds and whitelists the GET /post list query (pagination, title search, creator filter, sort).
// Usage: bound via @Query() in PostController.getPosts(); values forwarded to PostService.getPosts().
// Rationale: ADR 0023 says the post listing extends the ADR 0021 read layer rather than restating it — this mirrors GetFilesDto's shape so both endpoints answer to one set of rules.

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
// `import type` is required: emitDecoratorMetadata + isolatedModules cannot emit a
// value-import for a type used in a decorated signature.
import type { SortOrder } from 'backend/file/dto/get-files.dto';

// The only sort keys a client may name. A literal tuple so PostService can key a total
// Record off it: a key added here without a column mapping is a compile error, and no
// client string ever reaches the query as a column name (ADR 0021).
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

  // Bounded length: the term becomes an ILIKE pattern, and an unbounded one is a
  // free pattern-matching cost with no legitimate use.
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
