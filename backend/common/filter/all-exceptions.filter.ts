// Purpose: shapes every thrown error into the frozen { statusCode, code, message, timestamp, path } contract.
// Usage: registered once as APP_FILTER in AppModule; throw sites attach codes via { code, message } HttpException bodies.
// Rationale: Stage F error-code task (ADR 0010/0011) — ported from Chat-project's filter minus its GraphQL branch and logger.

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

// Status-based defaults for exceptions thrown without an explicit code
// (framework 404s, passport 401s, third-party throws).
const FALLBACK_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
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
    // Non-HttpException errors stay generic outward (Never Do Group 3).
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
      // The global ValidationPipe reports its failures as a message array.
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

    // Observability (ADR 0017): a 5xx is a server fault — log it with the stack we
    // deliberately withhold from the client (Never Do Group 3); a 4xx is a client
    // error, logged at debug so routine auth/validation failures don't flood the log.
    // Only status/code/method/url are logged — never bodies, headers, or tokens.
    const logLine = `${status} ${code} ${request.method} ${request.url}`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logLine, stack);
    } else {
      this.logger.debug(logLine);
    }
  }
}
