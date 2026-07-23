// Purpose: verifies the error contract — code passthrough, status fallbacks, validation arrays, dev-only stack.
// Usage: run by pnpm test; filter.ts is coverage-measured (not in coveragePathIgnorePatterns).
// Rationale: the frozen ErrorBody shape is a Stage F contract — regressions here break frontend branching.

import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ErrorCode } from '../error-code';

describe('AllExceptionsFilter', () => {
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;
  let mockConfigService: { get: jest.Mock };
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/test' }),
      }),
    } as unknown as ArgumentsHost;

    mockConfigService = { get: jest.fn().mockReturnValue('prod') };
    filter = new AllExceptionsFilter(
      mockConfigService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
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
});
