// Purpose: pins how the cascade confirmation flag survives the real global ValidationPipe options.
// Usage: unit test; run by pnpm test alongside the user service specs.
// Rationale: the flag guards an irreversible cascade — a boolean-typed field measurably turns "false" into `true` here, so the coercion itself is asserted (ADR 0020).

import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { DeleteUserQueryDto } from './delete-user-query.dto';

// The exact options main.ts installs globally — the point is to test that pipeline,
// not a locally convenient one.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});

const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: DeleteUserQueryDto,
  data: '',
};

describe('DeleteUserQueryDto', () => {
  it('keeps "true" intact so only an explicit confirmation cascades', async () => {
    await expect(
      pipe.transform({ deleteFiles: 'true' }, metadata),
    ).resolves.toEqual({ deleteFiles: 'true' });
  });

  // The regression this DTO exists for: as a boolean field, implicit conversion
  // truthiness-casts "false" to true and the cascade fires against the caller's intent.
  it('keeps "false" as "false" — never a truthiness cast', async () => {
    await expect(
      pipe.transform({ deleteFiles: 'false' }, metadata),
    ).resolves.toEqual({ deleteFiles: 'false' });
  });

  it('leaves the flag undefined when the query omits it', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects any other value instead of guessing', async () => {
    await expect(
      pipe.transform({ deleteFiles: 'yes' }, metadata),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ deleteFiles: '1' }, metadata),
    ).rejects.toThrow();
  });

  it('rejects an unknown query key (forbidNonWhitelisted)', async () => {
    await expect(
      pipe.transform({ deletefiles: 'true' }, metadata),
    ).rejects.toThrow();
  });
});
