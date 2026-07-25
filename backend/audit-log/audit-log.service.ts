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

  async findAll(query: AuditLogQueryDto): Promise<[AuditLogEntity[], number]> {
    return this.auditLogRepository.findAndCount({
      where: query.action ? { action: query.action } : {},
      order: { createdAt: 'DESC' },
      take: query.take,
      skip: query.skip,
    });
  }
}
