# ADR 0054: 라우트별 요청 횟수 제한 차등화

- Status: Accepted — implemented, e2e-verified
- Date: 2026-09-10
- Amends: [ADR 0053](0053-global-rate-limiting.md)
- English: [0054-per-route-rate-limit-tuning.md](0054-per-route-rate-limit-tuning.md)

## Context

ADR 0053은 전역 기본값(모든 라우트에 `APP_GUARD`로 분당 100회)만 배포하고 세분화는
명시적으로 미뤄뒀다: "라우트별 튜닝(예: `POST /auth/signin`에 더 강한 제한)은 이 ADR의
범위 밖이며 ... 별도 후속 과제로 미룬다." 이 ADR이 그 후속 과제다.

두 라우트 그룹은 나머지 API와 위험 성격이 뚜렷이 다르다:

- `POST /auth/register`, `POST /auth/signin`, `POST /auth/token/refresh`는 ADR 0053의
  보안 점검이 지적한 "무차별 대입 공격에 무방비"인 자격 증명 확인 지점 그 자체다.
  분당 100회는 자동화된 비밀번호 시도에도 여전히 넉넉하다.
- `POST /upload/attach`는 소유권/클레임 확인(나중에 `POST /file`에서 일어남)보다 먼저,
  호출할 때마다 디스크에 파일을 쓴다(`file/temp`, `UploadService.stageTemp`). 짧은
  간격으로 반복 호출하면 파일당 100MB 상한과 무관하게 디스크를 값싸게 채울 수 있다.

`POST /auth/signout`도 같은 강한 제한 대상으로 검토했으나 제외했다: 이 엔드포인트는
`JwtAuthGuard` 뒤에 있어 이미 유효한 액세스 토큰이 있어야 호출할 수 있다. 유효한 토큰이
없는 공격자는 애초에 호출 자체가 불가능하고, 이미 토큰을 가진 사람이 반복 호출해서 얻는
것도 없다 — 자격 증명 추측 경로가 아니므로 전역 기본값(분당 100회)을 그대로 유지한다.

**구현 중 별개의 문제를 하나 더 발견했다**: ADR 0053의 `THROTTLE_ENABLED=false` 우회
장치(`test/e2e-env.ts`가 `test/app.e2e-spec.ts`의 자체 429를 막으려고만 쓰는 스위치)는
`ThrottlerModule.forRootAsync` 팩토리 안에서 `default` 쓰로틀러의 `limit`값 자체를
`Number.MAX_SAFE_INTEGER`로 부풀리는 방식으로 동작한다. 새 라우트별 제한을 추가하기 전에
설치된 `@nestjs/throttler` v6.5.0 소스
(`node_modules/@nestjs/throttler/dist/throttler.guard.js`)를 직접 읽어 확인해보니,
라우트에 붙인 `@Throttle({ default: { limit, ttl } })` 데코레이터는 그 라우트에 한해
`limit`값을 통째로 대체해버린다(`canActivate`의 `routeOrClassLimit || namedThrottler.limit`)
— 즉 자기만의 오버라이드를 가진 라우트에는 모듈 수준의 부풀리기가 애초에 적용되지
않는다. `test/app.e2e-spec.ts`의 `createUser()` 헬퍼 하나만으로도 스위트 전체에서
`POST /auth/register` + `POST /auth/signin`을 대략 85회 호출하며, 전부 하나의 인프로세스
서버·하나의 클라이언트 IP를 공유한다. 분당 5회짜리 하드코딩 오버라이드를 그대로 얹었다면
스위트 실행 중 이 한도를 넘겨 무관한 429로 깨졌을 것이다 — ADR 0053이 만든 우회 장치를
정확히 무력화하는 셈이다.

## Decision

### D1 — 자격 증명·업로드 경로에 라우트별 `@Throttle()` 오버라이드

- `backend/auth/auth.controller.ts`: `register`, `signIn`, `rotateAccessToken` 셋 다
  `@Throttle({ default: { limit: 5, ttl: 60000 } })`(분당 5회)를 붙인다. `signOut`은
  손대지 않는다 — 이유는 위 Context 참고.
- `backend/upload/upload.controller.ts`: `uploadMedia`(`POST /upload/attach`)에
  `@Throttle({ default: { limit: 15, ttl: 60000 } })`(분당 15회)를 붙인다.
- 나머지 모든 라우트는 ADR 0053의 전역 분당 100회 기본값을 그대로 유지한다 — 이 ADR은
  `GET /file`, `GET /post`, `GET /comment` 등 다른 컨트롤러를 건드리지 않는다.
- 오버라이드 대상은 문자열 `'default'`다 — ADR 0053이 `ThrottlerModule.forRootAsync`에
  등록한 바로 그(이름을 안 붙였을 때 암묵적으로 붙는) 쓰로틀러다. 별도의 이름 있는
  쓰로틀러(예: `'auth'`)를 새로 등록하지 않았다: 그렇게 하면 그 쓰로틀러가 기본적으로
  *모든* 라우트에 적용되어, 관련 없는 컨트롤러마다 `@SkipThrottle({ auth: true })`로
  일일이 빼줘야 하는 침습적인 작업이 되며 이번 작업 범위를 넘어선다. 기존 `'default'`
  항목을 라우트별로 오버라이드하는 것이 "특정 라우트만 전역 기본값과 다르게 만든다"는
  목적에 대해 라이브러리가 문서화한 방식이고, 건드리는 파일도 위 두 개뿐이다.

### D2 — `THROTTLE_ENABLED` 우회를 limit 부풀리기에서 skipIf로 이전

`backend/app.module.ts`의 `ThrottlerModule.forRootAsync` 팩토리는 이제 삼항연산자 없이
그냥 `limit: 100`을 반환하고, 모듈 수준 옵션으로
`skipIf: () => !configService.get<boolean>('THROTTLE_ENABLED')`를 함께 반환한다.

`ThrottlerModuleOptions`는 최상위(가드 전체에 적용되는) `skipIf` 옵션을 지원하며,
`ThrottlerGuard.canActivate`는 이를(`namedThrottler.skipIf || this.commonOptions.skipIf`)
그 쓰로틀러의 실효 `limit`/`ttl`을 계산하기 **전에** — 라우트별 오버라이드 조회보다도
먼저 — 평가한다. 그래서 이 우회는 `default` 쓰로틀러뿐 아니라
`@Throttle({ default: {...} })`로 오버라이드된 라우트에도 한 곳에서 일괄 적용된다 —
앞으로 추가될 오버라이드마다 `THROTTLE_ENABLED`를 따로 신경 쓸 필요가 없다.
`test/e2e-env.ts`는 그대로다 — `setupFiles`에서 `THROTTLE_ENABLED=false`를 설정하는
방식 자체는 안 바뀌었고, 그 뒤에서 동작하는 메커니즘만 바뀌었다.

## Consequences

- **라우트 두 곳만 강화, 나머지는 그대로**: `POST /auth/register`, `POST /auth/signin`,
  `POST /auth/token/refresh`는 이제 클라이언트당 분당 5회, `POST /upload/attach`는
  분당 15회로 제한된다. `POST /auth/signout`을 포함한 auth/upload 외 모든 라우트는
  ADR 0053의 분당 100회 기본값 그대로다.
- **신규 Swagger 주석 없음**: ADR 0053이 전역 가드를 걸면서도 어떤 라우트에도 `429`
  `@ApiResponse`를 추가하지 않았던 것과 일관되게, 이번에 강화한 라우트들에도 별도의
  `429` Swagger 항목을 추가하지 않는다. `RATE_LIMITED`는 라우트별이 아니라
  `ErrorCode`/`AllExceptionsFilter` 수준에서 계속 문서화된다.
- **e2e 스위트를 추측이 아니라 직접 검증**: D1+D2 적용 후 `pnpm test`(264/264)와
  `pnpm test:e2e`(76/76, 5435 포트의 `docker compose up -d db` 대상)가 모두 통과한다 —
  skipIf 수정이 D1만 있었으면 발생했을 회귀를 실제로 막는지 확인했지, 안전하다고
  가정만 하지 않았다.
- **신규 env var 없음, 스키마 변경 없음**: 운영자 입장에서 `THROTTLE_ENABLED`의 의미는
  그대로다(여전히 "e2e 스위트에서만 끄고, dev/prod에서는 항상 `true`") — 내부 구현
  방식만 바뀌었다.
- **검토 후 기각한 대안**: 이름 있는 `'auth'`/`'upload'` 쓰로틀러를 전역으로 새로
  등록(기각 — 기본적으로 모든 라우트에 적용되어 관련 없는 모든 컨트롤러에
  `@SkipThrottle`을 붙여야 함); `MAX_SAFE_INTEGER` 부풀리기 방식을 유지한 채 새
  `@Throttle()` 호출마다 `THROTTLE_ENABLED`를 따로 다시 읽기(불가능 — 데코레이터 인자는
  `ConfigModule`의 `envFilePath` 로딩보다도 먼저, 모듈 임포트 시점에 평가되는 정적
  값이라 `ConfigService`를 읽을 수 없음); `AuthController` 클래스 레벨에 `@Throttle`을
  적용(기각 — 위 Context에서 설명한 이유로 `signOut`까지 강화 대상에 함께 묶이게 됨).

### Addendum (2026-09-10) — `trust proxy` 미설정 — 리버스 프록시 뒤에서는 모든 클라이언트가 버킷 하나를 공유함

후속 논의에서 이 ADR의 라이브 검증이 다루지 않은 허점이 드러났다: `ThrottlerGuard`의
기본 `getTracker`가 키로 쓰는 `req.ip`는, 앞단에 리버스 프록시가 하나라도 있으면
실제 방문자가 아니라 Express 자신의 클라이언트-소켓 주소 해석 결과다.
`backend/main.ts`에는 `app.set('trust proxy', ...)` 호출이 없다(저장소 전체를 grep해
부재를 확인함). 이 앱은 현재 배포돼 있지 않고(AWS/EKS 스택 철거됨), `k8s/helm/`의
`Ingress`도 기본 비활성이며 `ingressClassName`은 운영자가 고르도록 값 파일에 열어둔
상태다(`values.yaml`/`templates/ingress.yaml` 확인 — 차트 자체에 ALB/nginx를 못박지
않음). 그래서 지금 당장 실제 영향은 없다. 하지만 그 `Ingress`가 어떤 리버스 프록시
앞에서든 켜지는 순간, 외부 클라이언트 전원의 `req.ip`가 그 프록시 주소 하나로
수렴해버려서, 이 ADR이 만든 클라이언트당 분당 5회(`auth`)·15회(`upload`) 버킷이
방문자 전원이 나눠 쓰는 **앱 전체 하나의** 버킷으로 무너진다 — 사람마다가 아니라
앱 전체를 통틀어 분당 로그인 시도 5회가 되는 것이다.

여기서 고치지 않고 의도적으로 미룬다 — `CLAUDE.md`의 Known Gaps(요청 횟수 제한 항목)에
추적 기록만 남긴다 — 올바른 `trust proxy` 값(홉 수 또는 명시적 프록시 IP 대역)은
`Ingress`를 실제로 켤 때 선택하는 인그레스/로드밸런서 토폴로지에 달린 속성이라,
아직 존재하지도 않는 토폴로지를 놓고 지금 숫자를 정하는 건 추측일 뿐이기 때문이다.
`Ingress`를 켜는 작업이 있을 때 함께 다시 다룬다.
