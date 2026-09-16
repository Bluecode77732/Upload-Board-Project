// 목적: Prometheus 스크레이프 엔드포인트를 노출한다.
// 사용처: AppModule에서 MetricsModule을 통해 등록되며, 의도적으로 인증을 걸지 않는다 — Prometheus 스크레이프는 bearer 토큰을 갖지 않으며, HealthController와 같은 방식이다 (ADR 0031/0047).
// 근거: 이전에는 이 API가 시계열 지표를 전혀 내보내지 않았다 (ADR 0047).

import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@ApiTags('메트릭 API (Metrics API)')
@Controller('metrics')
// Prometheus는 이 엔드포인트를 고정 간격으로 영구 스크레이프한다 — 전역 요청 횟수 제한
// (ADR 0053)에 걸려 429를 받으면 그 구간의 시계열 데이터가 비게 된다.
@SkipThrottle()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  // 목적: Prometheus 스크레이프 요청에 현재 지표 스냅샷을 반환한다.
  // 이유: Prometheus는 이 엔드포인트를 주기적으로 폴링해 시계열을 쌓는다 — 인증 헤더를 붙이지 않는다.
  // 방법: 레지스트리가 실제로 쓰는 exposition Content-Type을 그대로 읽어 응답 헤더에 반영하고, 본문은 MetricsService에 위임한다.
  @Get()
  @ApiOperation({
    summary:
      'Prometheus 지표 스냅샷을 반환한다. (Return a Prometheus metrics snapshot.)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Prometheus exposition 포맷 지표 스냅샷. (Prometheus exposition-format metrics ' +
      'snapshot.)',
  })
  async getMetrics(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.set('Content-Type', this.metricsService.contentType);
    return this.metricsService.getMetrics();
  }
}
