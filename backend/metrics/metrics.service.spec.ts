import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metricsService: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    metricsService = module.get<MetricsService>(MetricsService);
  });

  describe('getMetrics', () => {
    it('exposes the registered counters and histograms in Prometheus text format', async () => {
      metricsService.uploadClaimsTotal.inc({ outcome: 'fresh' });
      metricsService.tempCleanupDeletedTotal.inc(3);
      metricsService.httpRequestDuration.observe(
        { method: 'GET', route: '/file', status_code: '200' },
        0.05,
      );

      const output = await metricsService.getMetrics();

      expect(output).toContain('upload_claims_total');
      expect(output).toContain('temp_cleanup_deleted_total 3');
      expect(output).toContain('http_request_duration_seconds');
    });
  });

  describe('contentType', () => {
    it('matches the registry it was serialized with', () => {
      expect(metricsService.contentType).toBe(
        metricsService.registry.contentType,
      );
    });
  });
});
