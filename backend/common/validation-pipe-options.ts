// 목적: 전역 ValidationPipe의 옵션을 한 곳에 둔다.
// 사용처: app.module.ts(APP_PIPE 등록)와 delete-user-query.dto.spec.ts(단위 스펙은 DI를 못 써서 직접 파이프를 만든다)가 임포트한다.
// 근거: 같은 옵션이 main.ts·test/e2e-utils.ts·스펙에 손으로 복사돼 있어, 하나가 바뀌면 나머지가 조용히 어긋났다.

import type { ValidationPipeOptions } from '@nestjs/common';

export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
};
