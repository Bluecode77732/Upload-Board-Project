// Purpose: exposes liveness/readiness endpoints for load-balancer and orchestrator probes.
// Usage: registered via HealthModule in AppModule; deliberately unauthenticated — probes carry no bearer token.
// Rationale: ADR 0031 — nothing in this API could previously signal "process up" or "safe to route traffic to".

import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // 목적: 프로세스가 HTTP 요청에 응답할 수 있는 상태인지 알린다(liveness).
  // 이유: 오케스트레이터/Docker HEALTHCHECK가 이 응답 없이는 컨테이너를 재시작해야 할지 판단할 수 없다.
  // 방법: 의존성 확인 없이 즉시 200을 반환한다 — DB 등 외부 상태가 잠깐 흔들려도 재시작 루프를 유발하지 않는다(ADR 0031).
  @Get('live')
  @ApiResponse({ status: 200, description: 'Process is running.' })
  live() {
    return { status: 'ok' };
  }

  // 목적: 트래픽을 받아도 되는 상태인지 알린다(readiness) — DB 연결 확인 포함.
  // 이유: DB가 끊긴 상태에서도 liveness만으로 트래픽을 계속 보내면 매 요청이 개별적으로 실패한다.
  // 방법: HealthService에 DB ping을 위임하고, 실패 시 503으로 변환해 오케스트레이터가 이 인스턴스로의 라우팅을 멈추게 한다.
  @Get('ready')
  @ApiResponse({ status: 200, description: 'Ready to receive traffic.' })
  @ApiResponse({ status: 503, description: 'A dependency is unreachable.' })
  async ready() {
    const isReady = await this.healthService.checkDatabase();
    if (!isReady) {
      throw new ServiceUnavailableException('Dependency check failed.');
    }

    return { status: 'ok' };
  }
}
