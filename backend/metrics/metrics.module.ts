// 목적: Prometheus 지표 레지스트리와 /metrics 스크레이프 엔드포인트를 담는다 — 도메인 모듈이 아니라 운영용 모듈이다 (ADR 0047).
// 사용처: 스크레이프 엔드포인트와 전역 HTTP-duration 인터셉터를 위해 AppModule이 임포트하며, FileModule/TempCleanupModule도 자신의 카운터를 기록하려고 임포트한다.
// 근거: HealthModule/TempCleanupModule/StorageModule 선례를 그대로 따른다 — 여러 모듈에 걸치는 인프라는 도메인 모듈에 얹지 않고 자기 모듈을 갖는다.

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
  // FileModule(업로드 claim 결과)과 TempCleanupModule(스윕 횟수)을 위해 export한다.
  exports: [MetricsService],
})
export class MetricsModule {}
