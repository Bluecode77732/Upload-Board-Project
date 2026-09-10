// 목적: 던져지는 모든 에러를 고정된 { statusCode, code, message, timestamp, path } 계약 형태로 만든다.
// 사용처: AppModule에 APP_FILTER로 한 번 등록됨; throw하는 곳들은 { code, message } HttpException 본문으로 code를 붙인다.
// 근거: Stage F 에러 코드 작업(ADR 0010/0011) — Chat-project의 필터에서 GraphQL 분기와 logger를 뺀 이식판.

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { ErrorBody, ErrorCode } from '../error-code';

// 명시적 code 없이 던져진 예외를 위한 상태 코드 기반 기본값
// (프레임워크 404, passport 401, 서드파티가 던지는 예외 등).
const FALLBACK_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  // ThrottlerException(@nestjs/throttler)은 code 없는 문자열 메시지로 던져진다 — 이
  // 항목이 없으면 429가 INTERNAL_ERROR로 잘못 표시된다(ADR 0053 도입 중 발견).
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly configService: ConfigService) {}

  // 목적: 어디서 던져지든 모든 예외를 고정된 { statusCode, code, message, timestamp, path }
  //       응답 형태로 통일한다.
  // 이유: 이 프로젝트의 에러 계약(ADR 0011)이 프론트가 { code, message }로 분기하는 것을
  //       전제하므로, 코드가 없는 프레임워크 예외(404, passport 401 등)도 예외 없이 code를
  //       채워야 한다 — 하나라도 빠지면 그 라우트만 계약을 깨는 예외가 된다.
  // 방법: HttpException이면 실제 status/본문을 읽고, 아니면 500 + 제네릭 메시지로 고정
  //       (Never Do G3 — 내부 에러 detail을 밖으로 흘리지 않음). 본문에 유효한 ErrorCode가
  //       실려 있으면 그대로 쓰고, 없으면 FALLBACK_CODES 매핑(또는 배열 message는
  //       VALIDATION_FAILED)으로 보충한다. 5xx는 스택과 함께 error 레벨로, 4xx는 debug
  //       레벨로 서버 로그에만 남긴다 — 스택은 dev 환경 응답에만 포함한다.
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status: HttpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    let code: ErrorCode | undefined;
    // HttpException이 아닌 에러는 밖으로는 제네릭 메시지만 내보낸다(Never Do Group 3).
    let message: string | string[] = 'Internal server error';

    if (typeof raw === 'string') {
      message = raw;
    } else if (typeof raw === 'object' && raw !== null) {
      const body = raw as Record<string, unknown>;
      if (
        typeof body.code === 'string' &&
        (Object.values(ErrorCode) as string[]).includes(body.code)
      ) {
        code = body.code as ErrorCode;
      }
      if (typeof body.message === 'string') {
        message = body.message;
      } else if (Array.isArray(body.message)) {
        message = body.message.filter(
          (entry): entry is string => typeof entry === 'string',
        );
      }
    }

    if (!code) {
      // 전역 ValidationPipe는 자신의 실패를 message 배열로 알린다.
      code =
        status === HttpStatus.BAD_REQUEST && Array.isArray(message)
          ? ErrorCode.VALIDATION_FAILED
          : (FALLBACK_CODES[status] ?? ErrorCode.INTERNAL_ERROR);
    }

    const isDev = this.configService.get<string>('ENV') === 'dev';
    const stack = exception instanceof Error ? exception.stack : undefined;

    const body: ErrorBody = {
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(isDev && stack ? { stack } : {}),
    };

    response.status(status).json(body);

    // 관측성(ADR 0017): 5xx는 서버 쪽 결함이므로 클라이언트에는 일부러 숨긴 stack과
    // 함께 기록한다(Never Do Group 3); 4xx는 클라이언트 쪽 에러이므로, 흔한 인증/검증
    // 실패가 로그를 뒤덮지 않도록 debug 레벨로 남긴다.
    // status/code/method/url만 로그에 남기고 — body, header, token은 절대 남기지 않는다.
    const logLine = `${status} ${code} ${request.method} ${request.url}`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logLine, stack);
    } else {
      this.logger.debug(logLine);
    }
  }
}
