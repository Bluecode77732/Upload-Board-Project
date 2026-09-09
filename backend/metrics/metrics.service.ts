// 목적: 프로세스 전체가 공유하는 Prometheus 레지스트리와, 다른 모듈들이 기록하는 카운터/히스토그램을 소유한다.
// 사용처: MetricsModule이 이걸 export한다; 메트릭을 기록하는 모듈은 MetricsModule을 임포트해 MetricsService를 주입받는다.
// 이유: prom-client는 프로세스당 공유 Registry가 정확히 하나여야 한다 — DI로 관리되는 서비스가 그 자연스러운 자리이며, StorageModule이 횡단 operational 의존성 역할을 하는 것과 같은 모양이다(ADR 0047).

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

  // 결과 라벨은 FileClaimResult.replayed(ADR 0019)와 같은 모양이다: 'fresh'는 새로운 promotion,
  // 'replayed'는 자기 이전 성공에 부딪힌 멱등 재시도다.
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

  // 결과 라벨은 uploadClaimsTotal과 같은 모양이다: 카운터 두 개가 아니라 라벨 하나로 구분한다.
  // 'candidate'는 dry-run을 포함해 모든 스윕 실행에서 기록되며(ADR 0051 D6) — report-first
  // 모드에서는 이 기능이 관측 가능한 신호 전부다. 'deleted'는 storage.unlink()가 실제로
  // 실행됐을 때만 기록된다.
  readonly grantedCleanupSweepTotal = new Counter({
    name: 'granted_cleanup_sweep_total',
    help: 'Orphaned granted_ objects seen by the DB-joined reclaim sweep, labeled by outcome (candidate found, vs. actually deleted) (ADR 0051).',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  // 목적: 프로세스 전역 Node.js 기본 지표(GC, 이벤트 루프 지연, 메모리, 파일 디스크립터 등)를 등록한다.
  // 이유: 커스텀 지표만으로는 프로세스 자체의 상태(메모리 누수, GC 압박)를 볼 수 없다.
  // 방법: prom-client의 collectDefaultMetrics를 이 서비스의 레지스트리에 바인딩해 생성 시점에 한 번만 등록한다.
  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  // 목적: /metrics 응답에 쓸 Content-Type 값을 노출한다.
  // 이유: Prometheus 텍스트 exposition 포맷 버전이 레지스트리 구성에 따라 달라질 수 있어
  //       컨트롤러가 문자열을 하드코딩하면 포맷이 바뀔 때 조용히 어긋난다.
  // 방법: registry.contentType을 그대로 위임 반환한다.
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
