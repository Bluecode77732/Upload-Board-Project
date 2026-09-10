// 목적: cascade 확인 플래그가 실제 전역 ValidationPipe 옵션을 거치고도 그대로 살아남는지 고정해 둔다.
// 사용처: 단위 테스트 — pnpm test에서 user service 스펙들과 함께 실행된다.
// 근거: 이 플래그는 되돌릴 수 없는 cascade를 지키는데, boolean 타입 필드였다면 "false"가 여기서 측정 가능하게 `true`로 바뀐다 — 그래서 이 강제 변환 자체를 검증한다 (ADR 0020).

import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { DeleteUserQueryDto } from './delete-user-query.dto';

// main.ts가 전역에 설치하는 옵션과 정확히 같다 — 로컬에서 편의상 만든 파이프라인이 아니라
// 실제 파이프라인을 테스트하는 게 이 테스트의 목적이다.
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

  // 이 DTO가 존재하는 이유가 되는 회귀 케이스다: boolean 필드였다면 implicit conversion이
  // "false"를 truthiness로 true로 캐스팅해, 호출자의 의도와 반대로 cascade가 실행된다.
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
