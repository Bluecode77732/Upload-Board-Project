// Purpose: hosts the Prometheus metrics registry and /metrics scrape endpoint — an operational module, not a domain one (ADR 0047).
// Usage: imported by AppModule for the scrape endpoint and the global HTTP-duration interceptor; also imported by FileModule/TempCleanupModule to record their own counters.
// Rationale: mirrors the HealthModule/TempCleanupModule/StorageModule precedent — cross-cutting infrastructure gets its own module rather than being bolted onto a domain module.

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';

@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  // Exported for FileModule (upload claim outcome) and TempCleanupModule (sweep count).
  exports: [MetricsService],
})
export class MetricsModule {}
