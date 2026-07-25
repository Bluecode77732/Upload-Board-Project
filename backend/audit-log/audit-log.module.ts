// Purpose: wires the audit-log entity, service, and controller into the app.
// Usage: imported by AppModule; exports AuditLogService for UserModule/FileModule to record actions.
// Rationale: RBAC (ADR 0013) audit trail lives in its own module; cross-module use goes through exports only.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
