// 목적: 모든 HTTP 요청의 처리 시간을 공유 Prometheus 히스토그램에 기록한다.
// 사용처: MetricsModule이 전역 APP_INTERCEPTOR로 등록한다; 컨트롤러별 사용을 의도하지 않는다.
// 근거: 전역 인터셉터 하나면 이미 모든 요청이 지나가는 지점이 되어, 각 컨트롤러에서 수동으로 시간을 재지 않아도 된다 (ADR 0047).

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  // 목적: 요청 하나의 처리 시간을 재서 히스토그램에 기록한다.
  // 이유: 경로별 응답 지연 추세는 로그 한 줄로는 볼 수 없다 — 이 인터셉터가 유일한 측정 지점이다.
  // 방법: 요청 진입 시각을 잡아두고, 응답의 'finish' 이벤트(성공·예외 필터의 에러 응답 모두 포함해 정확히
  //       한 번, 최종 상태 코드가 확정된 뒤 발생)에서 경과 시간을 method/route/status_code 라벨로 기록한다.
  //       rxjs tap의 error 콜백은 예외 필터가 아직 응답을 쓰기 전에 실행돼 상태 코드가 부정확할 수 있어 쓰지 않는다.
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    response.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metricsService.httpRequestDuration.observe(
        {
          method: request.method,
          route: this.resolveRoute(request),
          status_code: String(response.statusCode),
        },
        durationSeconds,
      );
    });

    return next.handle();
  }

  // Express는 핸들러가 매치된 뒤에야 `route`를 붙인다; 공유 Request 타입을 넓히는 대신
  // 여기서 좁게 타입을 잡는다 (Never Do Group 1 — `any` 금지).
  private resolveRoute(request: Request): string {
    const matchedPath = (request as { route?: { path?: unknown } }).route?.path;
    return typeof matchedPath === 'string' ? matchedPath : request.originalUrl;
  }
}
