// Purpose: bounds and validates the GET /audit-log query (action filter, related-user filter, take/skip pagination).
// Usage: bound via @Query() in AuditLogController.findAll(); forwarded to AuditLogService.findAll().
// Rationale: list endpoints must paginate (Never Do G2) and validate at the boundary; take/skip matches
// GetFilesDto. userId was added for the admin console's user detail panel (admin/README.md "What was adapted"
// lists "recent activity" as removed for lack of backend support).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const AUDIT_ACTIONS = [
  'ROLE_CHANGE',
  'USER_DELETE',
  'FILE_DELETE',
  'POST_DELETE',
  'COMMENT_DELETE',
] as const;

export class AuditLogQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  action?: (typeof AUDIT_ACTIONS)[number];

  // Matches a record where this user was either the actor or the target — the admin
  // console's user detail panel wants "everything related to this account", not just
  // one side of it.
  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({
    description:
      'Return only records where this user was the actor or the target.',
    minimum: 1,
  })
  userId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Number of records to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: 'Number of records to skip',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;
}
