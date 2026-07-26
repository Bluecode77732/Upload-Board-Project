// Purpose: hosts the scheduled orphan temp-file sweep — an operational cross-cutting module, not a domain module (ADR 0018).
// Usage: imported by AppModule; owns TempCleanupService (which registers its own CronJob on init).
// Rationale: keeps UploadModule controller-only; the sweep is separated as its own maintenance responsibility (SRP).

import { Module } from '@nestjs/common';
import { TempCleanupService } from './temp-cleanup.service';

@Module({
  providers: [TempCleanupService],
})
export class TempCleanupModule {}
