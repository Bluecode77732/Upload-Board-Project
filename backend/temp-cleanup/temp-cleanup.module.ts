// Purpose: hosts the scheduled orphan temp-file sweep — an operational cross-cutting module, not a domain module (ADR 0018).
// Usage: imported by AppModule; owns TempCleanupService (which registers its own CronJob on init).
// Rationale: keeps UploadModule's own concern narrow to staging temp writes; the sweep is separated as its own maintenance responsibility (SRP). Imports StorageModule so the sweep works under either FileStorage adapter (ADR 0029).

import { Module } from '@nestjs/common';
import { TempCleanupService } from './temp-cleanup.service';
import { StorageModule } from 'backend/storage/storage.module';
import { MetricsModule } from 'backend/metrics/metrics.module';

@Module({
  imports: [StorageModule, MetricsModule],
  providers: [TempCleanupService],
})
export class TempCleanupModule {}
