// Purpose: writes and reads audit records for privileged actions (role change, user/file delete).
// Usage: log() called by UserService/FileService after their transactions commit; findAll() by GET /audit-log.
// Rationale: centralizes the audit trail RBAC requires (ADR 0013); a single write, so a plain repository call suffices.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
  ) {}

  async log(
    actorId: number,
    targetId: number | null,
    action: string,
    detail?: string,
  ): Promise<void> {
    await this.auditLogRepository.save({
      actorId,
      targetId,
      action,
      detail: detail ?? null,
    });
  }

  // 목적: 감사 로그 목록을 action 필터·특정 유저 관련 필터와 함께 페이지네이션해 반환한다.
  // 이유: admin 콘솔의 유저 상세 패널이 "이 계정과 관련된 모든 기록"(actor로서 한 행위 + target으로서
  //       겪은 행위)을 보여주려 하는데, 기존에는 action 필터만 있어 이 조회가 불가능했다
  //       (admin/README.md "What was adapted" — 이 백엔드가 지원하지 않아 제거된 기능).
  // 방법: userId가 있으면 actorId=userId와 targetId=userId 두 브랜치를 OR로 묶고, action이 함께
  //       있으면 각 브랜치에 AND로 얹는다(TypeORM에서 where 배열이 OR로 해석됨). userId가 없으면
  //       기존 동작(action만, 또는 빈 조건)을 그대로 유지한다.
  async findAll(query: AuditLogQueryDto): Promise<[AuditLogEntity[], number]> {
    const { action, userId, take, skip } = query;

    // actorId/targetId currently have no index of their own (the entity's only index is
    // (action, createdAt)) — acceptable for this low-volume portfolio project; add a
    // dedicated index if this filter sees real traffic.
    const where = userId
      ? [
          { ...(action && { action }), actorId: userId },
          { ...(action && { action }), targetId: userId },
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
