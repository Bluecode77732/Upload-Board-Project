// Purpose: bounds and validates the GET /audit-log query (action filter + take/skip pagination).
// Usage: bound via @Query() in AuditLogController.findAll(); forwarded to AuditLogService.findAll().
// Rationale: list endpoints must paginate (Never Do G2) and validate at the boundary; take/skip matches GetFilesDto.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const AUDIT_ACTIONS = [
  'ROLE_CHANGE',
  'USER_DELETE',
  'FILE_DELETE',
  'POST_DELETE',
] as const;

export class AuditLogQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  action?: (typeof AUDIT_ACTIONS)[number];

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
