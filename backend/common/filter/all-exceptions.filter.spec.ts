// 목적: 에러 계약 — code 전달, 상태 코드 폴백, validation 배열, dev 전용 stack을 검증한다.
// 사용처: pnpm test로 실행됨; filter.ts는 커버리지 측정 대상이다(coveragePathIgnorePatterns에 없음).
// 근거: 고정된 ErrorBody 형태는 Stage F 계약이다 — 여기서 회귀가 생기면 프론트엔드 분기가 깨진다.

import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ErrorCode } from '../error-code';

describe('AllExceptionsFilter', () => {
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;
  let mockConfigService: { get: jest.Mock };
  let filter: AllExceptionsFilter;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/test', method: 'GET' }),
      }),
    } as unknown as ArgumentsHost;

    // 필터 자체의 로깅은 잠재우고, 테스트에서 그 호출을 직접 검증한다.
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    mockConfigService = { get: jest.fn().mockReturnValue('prod') };
    filter = new AllExceptionsFilter(
      mockConfigService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should pass through an explicit code and message', () => {
    filter.catch(
      new BadRequestException({
        code: ErrorCode.FILE_TITLE_TAKEN,
        message: 'Title already in use.',
      }),
      mockHost,
    );

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: ErrorCode.FILE_TITLE_TAKEN,
        message: 'Title already in use.',
        path: '/test',
      }),
    );
  });

  it('should fall back to a status-based code for plain exceptions', () => {
    filter.catch(new NotFoundException('No file found.'), mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: ErrorCode.NOT_FOUND,
        message: 'No file found.',
      }),
    );
  });

  it('should map bare 401s to AUTH_UNAUTHORIZED', () => {
    filter.catch(new UnauthorizedException(), mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: ErrorCode.AUTH_UNAUTHORIZED,
      }),
    );
  });

  it('should map 413 to PAYLOAD_TOO_LARGE', () => {
    filter.catch(new PayloadTooLargeException(), mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        code: ErrorCode.PAYLOAD_TOO_LARGE,
      }),
    );
  });

  it('should map 429 (ThrottlerException) to RATE_LIMITED, not INTERNAL_ERROR', () => {
    filter.catch(new ThrottlerException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(429);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        code: ErrorCode.RATE_LIMITED,
      }),
    );
  });

  it('should label ValidationPipe message arrays as VALIDATION_FAILED', () => {
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['take must not be less than 1'],
        error: 'Bad Request',
      }),
      mockHost,
    );

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.VALIDATION_FAILED,
        message: ['take must not be less than 1'],
      }),
    );
  });

  it('should keep non-HttpException errors generic without a stack in prod', () => {
    filter.catch(new Error('sensitive internals'), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(500);
    const body = (mockJson.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.message).toBe('Internal server error');
    expect(body.stack).toBeUndefined();
  });

  it('should include the stack only when ENV=dev', () => {
    mockConfigService.get.mockReturnValue('dev');

    filter.catch(new Error('boom'), mockHost);

    const body = (mockJson.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(typeof body.stack).toBe('string');
  });

  it('should log a 5xx at error with the stack (kept out of the response)', () => {
    filter.catch(new Error('boom'), mockHost);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalled();
    // 응답에서 뺀 stack은 logger.error의 두 번째 인자로 넘어간다 — 서버 쪽에만 기록된다.
    const stackArg = (errorSpy.mock.calls[0] as unknown[])[1];
    expect(typeof stackArg).toBe('string');
  });

  it('should log a 4xx at debug, never at error', () => {
    filter.catch(new NotFoundException('No file found.'), mockHost);

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
