// 목적: liveness/readiness 표면을 담는다 — 도메인 모듈이 아니라 운영용 모듈이다 (ADR 0031).
// 사용처: AppModule에서만 임포트한다.
// 근거: TempCleanupModule/StorageModule 선례를 그대로 따른다 — "프로세스/DB에 접근 가능한가"는 어떤 도메인 모듈도 소유하지 않는다.

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
