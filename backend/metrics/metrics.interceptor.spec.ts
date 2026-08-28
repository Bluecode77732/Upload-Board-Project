import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { EventEmitter } from 'events';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  let metricsService: MetricsService;

  beforeEach(() => {
    metricsService = new MetricsService();
    interceptor = new MetricsInterceptor(metricsService);
  });

  // A bare EventEmitter stands in for Express's Response — only `.on('finish', ...)`
  // and `.statusCode` are used by the interceptor.
  function buildResponse(statusCode: number) {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
    };
    response.statusCode = statusCode;
    return response;
  }

  function buildContext(request: object, response: object): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  }

  const nextHandler: CallHandler = { handle: () => of('ok') };

  it('records the request duration once the response finishes, using the matched route', (done) => {
    const observeSpy = jest.spyOn(
      metricsService.httpRequestDuration,
      'observe',
    );
    const request = {
      method: 'GET',
      route: { path: '/file/:id' },
      originalUrl: '/file/1',
    };
    const response = buildResponse(200);

    interceptor
      .intercept(buildContext(request, response), nextHandler)
      .subscribe(() => {
        response.emit('finish');

        expect(observeSpy).toHaveBeenCalledWith(
          { method: 'GET', route: '/file/:id', status_code: '200' },
          expect.any(Number),
        );
        done();
      });
  });

  it('falls back to the raw URL when no route matched yet', (done) => {
    const observeSpy = jest.spyOn(
      metricsService.httpRequestDuration,
      'observe',
    );
    const request = { method: 'GET', originalUrl: '/unknown' };
    const response = buildResponse(404);

    interceptor
      .intercept(buildContext(request, response), nextHandler)
      .subscribe(() => {
        response.emit('finish');

        expect(observeSpy).toHaveBeenCalledWith(
          { method: 'GET', route: '/unknown', status_code: '404' },
          expect.any(Number),
        );
        done();
      });
  });
});
