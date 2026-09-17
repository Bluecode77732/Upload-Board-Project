// 목적: GET /audit-log 쿼리(action 필터, 관련 유저 필터, take/skip 페이지네이션)를 검증하고 범위를 제한한다.
// 사용처: AuditLogController.findAll()에서 @Query()로 바인딩되어 AuditLogService.findAll()로 전달된다.
// 근거: 목록 엔드포인트는 페이지네이션이 필수이고(Never Do G2) 경계에서 검증해야 한다; take/skip은
// GetFilesDto와 맞췄다. userId는 admin 콘솔의 유저 상세 패널을 위해 추가됐다(admin/README.md
// "What was adapted"에 "recent activity"가 백엔드 미지원으로 제거됐다고 기록됨).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const AUDIT_ACTIONS = [
  'ROLE_CHANGE',
  'USER_DELETE',
  'FILE_DELETE',
  'POST_DELETE',
  'COMMENT_DELETE',
  'FILE_TRANSFER',
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
      "이 유저가 행위자이거나, 유저-대상 행위(targetType='user' — ROLE_CHANGE, " +
      'USER_DELETE)의 대상이었던 기록만 반환한다. 대상이 파일·게시글·댓글인 기록은 ' +
      '행위자 쪽으로만 매칭된다. (Return only records where this user was the actor, ' +
      "or was the target of a user-targeting action (targetType='user' — ROLE_CHANGE, " +
      'USER_DELETE). Records whose target is a file, post, or comment match only via ' +
      'the actor side.)',
    minimum: 1,
  })
  userId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: '반환할 기록 개수. (Number of records to return.)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: '건너뛸 기록 개수. (Number of records to skip.)',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;
}
