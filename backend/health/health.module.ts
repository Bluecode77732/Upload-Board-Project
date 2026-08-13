// Purpose: hosts the liveness/readiness surface — an operational module, not a domain one (ADR 0031).
// Usage: imported by AppModule only.
// Rationale: mirrors the TempCleanupModule/StorageModule precedent — no domain module owns "is the process/DB reachable".

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
