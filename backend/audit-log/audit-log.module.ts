// 목적: 감사 로그 엔티티, 서비스, 컨트롤러를 앱에 연결한다.
// 사용처: AppModule에서 임포트; UserModule/FileModule이 작업을 기록하도록 AuditLogService를 export.
// 근거: RBAC(ADR 0013) 감사 로그는 자체 모듈에 두고, 모듈 간 사용은 export를 통해서만 이루어진다.

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
