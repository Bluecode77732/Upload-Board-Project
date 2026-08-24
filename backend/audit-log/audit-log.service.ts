// Purpose: writes and reads audit records for privileged actions (role change, user/file delete).
// Usage: log() called by UserService/FileService after their transactions commit; findAll() by GET /audit-log.
// Rationale: centralizes the audit trail RBAC requires (ADR 0013); a single write, so a plain repository call suffices.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';
import { AuditTargetType } from './audit-target-type.enum';
import { AuditAction, AuditLogQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
  ) {}

  // 목적: 권한 있는 행위 한 건을 감사 테이블에 append-only로 기록한다.
  // 이유: targetId 하나만으로는 그 숫자가 유저인지 파일·게시글·댓글인지 알 수 없어, 조회 측이
  //       모든 targetId를 유저 id로 읽는 오탐이 있었다(ADR 0045). 종류를 기록 시점에 함께 남긴다.
  // 방법: 호출자가 targetType을 명시적으로 넘기고 그대로 저장한다. targetType과 action은 둘 다
  //       문자열이라 순서를 바꿔 넣기 쉬우므로, 서로 겹치지 않는 유니온 타입으로 좁혀 컴파일 시점에
  //       막는다. 대상이 없는 기록은 두 칸을 함께 null로 둔다(targetType IS NULL ⟺ targetId IS NULL).
  async log(
    actorId: number,
    targetId: number | null,
    targetType: AuditTargetType | null,
    action: AuditAction,
    detail?: string,
  ): Promise<void> {
    await this.auditLogRepository.save({
      actorId,
      targetId,
      targetType,
      action,
      detail: detail ?? null,
    });
  }

  // 목적: 감사 로그 목록을 action 필터·특정 유저 관련 필터와 함께 페이지네이션해 반환한다.
  // 이유: admin 콘솔의 유저 상세 패널이 "이 계정과 관련된 모든 기록"(actor로서 한 행위 + target으로서
  //       겪은 행위)을 보여주려 하는데, 기존에는 action 필터만 있어 이 조회가 불가능했다
  //       (admin/README.md "What was adapted" — 이 백엔드가 지원하지 않아 제거된 기능).
  // 방법: userId가 있으면 actorId=userId 브랜치와 targetId=userId 브랜치를 OR로 묶되, 두 번째
  //       브랜치에 targetType='user'를 AND로 걸어 대상이 실제 유저인 기록만 통과시킨다 — 이것이
  //       파일·게시글·댓글 id가 우연히 같은 숫자일 때 생기던 오탐을 없앤다(ADR 0045). action이
  //       함께 있으면 각 브랜치에 AND로 얹는다(TypeORM에서 where 배열이 OR로 해석됨). userId가
  //       없으면 기존 동작(action만, 또는 빈 조건)을 그대로 유지한다.
  async findAll(query: AuditLogQueryDto): Promise<[AuditLogEntity[], number]> {
    const { action, userId, take, skip } = query;

    // actorId/targetId/targetType currently have no index of their own (the entity's only
    // index is (action, createdAt)) — acceptable for this low-volume portfolio project;
    // add a dedicated index if this filter sees real traffic.
    const where = userId
      ? [
          { ...(action && { action }), actorId: userId },
          {
            ...(action && { action }),
            targetId: userId,
            targetType: AuditTargetType.user,
          },
        ]
      : action
        ? { action }
        : {};

    return this.auditLogRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take,
      skip,
    });
  }
}
