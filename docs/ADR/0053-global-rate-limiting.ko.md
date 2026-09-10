# ADR 0053: `@nestjs/throttler`를 통한 전역 요청 횟수 제한

- Status: Accepted — implemented, e2e 검증 완료
- Date: 2026-09-10
- English: [0053-global-rate-limiting.md](0053-global-rate-limiting.md)

## Context

2026-09-09 보안 점검에서 backend 어디에도 요청 횟수 제한(rate limiting)이 없다는 게
발견됐다 — `POST /auth/register`, `POST /auth/signin`(Basic 토큰 자격 증명 확인)도
예외가 아니다. 한 클라이언트가 분당 몇 번 시도할 수 있는지 막는 장치가 스택 어디에도
없어서, 자격 증명 무차별 대입 공격이 `HASH_ROUNDS`가 주는 시도당 비용 말고는 아무 제약도
받지 않는다.

이 저장소에서 횡단 관심사용 요청 가드가 제안된 건 이번이 처음이다. 기존 가드
(`JwtAuthGuard`, `RolesGuard`)는 전부 컨트롤러/메서드별 `@UseGuards(...)`로 걸려 있고
`APP_GUARD`로 전역 등록된 적이 없다 — 새로 전역 가드를 들이기 전에 이 차이부터 짚어둔다.

- 이 앱의 인증은 "기본적으로 보호하되, 의도적으로 공개된 소수의 라우트가 이미 정해져
  있는" 형태다 — `POST /auth/register`, `POST /auth/signin`,
  `POST /auth/token/refresh`(Bearer가 아니라 Basic/쿠키 기반), `GET /health/*`,
  `GET /metrics`, 그리고 `GET /file/:id/content`(`OptionalJwtAuthGuard`). `JwtAuthGuard`를
  전역으로 걸려면 이 프로젝트가 한 번도 만든 적 없는 리플렉터 기반 우회 장치
  (`@Public()` 데코레이터)가 필요한데, 이미 다 파악된 몇 개 안 되는 예외를 다시 꺼주려고
  새 추상화를 도입하는 건 배보다 배꼽이 크다 — 그래서 컨트롤러별 `@UseGuards`가 기존
  패턴과 일관되는 더 단순한 선택으로 남았다(Hallucination Prevention #3: 기존 패턴을
  재사용하고, 요청받지 않은 새 추상화는 도입하지 않는다).
- 요청 횟수 제한은 이 구도가 뒤집힌다. 이번 작업의 전제 자체가 "backend 전체에 제한이
  없다"는 것이고, 예외는 딱 두 개 — 아래에서 다룰 읽기 전용, 인증 없는 인프라
  엔드포인트뿐이다. 도메인 컨트롤러마다 `@UseGuards(ThrottlerGuard)`를 흩뿌리는 방식은
  새 컨트롤러가 생길 때마다 기억해서 붙여야 하고, 빠뜨리면 **조용히** 새어나간다 — 인증
  가드를 빠뜨리면 누군가 그 라우트를 처음 테스트하는 순간 401로 시끄럽게 드러나는 것과
  다르게, 제한 누락은 실제로 악용되기 전까지 티가 안 난다. 기본적으로 전역에 걸고 소수의
  명시적 예외만 두는 쪽이 코드도 더 적고 이 실패 양상에도 더 잘 맞는다.
- `@nestjs/throttler` 자체의 공식 권장 사용법이 바로 전역 `APP_GUARD` 등록 +
  `@SkipThrottle()`/`@Throttle()` 예외 처리다 — 이걸 그대로 쓰는 건 서드파티 모듈을
  그 저자가 설계한 방식 그대로 쓰는 것이지, 이 저장소가 만들어내는 독자 추상화가 아니다.
  Passport의 `AuthGuard`, `@nestjs/mapped-types`의 `PartialType`을 이미 같은 범주
  ("프레임워크 관용구이지 프로젝트가 만든 추상화가 아님")로 인정한 것과 같다
  (Project-Specific Principles > Sanctioned Inheritance Points).

## Decision

### D1 — `APP_GUARD`로 전역 `ThrottlerGuard`, 우선 보수적 기본값만

`backend/app.module.ts`에 `ThrottlerModule.forRootAsync`(`ttl: 60000`, `limit: 100` —
분당 100회)를 등록하고, 같은 파일의 `TypeOrmModule.forRootAsync`와 동일한
`useFactory` + `inject: [ConfigService]` 형태로 `ThrottlerGuard`를 `APP_GUARD`로 제공한다.
이 저장소 최초의 전역 가드다.

라우트별 세분화(예: `POST /auth/signin`만 더 빡빡하게)는 이번 ADR의 의도적인 범위
밖이다 — 개발자가 우선 보수적인 전역 기본값 하나만 요청했고, 라우트별 제한값은 후속
작업으로 미뤘다.

분당 100회 한도는 **앱 전체가 나눠 쓰는 하나의 풀이 아니라 라우트별로 독립적**이다 —
`ThrottlerGuard`의 기본 `generateKey`는 컨트롤러 클래스+핸들러 메서드+클라이언트 IP를
해시하므로, 같은 클라이언트의 `GET /file` 호출과 `POST /auth/signin` 호출은 완전히
독립된 두 카운터로 추적된다. 실측으로 확인했다: 인증 없는 `GET /file`을 105회 빠르게
연속 호출하니 101번째부터 `429 RATE_LIMITED`를 받았고, 같은 창 안에서 같은 클라이언트로
곧바로 `POST /auth/signin`을 호출하니 평소와 같은 `400 AUTH_INVALID_CREDENTIALS`를
받았다 — 소진된 `GET /file` 카운터와 전혀 무관했다.

### D2 — `HealthController`/`MetricsController`는 `@SkipThrottle()`로 예외 처리

두 컨트롤러 모두 클래스 레벨에 `@SkipThrottle()`을 붙였다. kubelet의 liveness/readiness
probe와 Prometheus의 스크레이프 요청은 일반 사용자 트래픽과 다르게, 파드가 떠 있는 내내
고정된 짧은 간격으로 영구히 반복되도록 설계돼 있다 — 사람이 가끔 API를 호출하는 것과는
근본적으로 다른 트래픽 형태다. 한도가 라우트별(D1)이므로 이건 애초에 무관한 다른 앱
트래픽과 공유 예산을 놓고 경쟁하는 문제가 아니다 — 다른 라우트의 호출은
`GET /health/live`의 카운터에 전혀 반영되지 않는다. 진짜 위험은 더 좁지만 실재한다:
그 라우트 자신의 반복(짧은 probe 주기, 또는 여러 replica의 트래픽이 같은 egress IP를
거쳐 들어오는 경우)만으로 그 라우트 자신의 분당 100회 한도가 소진될 수 있다는 것이다.
그 결과 구체적으로 두 가지 실패가 생길 수 있다: liveness probe가 429를 받으면 "프로세스
응답 없음"으로 오인돼 불필요한 파드 재시작이 일어나고, 스크레이프가 429를 받으면 메트릭
시계열에 구멍이 생긴다. 이 두 엔드포인트는 이미 같은 이유로 인증도 걸지 않고 있다
(`GET /health/*` — ADR 0031; `GET /metrics` — ADR 0047) — 이번 결정은 "사람이 아니라
인프라 호출자"라는 같은 예외를 요청 횟수 제한에도 그대로 확장한 것이다.

### D3 — `THROTTLE_ENABLED` env 플래그는 e2e 스위트 격리 전용이지, dev/prod를 가르는 축이 아니다

`backend/app.module.ts`의 Joi 스키마에 `THROTTLE_ENABLED`(boolean, 기본값 `true`)를
추가했다. dev와 prod는 둘 다 항상 `true`로 돈다 — 이 플래그는 dev/prod 축이 아니라
순수하게 "실제 앱"과 "e2e Jest 프로세스"를 가르기 위한 것이다. `test/app.e2e-spec.ts`는
같은 서버 인스턴스에 순차로 수백 건의 HTTP 요청을 보내는데, supertest의 인프로세스
요청은 전부 같은 loopback 클라이언트 IP로 잡히므로, override 없이는 전부 같은 스로틀
버킷을 공유해 테스트 대상과 무관한 429로 스위트가 중간에 깨진다.

NestJS의 모듈 그래프는 정적이라 설정만으로 가드 프로바이더 자체를 조건부로 뺄 수는
없다 — 그래서 `THROTTLE_ENABLED=false`는 같은 `useFactory` 안에서 `limit`을
`Number.MAX_SAFE_INTEGER`로 키워 실질적으로 우회하는 방식이다. 별도 코드 경로를 만들지
않는다. `test/e2e-env.ts`가 `setupFiles`에서 이 값을 설정한다(`AppModule` 임포트
이전 — `DB_DATABASE`를 `beforeAll`이 아니라 여기서 설정하는 것과 같은 이유), 기존
`TEMP_SWEEP_ENABLED`/`GRANTED_SWEEP_ENABLED`의 명명·on/off 관례를 그대로 따른다.

## Consequences

- **명시적으로 예외 처리되지 않은 모든 라우트가 이제 요청 횟수 제한을 받는다**,
  `POST /auth/register`/`POST /auth/signin`도 포함해서 — 보안 점검이 찾아낸 공백이
  닫혔다. 로그인 시도처럼 더 빡빡한 라우트별 제한값은 여전히 후속 작업이며, 이 ADR이
  확정한 범위가 아니다.
- **알려진 한계, 현재는 수용**: `@nestjs/throttler`의 기본 storage는 단일 인스턴스
  in-memory다. 이 앱이 언젠가 replica 2개 이상으로 배포되면 각 파드가 독립적으로
  카운트하므로, 각 라우트의 실질 한도가 replica 수만큼 느슨해진다(오늘도 이미
  인스턴스별로 그렇고, 여기에 replica별로 한 번 더 겹친다). Redis 기반
  `ThrottlerStorage` 구현이 이 한계를 없애지만 새 인프라 의존성을 추가하는 일이라 이번
  작업 범위 밖이다 — 실제로 다중 replica를 운영하게 되면(현재는 아니다; ROADMAP.md
  §9의 AWS/EKS 스택은 2026-08-28자로 헐어낸 상태다) 재검토 대상이다.
- **Guard impact**: 이제 `ThrottlerGuard`가 `GET /health/live`, `GET /health/ready`,
  `GET /metrics`를 제외한 앱의 모든 라우트에서 동작한다. 기존 `JwtAuthGuard`/
  `RolesGuard` 커버리지는 변경 없음 — 이 가드는 그것들을 대체하지 않고 나란히 돈다.
- **새 env var**: `THROTTLE_ENABLED`(Joi + `.env.example`, 기본값 `true`). `process.env`로
  직접 읽지 않고 `app.module.ts`의 factory 안에서 `ConfigService`로만 읽는다.
- **고려했으나 기각한 대안**: 컨트롤러별 `@UseGuards(ThrottlerGuard)`(D1의 근거 참고);
  Redis 기반 storage 즉시 도입(새 의존성, 현재 이를 정당화할 다중 replica 배포가 없음);
  `test/e2e-env.ts`에서 이름 있는 `THROTTLE_ENABLED` 대신 `limit`만 직접 override(기각 —
  전용 플래그가 의도를 더 명확히 드러내고 기존 `*_ENABLED` 명명 관례와 일치).
- **검증 완료**: `pnpm lint`(clean), `pnpm test`(263/263), `pnpm test:e2e`(76/76,
  `docker compose up -d db`의 5435 포트 대상)가 모두 통과했다 — 아래 Addendum 참고.

### Addendum (2026-09-10) — 실행 중인 dev 서버에 실제로 429를 발생시켜 확인; 한도 범위에 대한 잘못된 이해도 바로잡음

이전 검증(단위 테스트, `THROTTLE_ENABLED=false`로 돌린 e2e)은 실제로 제한이 켜진
채로 HTTP를 통해 진짜 429를 한 번도 발생시킨 적이 없었다. 그 구멍을 메워달라는
요청을 받고: 같은 `docker compose db`를 대상으로 `pnpm run start:dev`를 실제
(e2e 아닌) env로 띄웠다 — `THROTTLE_ENABLED`를 설정하지 않아 진짜 기본값 `true`가
적용됐다 — 그리고 인증 없는 `GET /file`을 105회 빠르게 연속 호출했다. 1~100번째
요청은 `401 AUTH_UNAUTHORIZED`(토큰 없음; `ThrottlerGuard`는 통과시켜 `JwtAuthGuard`
까지 갔다)를, 101~105번째는 `429 RATE_LIMITED`를 받아, 한도 자체와 앞선
`FALLBACK_CODES` 수정 둘 다를 구성된 예외 객체가 아니라 실제 요청/응답 사이클로
확인했다.

이걸 설명하던 중, 이 ADR 자신의 본문(과 CLAUDE.md/ARCHITECTURE.md에 옮겨둔 사본)이
메커니즘을 잘못 서술하고 있다는 게 드러났다: 여러 문단이 health/metrics 예외를
"다른 앱 트래픽과 같은 IP 기준 예산을 *공유*하는 걸 피하려는 것"으로 서술하고
있었다. 방금 `GET /file`에서 429를 받은 것과 같은 스로틀 창 안에서, 같은 클라이언트로
곧바로 `POST /auth/signin`을 호출하니 429가 아니라 평소와 같은
`400 AUTH_INVALID_CREDENTIALS`를 받았다 — 이 서술과 모순됐고, `ThrottlerGuard`의
실제 `generateKey`(`node_modules/@nestjs/throttler/dist/throttler.guard.js`)를 읽게
만들었다: 키는 `sha256(컨트롤러클래스-핸들러메서드-throttlerName-클라이언트IP)`라서,
모든 라우트/핸들러 쌍이 클라이언트별로 **독립된** 카운터를 추적한다 — 앱 전체가 쓰는
풀 하나가 아니다. 위 D1·D2, 그리고 CLAUDE.md/ARCHITECTURE.md에 옮겨둔 같은 내용을
"health/metrics 예외는 그 라우트 자신의 반복이 자신의 카운터를 소진시킬 수 있기
때문"이라는 서술로 정정했다 — "원래 무관한 트래픽과 경쟁하고 있었기 때문"이 아니다.
가드 등록 자체나 분당 100회라는 값은 바뀌지 않았고, 예외가 왜 필요한지에 대한
설명의 정확성만 바로잡은 것이다.

### Addendum (2026-09-10) — 429 응답이 `INTERNAL_ERROR`로 잘못 표시되던 문제, 수정

"관련 문서를 더 손볼 필요가 있는지" 조사하다가, 이 ADR 자체의 구현이 만든 실제 결함을
발견했다: `@nestjs/throttler`의 `ThrottlerException`은 `code` 필드 없이 프레임워크가
직접 던지는 `HttpException(문자열, 429)`인데, `AllExceptionsFilter`의 `FALLBACK_CODES`
맵(`backend/common/filter/all-exceptions.filter.ts`)에 `HttpStatus.TOO_MANY_REQUESTS`
항목이 없었다 — 그래서 모든 429가 `ErrorCode.INTERNAL_ERROR`로 떨어져, 클라이언트 쪽
과다 요청 거부를 서버 결함으로 잘못 보고했고, ADR 0011의 동결된 `{ code, message }`
계약이 이 상태 코드에 한해 처음으로 깨진 셈이었다.

Multer가 프레임워크에서 직접 던지는 413을 `PAYLOAD_TOO_LARGE`로 이미 커버하던 것과 같은
방식으로 고쳤다: `ErrorCode`에 `RATE_LIMITED`(`backend/common/error-code.ts`)를 추가하고,
`FALLBACK_CODES`에 `[HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED`를 추가했다.
실제 `ThrottlerException`을 만들어 검증하는 새 스펙 케이스
(`all-exceptions.filter.spec.ts`)로 고정했다 — 단위 테스트 264/264 통과. `ErrorCode`
enum에 항목을 추가한 것이지 이름 변경이나 제거가 아니므로 ADR 0011("추가는 자유롭다")
아래 자유롭게 허용된다.

**Frontend 미러 — 명시적 확인 후 동기화 완료**: `frontend/src/api/errorCodes.ts`가 이
enum을 손으로 미러링하고 있고(아직 공유 codegen 없음), `frontend/CLAUDE.md`는 백엔드
계약이 바뀌면 "같은 변경에서" 그 미러를 동기화하라고 명시한다. backend 범위 작업의 파일
경계를 벗어나는 편집이라(root `CLAUDE.md`: "backend 작업에서 frontend 파일을 편집하지
않는다, 그 반대도 마찬가지") 조용히 진행하지 않고 개발자에게 먼저 확인받았다.
`errorCodes.ts`에 `RATE_LIMITED`를 추가했고, `frontend/docs/API-CONTRACT.md`(+`.ko.md`)에
모든 라우트가 이제 `429 RATE_LIMITED`를 반환할 수 있다는 것과 — 현재 앱 어디에도 전용
UI 메시지가 없어 각 호출부의 기존 일반 에러 표시로 흘러간다는 것을 적었다. `frontend/`의
`pnpm build`/`pnpm lint` 모두 통과. `admin/`도 확인했다 — 닫힌 enum 미러가 없고(역할
변경 에러 하나에서만 `code`로 분기) 이 결함이 적용되지 않는다.

### Addendum (2026-09-10) — 실제 DB 대상 e2e 실행으로 확인

최초 구현 세션에서는 Docker Desktop을 쓸 수 없어(엔진 연결 불가) D3의 429 회피 주장이
설계 단계에만 머물러 있었다. Docker를 켠 뒤 `docker compose up -d db`로 기존
`postgres:16` 컨테이너를 5435 포트에 띄우고 `pnpm test:e2e`를 돌리니
`test/app.e2e-spec.ts`의 76개 케이스가 전부 깔끔하게 통과했다 — 429도, `THROTTLE_ENABLED`
관련 실패도 없었다. `test/e2e-env.ts`의 override가 이 스위트의 수백 건짜리 실행에서
전역 분당 100회 기본값을 실제로 무력화한다는 게 설계상이 아니라 실측으로 확인됐다.
