// Purpose: bounds and whitelists the GET /user list query (pagination, email search, sort).
// Usage: bound via @Query() in UserController.findAll(); values forwarded to UserService.findAll().
// Rationale: findAll() originally returned every row via a bare findAndCount() (a documented Never
// Do Group 2 debt, ROADMAP execution order #2); search/sortBy/order extend it to GET /file parity
// (ADR 0021) now that the admin console needs user search (admin/README.md "What was adapted").

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

// The only sort keys a client may name. A literal tuple so UserService can key a total
// Record off it: a key added here without a column mapping is a compile error, and no
// client string ever reaches the query as a column name (ADR 0021 pattern). `role` is
// deliberately excluded — a 3-tier string enum carries little sort meaning.
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

  // Bounded length: the term becomes an ILIKE pattern, and an unbounded one is a
  // free pattern-matching cost with no legitimate use (no email is that long).
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
