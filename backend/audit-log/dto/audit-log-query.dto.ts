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

// AuditLogService.log()의 action 파라미터 타입. string이면 targetType 인자와 둘 다 문자열이라
// 순서를 바꿔 넣어도 컴파일이 통과한다 — 두 유니온이 서로 겹치지 않게 좁혀 그 실수를 막는다.
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export class AuditLogQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  action?: AuditAction;

  // 이 유저가 행위자(actorId)이거나, 대상이면서 그 대상이 실제로 유저인
  // (targetType='user') 기록만 매칭한다. targetId는 유저·파일·게시글·댓글 id가 섞이는
  // 다형 필드라, 종류를 보지 않고 매칭하면 파일 id가 우연히 어떤 유저 id와 같을 때 무관한
  // 기록이 그 유저 활동으로 딸려 나온다(ADR 0045).
  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({
    description:
      'Return only records where this user was the actor, or was the target of a ' +
      "user-targeting action (targetType='user' — ROLE_CHANGE, USER_DELETE). Records " +
      'whose target is a file, post, or comment match only via the actor side.',
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
