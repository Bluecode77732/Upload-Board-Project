// Purpose: owns the process-wide Prometheus registry and the counters/histograms other modules record against.
// Usage: MetricsModule exports this; any module recording a metric imports MetricsModule and injects MetricsService.
// Rationale: prom-client needs exactly one shared Registry per process — a DI-managed service is its natural home, mirroring StorageModule's role as a cross-cutting operational dependency (ADR 0047).

import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, labeled by method, matched route, and status code.',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });

  // Outcome mirrors FileClaimResult.replayed (ADR 0019): 'fresh' is a new promotion,
  // 'replayed' is an idempotent retry hitting its own earlier success.
  readonly uploadClaimsTotal = new Counter({
    name: 'upload_claims_total',
    help: 'Upload claim resolutions, labeled by outcome (fresh promotion or idempotent replay).',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  readonly tempCleanupDeletedTotal = new Counter({
    name: 'temp_cleanup_deleted_total',
    help: 'Orphaned temp_ objects deleted by the scheduled sweep (ADR 0018).',
    registers: [this.registry],
  });

  // 목적: 프로세스 전역 Node.js 기본 지표(GC, 이벤트 루프 지연, 메모리, 파일 디스크립터 등)를 등록한다.
  // 이유: 커스텀 지표만으로는 프로세스 자체의 상태(메모리 누수, GC 압박)를 볼 수 없다.
  // 방법: prom-client의 collectDefaultMetrics를 이 서비스의 레지스트리에 바인딩해 생성 시점에 한 번만 등록한다.
  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  // Prometheus의 텍스트 exposition 포맷 버전이 레지스트리 구성에 따라 달라질 수 있어
  // 컨트롤러가 값을 하드코딩하지 않고 여기서 그대로 읽어 쓰도록 노출한다.
  get contentType(): string {
    return this.registry.contentType;
  }

  // 목적: /metrics 엔드포인트가 그대로 응답할 텍스트 페이로드를 만든다.
  // 이유: prom-client의 exposition 포맷 직렬화는 레지스트리의 책임이므로 컨트롤러가 포맷을 알 필요가 없다.
  // 방법: registry.metrics()에 위임해 Prometheus 텍스트 포맷 문자열을 반환한다.
  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
