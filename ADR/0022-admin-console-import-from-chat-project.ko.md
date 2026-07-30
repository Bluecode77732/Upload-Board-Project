# ADR 0022: Chat Project에서 가져온 admin 콘솔 — 수정 기반으로서의 이식

- 상태: 승인됨
- 날짜: 2026-07-30
- 개정 대상: [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md) (admin 배치 조항에 한정)
- 관련: [ADR 0013](0013-rbac-and-audit-log.ko.md) (그 역할 계층을 운영하기 위한 화면이 이것이다)
- English: [0022-admin-console-import-from-chat-project.md](0022-admin-console-import-from-chat-project.md)

## 맥락

이 시점에 두 가지 전제 조건이 동시에 갖춰졌다.

**RBAC은 역할 계층을 만들었지만, 그것을 운영할 수단은 만들지 않았다.** RBAC과 감사 로그가
2026-07-25에 도입됐다([ADR 0013](0013-rbac-and-audit-log.ko.md)) — `ROLE_RANK` 순위를 가진
3단계 역할 체계, `RolesGuard`/`@Roles`, admin 전용 `GET /user`, superadmin 전용
`PATCH /user/:id/role`, 그리고 추가 전용(append-only) `GET /audit-log`. 그 ADR은 스스로
이렇게 끝맺으며 빈 구멍을 남겼다 — "역할 체계는 프론트엔드 `/admin` 구역을 받을 준비가 됐고,
전용 admin 앱으로의 승격은 ADR 0010의 향후 결정으로 남는다". 이 ADR이 바로 그 결정이다.

"운영할 수단이 없다"가 구체적으로 무엇인지, 코드로 확인한 내용:

| 역할 계층 기능 | 백엔드 메커니즘 | 운영 화면 |
|---|---|---|
| 첫 superadmin 부트스트랩 | `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts`가 부팅 시 승격 — 요청으로는 만들 수 없으므로 **유일한** 경로 | 부팅 시점 환경변수뿐 |
| 사용자 승격/강등 | `PATCH /user/:id/role`, superadmin 전용, 행 잠금이 걸린 SERIALIZABLE 트랜잭션 | **없음** — 직접 HTTP 요청 또는 Swagger `/doc` |
| 누가 어떤 역할인지 확인 | `GET /user`, admin 전용 | **없음** — 페이지네이션 없는 JSON |
| 강등이 실제로 적용됐는지 확인 | `updateRole`이 `refreshTokenHash`를 null로 만들어 대상 세션을 즉시 끊는다 | **없음** — 운영자에게 보이지 않는다 |
| 역할 체계를 잠가버리는 실수 방지 | 마지막 superadmin 강등을 거부 — 400 `AUTH_LAST_SUPERADMIN` | **없음** — 부딪혀 보고서야 알게 되는 불변식 |
| 누가 누구의 역할을 바꿨는지 감사 | 추가 전용 감사 로그의 `ROLE_CHANGE` 행, 주 커밋 이후 기록 | **없음** — `GET /audit-log`를 볼 화면이 없다 |

각 행의 오른쪽 열이 이번 이식의 실제 요구사항이다. 권한 계층을 손으로 조립한 `PATCH` 요청으로
관리하는 것은 단순히 불편한 수준이 아니다. 계층을 지키는 두 불변식(마지막 superadmin 거부,
강등 시 세션 종료)이 바로, 그것을 드러내주는 화면 없이는 운영자가 볼 수 없는 것들이다.
[ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md)은 admin을 독립 애플리케이션으로
승격하는 판단을 정확히 이 조건에 걸어뒀다 — "RBAC이 도입되고 **실제 admin 요구사항이 생긴**
뒤에야 재검토한다". 역할 체계가 없는 상태에서 3분할을 하면 "백엔드가 구분조차 못 하는 앱을
내놓는 셈"이기 때문이었다. 이제 그 조건의 양쪽이 모두 충족됐다.

**그리고 같은 역할 계층을 위한 콘솔이 이미 존재한다 — 다른 프로젝트에.** 저자의 다른
프로젝트인 **Chat Project**(NestJS + GraphQL + Redis + Socket.IO)에는, 여기
[ADR 0013](0013-rbac-and-audit-log.ko.md)이 채택한 것과 같은 3단계
`user`/`admin`/`superadmin` 설계를 대상으로 만들어 검증까지 끝낸 admin 콘솔이 있다. 실제로
ROADMAP은 이 프로젝트의 RBAC 설계를 "Chat-project style"로 기록해 뒀으니, 그 콘솔은 위 표가
서술하는 바로 그 계층 모델을 위해 작성된 것이다. 이 점이 결정적이다: 이것은 우연히 재사용
가능한 범용 골격이 아니라, **이 프로젝트가 이미 구현한 계층을 관리하는 역할 계층 콘솔**이다.
사용자 페이지가 역할 컬럼, 역할 배정 동작, 사용자별 상세 패널, 사용자별 감사 로그 조각을
중심으로 구성돼 있다 — 위 빈 구멍 표의 각 행에 대응하는 컨트롤이 하나씩 있는 셈이다. 그와
더불어 **도메인과 무관한 골격**도 함께 들어온다 — 관리 대상이 채팅방이든 업로드된 파일이든
똑같이 필요한 부분이다.

| 이식된 자산 | 내용 |
|---|---|
| `src/App.tsx`, `src/main.tsx` | React Router 7 셸, 라우트 테이블, 엔트리 포인트 |
| `src/components/protected-route.tsx` | 라우트 가드: 무음 갱신 부트스트랩 + 역할 등급 게이트 |
| `src/store/auth.store.ts` | Zustand 인증 스토어(액세스 토큰은 메모리에만, 영속화 없음) |
| `src/auth/session-guard.ts` | 단일 비행(single-flight) 무음 갱신 + 멀티탭 세션 충돌 감지 |
| `src/api/axios.ts` | Bearer 요청 인터셉터 + 401 1회 재시도 응답 인터셉터 |
| `e2e/`, `playwright.config.ts` | Playwright 하네스와 superadmin 시딩 스크립트 |
| `src/test/setup.ts`, `vite.config.ts`, `eslint.config.js`, `tsconfig*.json`, Tailwind | Vitest/jsdom, 빌드, 린트, 스타일 설정 |

**여기서 절약하려는 비용은 명시적이고 경제적인 것이다 — 바로 LLM 토큰 사용량이다.** 이
골격을 이 저장소에서 프롬프트로 하나씩 다시 생성하면, 형태가 이미 확정되고 다른 코드베이스에서
검증까지 끝난 코드를 만들어내는 데 상당한 토큰을 쓰게 된다. 폴더를 그대로 가져와 고치면 토큰은
차이나는 부분 — 이 프로젝트 API에 진짜로 특수한 부분 — 에만 쓴다. 이것이 "admin 콘솔을
만든다"는 작업이 아니라 이 ADR이 존재하는 이유 전부다.

이 ADR은 *이식 사실, 두 가지 목적, 그리고 그 출처*를 기록한다. 코드를 적응시키는 일은
의도적으로 하지 **않는다**.

## 결정

**Chat Project의 admin 콘솔을 최상위 `admin/` 폴더로 이 저장소에 통째로 가져오고, 수정하지 않은
상태로 커밋한다. 이것은 명시적으로 선언된 수정 기반이며, 동작하는 코드가 아니다.**

**두 가지 목적을 명시하며, 둘 다 실제로 무게를 지탱한다.** 어느 하나만으로는 근거가 약했을
것이고, 둘이 함께여야 다른 대안들 대신 이 특정 이식이 선택된다.

1. **사용자 권한 계층 관리** — [ADR 0013](0013-rbac-and-audit-log.ko.md)의 RBAC이 만들지 않고
   남겨둔 운영 화면을 공급한다: 누가 어떤 역할인지 조회, `PATCH /user/:id/role`을 통한 승격·강등,
   그리고 `ROLE_CHANGE` 감사 기록 열람. 이것이 *요구사항*이며, admin 콘솔이 애초에 필요한 이유다.
2. **토큰 절약** — 그 요구사항을 충족하는 방법으로, 같은 3단계 계층을 위해 이미 작성된 콘솔을
   프롬프트로 새로 생성하는 대신 가져온다. 이것이 *수단*이며, 콘솔이 새 코드가 아니라 사본으로
   도착한 이유다.

1. **출처는 문서화하며, 절대 감추지 않는다.** `admin/`은 다른 프로젝트 애플리케이션의 사본이다.
   전용 적응 작업이 다시 쓸 때까지, 그 안의 모든 파일은 이 프로젝트가 아니라 **Chat Project의**
   API와 도메인을 서술한다. `admin/README.md`가 폴더 현장에서 이 사실을 밝히므로, ADR을 읽지 않고
   그 폴더에 들어온 사람도 이것을 이 프로젝트의 동작하는 admin 클라이언트로 오해할 수 없다.
2. **지금은 그대로 커밋하고, 적응은 나중에 한다.** 이 변경은 폴더와 그 주변 문서를 추가하며,
   이식된 소스는 한 줄도 건드리지 않는다. 적응은 [CLAUDE.md](../CLAUDE.md) > 범위 준수에 따라
   별도의 전용 작업이며, 위 백로그가 그 작업 지시서 역할을 한다. 이식본을 한 커밋에서 원본 그대로
   유지하는 것이 나중 diff를 읽을 수 있게 만드는 장치다 — 적응 작업이 "Chat → Upload Board"로
   드러나고, 이식 자체와 뒤엉키지 않는다.
3. **어디에도 연결하지 않는다.** `admin/`은 루트 도구 체계 전부의 바깥에 있다 — 린트 glob
   (`{backend,apps,libs,test}/**/*.ts`), Jest `roots`(`["backend"]`), `tsconfig.build.json`,
   `docker-compose.yml`, CI 워크플로 모두. 자체 `package.json`, 자체 `node_modules`, 자체
   eslint/vitest/playwright 설정을 갖는다. 이것은 pnpm 워크스페이스 모노레포가 **아니며**,
   [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md)에서 `frontend/`가 세운 비워크스페이스
   선례와 같다. 따라서 루트의 `pnpm lint`, `pnpm test`, `pnpm test:e2e`는 `admin/` 안의 어떤 것에도
   영향받지 않는다 — 이 저장소 규칙을 위반하는 코드가 있더라도 마찬가지다.
4. **이 ADR은 [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md)의 admin 배치 조항만
   개정한다.** admin은 이제 `frontend/` 안의 `/admin` 라우트 구역이 아니라 **`admin/`의 독립
   애플리케이션**으로 출발한다. API 표면 동결, RBAC 후순위 배치, 저장소 내 비워크스페이스 구조,
   정적 서빙 제약은 전부 그대로다.
5. **당장은 admin 화면이 두 개 공존하며, 이는 잠정 상태다.** ADR 0010의 라우트 구역인
   `frontend/src/features/admin/AdminPage.tsx`가 아직 남아 있다. 둘 중 무엇이 살아남을지는
   여기서 정하지 않고 **미결 사항**으로 ROADMAP > 미예정 항목에 기록한다. 이식된 콘솔에서
   실제로 남길 가치가 있는 부분이 얼마나 되는지는 적응 작업을 해봐야 드러나기 때문이다.
6. **이것은 [잔재 제거 계획](../CHAT-REMNANT-REMOVAL-PLAN.ko.md)이 말하는 chat 잔재가 아니라,
   더 엄격한 조건이 붙은 버킷 4(의도적 설계 참조)다.** 그 계획의 버킷 4는 chat 프로젝트를 설계
   출처로 인용하는 것을 허용하되 "다른 프로젝트에 대한 참조로 표현되어야 하고, 이 저장소의 현재
   상태를 서술하는 것처럼 쓰여선 안 된다"는 조건을 단다. `admin/`은 산문 인용이 아니라 *코드*이므로,
   그 조건은 문장 표현이 아니라 이 ADR과 `admin/README.md`가 짊어진다. 둘 다 이 폴더가 Chat
   Project의 API를 대상으로 한다는 사실을 계속 분명히 말해야 한다. 그 계획의 재검증 트리거
   — "다른 프로젝트에서 내용을 붙여 넣었을 때" — 는 이번 이식으로 발동했고, 그쪽에 기록했다.

## 왜 직접 만들지 않고 가져왔는가

| 기준 | A. Chat admin 이식 후 수정 (**선택**) | B. `frontend/`에 `/admin` 구역을 새로 구현 | C. 독립 admin 앱을 새로 구현 |
|---|---|---|---|
| 토큰 비용 | **최저** — API 차이분에만 지출 | 높음 — 라우터·가드·스토어·갱신·e2e 하네스를 재생성 | 최고 — B 전체 + 두 번째 앱 도구 체계 |
| 역할 계층 화면 | **같은 3단계 모델을 위해 이미 작성돼 있음** — 역할 컬럼, 배정 컨트롤, 감사 조각 | ADR 0013을 보고 처음부터 설계 | ADR 0013을 보고 처음부터 설계 |
| 골격 재사용 | 전부(라우터, 가드, 인증 스토어, 단일 비행 갱신, Playwright 하네스) | 일부 — `frontend/`의 기존 인증 배관을 재사용 | 없음 |
| 잘못된 API를 겨냥한 코드 위험 | **높음 — 이 선택의 결정적 비용** | 없음 | 없음 |
| ADR 0010 원문과의 정합성 | 위 개정이 필요 | 정확히 부합 | 위 개정이 필요 |
| 리뷰 부담 | 이후 적응 작업 한 곳에 집중 | 일반 리뷰에 분산 | 일반 리뷰에 분산 |

A안은 명시한 두 목적에서 동시에 이긴다 — 토큰이 가장 싸고, 이 역할 계층을 위해 이미 만들어진
콘솔에서 출발하는 유일한 선택지다 — 그리고 정확히 하나의 기준에서 진다: 잘못된 API를 겨냥한
이식 코드라는 점이다. 그 위험을 얼버무리지 않는다. 검증을 거쳐 문서화한 백로그(다음 절)로
전환하고, 결정 3(어디에도 연결하지 않음)으로 격리한다. 그래서 실패 양상은 항상 "이 폴더가
아직 동작하지 않는다"이며, "백엔드가 이상하게 동작한다"가 될 수 없다.

## 이미 맞물리는 부분 — 적응은 역할 계층 관리에서 시작한다

이식본이 전부 똑같이 틀린 것은 아니다. **역할 관리 조각은 이 API에 실제로 존재하는 라우트를
향한다**. 두 프로젝트가 같은 계층을 구현했기 때문에 따라온 직접적 결과다. 2026-07-30에
`backend/`를 확인해 작성했다.

| 이식 코드의 호출 | 이 프로젝트의 라우트 | 상태 |
|---|---|---|
| `api.patch('/user/:id/role', { role })` | `PATCH /user/:id/role` — superadmin 전용([ADR 0013](0013-rbac-and-audit-log.ko.md)) | **라우트 일치**. 본문 인코딩은 불일치(백로그 참조) |
| `api.get('/user', …)` | `GET /user` — admin 전용 | **라우트 일치**. 쿼리 파라미터는 무시되고 응답에 페이지네이션이 없다 |
| `api.get('/user/:id')` | `GET /user/:id` | **라우트 일치**. `nickname`/`status`/`bannedUntil` 필드는 여기 없다 |
| `api.delete('/user/:id')` | `DELETE /user/:id` ([ADR 0020](0020-account-deletion-cascade.ko.md)) | **라우트 일치**. `?deleteFiles=true` 확인 절차가 빠졌다 |
| `api.get('/audit-log', …)` | `GET /audit-log` — admin 전용, 추가 전용 | **라우트 일치**. 필터 집합이 다르고 `/export`는 없다 |
| `api.post('/auth/signin', …)` (Basic) | `POST /auth/signin` — Basic 토큰([ADR 0001](0001-basic-token-authentication.ko.md)) | **일치** — 정규 로그인 경로 |
| 역할 등급 `0 / 1 / 2` (`ROLE_LABEL`) | `ROLE_RANK` = `user: 0, admin: 1, superadmin: 2` | **등급이 완전히 동일** — 계층 모델이 그대로 이전된다 |

이와 대비되는 것이 `rooms-page.tsx`, 접속/닉네임 위젯, Apollo 계층이다. 이쪽은 대응물이 아예
없다. 작업 순서에 주는 실질적 결론: **적응은 역할 관리 조각에서 시작한다.** 그쪽은 재설계가
아니라 라우트 수준 교정으로 끝나고, 채팅 도메인 페이지는 재작성이 아니라 삭제다. 골격만
가져오는 것보다 콘솔 전체를 가져오는 편이 더 값어치가 있었던 이유가 이 순서다.

계층의 *모델*은 이전되지만, 그 *인코딩*과 *가드 규칙*은 이전되지 않는다. 아래 백로그의 앞쪽
행들이 바로 그것이다.

## 수정 백로그 — `admin/`이 동작하기 전에 바꿔야 할 것

2026-07-30에 이 저장소 코드를 직접 확인해 작성했으며, 추측이 아니다. 각 행은 *이 프로젝트를
기준으로 한* 결함이며, Chat Project에서는 모두 올바른 코드였다.

| 영역 | 이식 코드가 기대하는 것(Chat Project) | 이 프로젝트의 실제 | 필요한 변경 |
|---|---|---|---|
| 전송 계층 | `${VITE_API_URL}/graphql`을 향한 Apollo Client — `src/api/apollo.ts`, `src/api/graphql-operations.ts`, 그리고 `dashboard-page`·`rooms-page`·`logs-page`의 Apollo `useQuery`/`useMutation` | **REST 전용이며 `/graphql` 라우트가 없다**([ADR 0009](0009-rest-only-api-with-swagger.ko.md)) | Apollo 계층을 삭제하고 모든 조회를 `src/api/axios.ts`로 통일 |
| 갱신 라우트 | `POST /auth/token/refreshaccess` (`src/auth/session-guard.ts`) | `POST /auth/token/refresh` ([ADR 0012](0012-refresh-cookie-rotation.ko.md), ADR 0010에서 동결) | 경로명 수정 |
| 로그아웃 라우트 | `POST /auth/signOut` (네 페이지 전부) | `POST /auth/signout` (소문자) | 대소문자 수정 |
| 전송되는 역할 인코딩 | `role: number`. `{ role: 1 }`을 보내고 `ROLE_LABEL: Record<number, string>`으로 라벨을 만든다 | `UserRole` **문자열 enum**. `UpdateRoleDto`가 `@IsEnum(UserRole)`로 검증한다 | `1`이 아니라 `'admin'`을 보내야 한다 — 숫자 본문은 경계에서 400 `VALIDATION_FAILED`로 거절된다. **등급 자체는 이미 맞다**(0/1/2가 `ROLE_RANK`와 동일). 틀린 것은 인코딩뿐이다 |
| 역할 출처 | `jwtDecode<{ sub, role }>(accessToken)` — 액세스 토큰에서 `role`을 읽는다 | 액세스 토큰 페이로드는 `{ sub, type }`이며 **`role` 클레임이 없다**(`auth.service.ts`의 `issueToken`) | `role`을 디코딩이 아니라 조회로 얻어야 한다(예: `GET /user/:id`). 그때까지 가드는 `undefined`를 보고 모든 admin을 거부한다. **먼저 백엔드 사안이다**: 클라이언트가 자기 역할을 요청으로 알게 할지 새 클레임으로 알게 할지는 클라이언트 수정이 아니라 결정 사항이다 |
| 누가 역할을 배정할 수 있는가 | 로그인한 admin이면 누구나 역할 컨트롤을 본다. UI에 superadmin 게이트가 없다 | `PATCH /user/:id/role`은 **superadmin 전용**이며, 일반 admin에게는 `RolesGuard`가 403 `FORBIDDEN`("Insufficient role.")을 던진다 | 컨트롤을 `superadmin`으로 제한하고, 성공할 수 없는 동작을 노출하는 대신 403을 처리한다 |
| 계층을 보호하는 불변식 | 어느 쪽도 분기가 없다 | **마지막 superadmin** 강등은 400 `AUTH_LAST_SUPERADMIN`으로 거부된다. **모든** 역할 변경은 `refreshTokenHash`를 null로 만들어 대상 세션을 즉시 끊는다 | 둘 다 화면에 드러낸다 — 마지막 superadmin 거부에는 별도 메시지를, 역할 변경에는 대상이 로그아웃된다는 경고를 |
| 역할 변경 안내 문구 | `role === 1 ? 'admin' : 'user'` — 세 번째 등급을 표현할 수 없다 | 3단계이며 `superadmin`도 배정 가능하다 | 라벨을 enum에서 파생시켜 `superadmin` 승격이 조용히 잘못 표기되지 않게 한다 |
| 감사 액션 어휘 | `ROLE_CHANGE`, `USER_DELETE`, `FORCE_LOGOUT`, `USER_BANNED`, `USER_MUTED`, `USER_UNBAN`에 색을 지정 | `AUDIT_ACTIONS`는 정확히 `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE` | 겹치는 둘은 유지하고 `FILE_DELETE`를 추가하며, 이 프로젝트가 절대 기록하지 않는 모더레이션 액션 네 개는 제거 |
| superadmin 부트스트랩 문서 | `e2e/.env.example`과 `e2e/seed-superadmin.mjs`가 "CLAUDE.md의 **Role Population Invariants**"를 인용한다 | 이 저장소 `CLAUDE.md`에 **그런 절은 없다** — Chat Project의 절 이름이다. 실제 메커니즘은 부팅 시 승격하는 `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts`다 | 두 참조를 `SUPERADMIN_EMAIL` / [ADR 0013](0013-rbac-and-audit-log.ko.md)으로 돌린다. 그 문장이 하는 *주장*("앱 내 흐름으로는 superadmin을 만들 수 없다")은 **여기서도 참이다**. 인용만 틀렸다 |
| 도메인 페이지 | `rooms-page.tsx`(`getAllRooms`, `deleteRoom`), 대시보드의 `getOnlineUser`·`getUserNicknames` | 채팅방도, 접속 상태도, 닉네임도 없다 — 이 도메인은 **업로드된 영상 파일**이다 | 방 페이지와 접속/닉네임 위젯을 삭제하고 파일 화면으로 대체 |
| 사용자 관리 엔드포인트 | `POST /user/:id/ban`, `/unban`, `/force-logout`; `GET /user?humanOnly`, `?status` | **하나도 없다.** 사용자 표면은 `GET /user`, `GET /user/:id`, `PATCH /user/:id`, `PATCH /user/:id/role`, `DELETE /user/:id` | 백엔드가 받쳐주지 않는 동작을 제거하거나, 별도 ADR을 갖는 백엔드 작업으로 명세화 |
| 사용자 목록 조회 | `GET /user?page&take&sort&sortBy&search&status` | `findAll()`은 `@Query()`를 **전혀 바인딩하지 않는다** — 전체 사용자에 대한 `findAndCount()`를 반환하며, 모르는 쿼리 파라미터는 거부되지 않고 조용히 무시된다 | 파라미터를 없애거나, `GET /user` 페이지네이션을 백엔드 작업으로 추진 |
| 감사 로그 | `GET /audit-log?action&page&sort&userId&from&to`와 `GET /audit-log/export`(blob/CSV) | `AuditLogQueryDto`는 `action`, `take`, `skip`만 받고 **`/export` 라우트가 없다** | 지원되는 필터로 축소하고, export 버튼을 없애거나 백엔드 작업으로 명세화 |
| 페이징 모델 | `page` + `take` | `take` + `skip`(오프셋), 그리고 `GET /file`의 `search`/`sortBy`/`order`/`creatorId` ([ADR 0021](0021-list-query-search-filter-sort.ko.md)) | 페이지 번호를 오프셋으로 변환 |
| 삭제 계약 | 확인 절차 없는 `DELETE /user/:id` | 파일을 가진 계정에는 `?deleteFiles=true`가 필수이며, 없으면 **409 `USER_HAS_FILES`**([ADR 0020](0020-account-deletion-cascade.ko.md)) | 확인 대화상자와 409 분기 추가 |
| 에러 처리 | 그때그때의 상태 코드·메시지 검사 | 동결된 `{ code, message }` `ErrorBody` 계약([ADR 0011](0011-error-code-contract.ko.md)) | 메시지 문자열이 아니라 `code`로 분기 |
| 배포 설정 | CSP의 `connect-src`가 Chat Project의 Railway 호스트로 고정된 `vercel.json` | **배포 대상이 없다.** AWS 컨테이너 배포는 Stage 4 로드맵 항목 | 어디든 배포하기 전에 다시 쓰거나 삭제 |
| 세션 키 | `sessionStorage` 키 `admin:sessionUserId` | 개발 환경에서 같은 origin의 `frontend/` 자체 session-guard 키와 공존 | 두 앱을 함께 띄웠을 때 키가 충돌할 수 없음을 확인 |

## 결과

- **이제 이 저장소는 이 백엔드에 대해 동작하지 않는 애플리케이션 코드를 추적한다.** 그것이 이
  ADR이 의도적으로, 명시적으로 감수하는 대가이며, 출처 문서를 후속 커밋이 아니라 같은 커밋에
  넣는 이유다. 완화 수단은 정확성이 아니라 격리(결정 3)다 — 이 저장소의 어떤 것도 `admin/`을
  빌드·테스트·린트·서빙하지 않으므로, 깨진 폴더가 초록색 파이프라인을 깨뜨릴 수 없다.
- **CI, 린트, 두 테스트 스위트가 영향받지 않음을 증명할 수 있다.** `lint`/`lint:ci`는
  `{backend,apps,libs,test}/**/*.ts`를, Jest `roots`는 `["backend"]`를 대상으로 하고 워크플로는
  그것만 실행한다 — 어느 것도 `admin/`에 닿을 수 없다.
- **`admin/vercel.json`은 살아 있는 chat 프로젝트 잔재를 담고 있다**: CSP `connect-src`가
  `chat-project-production-3b22.up.railway.app`을 가리킨다. **의도적으로 수정하지 않고** 커밋하며,
  그래야 적응 작업이 반쯤 고쳐진 파일이 아니라 원본을 기준으로 diff를 뜬다. 위 백로그에 올라
  있고, `admin/`을 어딘가에 배포하기 전에 반드시 다시 쓰거나 삭제해야 한다 — 이 프로젝트에는
  배포 대상이 없으므로 오늘 기준으로는 그런 곳이 없다.
- **Apollo 코드를 가져왔다고 [ADR 0009](0009-rest-only-api-with-swagger.ko.md)가 다시 열리는 것은
  아니다.** 이 저장소의 무엇도 GraphQL을 서빙하지 않고, 여기서 그것을 추가하는 백엔드 변경도
  없다. Apollo 파일들은 전송 계층에 대한 결정이 아니라 *삭제 목록의 첫 항목*이다 — REST 전용은
  그대로다.
- **`admin/`의 의존성은 이 프로젝트의 의존성이 아니다.** `@apollo/client`, `graphql`, `rxjs`,
  `zustand`, `react-hook-form`, `jwt-decode` 등은 `admin/package.json`과 `admin/node_modules`에
  있고 루트 `pnpm-lock.yaml`에는 없다. 루트 `pnpm audit`은 이들을 보지 못하므로,
  `pnpm audit --prod`가 깨끗하다는 사실은 `admin/`에 대해 아무것도 말해주지 않는다. 적응 후에도
  살아남는 의존성은 그 시점에 범위 준수의 의존성 검토(라이선스, CVE)를 거친다.
- **커밋되는 비밀 값은 없다.** `admin/.gitignore`가 이미 `node_modules`, `dist`, `.env`,
  `.env.local`을 무시하며, 이는 `admin/.env`, `admin/.env.local`, `admin/e2e/.env`를 모두 포함한다
  (커밋 전 `git check-ignore`로 확인). 추적되는 것은 `.env.example` 템플릿뿐이다.
- **`.dockerignore`에 `admin`을 추가한다.** 기존 `frontend`, `test` 항목 옆이다. 추가하지 않으면
  새 폴더가 백엔드 이미지의 빌드 컨텍스트에 조용히 들어가는데, 이것이 `frontend`가 거기 있는
  것과 같은 이유다.
- **admin 화면이 동시에 두 개 존재하며**, 그 중복은 감춰지지 않고 드러나 있다: ADR 0010의
  `frontend/src/features/admin/AdminPage.tsx`와 이번 `admin/` 앱. 해소는 ROADMAP > 미예정
  항목에서 추적한다.
- **`.ko.md` 형제 문서 규약이 `admin/` 안까지 확장된다.** `admin/README.md`는 추적되는 문서이므로
  [CLAUDE.md](../CLAUDE.md) > 문서 규약에 따라 `admin/README.ko.md`가 함께 존재한다.
- **[ADR 0013](0013-rbac-and-audit-log.ko.md)이 남긴 빈 구멍은 닫힌 것이 아니라 담당자가
  정해진 것이다.** 그 ADR은 역할 체계가 "프론트엔드 `/admin` 구역을 받을 준비가 됐다"며 전용 앱
  여부를 ADR 0010으로 미뤘다. 이 ADR이 그 질문에 답하고(`admin/`의 전용 앱) 화면의 담당자를
  지정하지만, 적응이 끝나기 전까지 **계층은 여전히 UI로 운영할 수 없다**. 그때까지
  `PATCH /user/:id/role`은 이전과 똑같이 Swagger나 직접 요청으로만 도달 가능하다.
- **이식된 콘솔의 `superadmin` 부트스트랩 주석이, 여기에 존재하지 않는 `CLAUDE.md` 절을
  인용한다.** `admin/e2e/.env.example`과 `admin/e2e/seed-superadmin.mjs`가 둘 다 "CLAUDE.md의
  Role Population Invariants"를 가리키는데, 이는 Chat Project의 절 이름이다. 그 문장이 담은
  *주장*("앱 내 흐름으로는 superadmin을 만들 수 없다")은 `SUPERADMIN_EMAIL`과
  `superadmin-seed.service.ts`를 통해 이 프로젝트에서도 참이며, 인용만 틀렸다. 이식본의 나머지와
  함께 고치지 않고 두되 백로그에 올려, 그 절을 찾아 헤매는 사람이 왜 찾을 수 없는지를 이 ADR에서
  알게 했다.
- **역할 관리 조각이 작업 순서의 지렛대다.** 라우트가 이미 맞는 유일한 부분이므로, 가장 값싼 첫
  적응 대상이면서 동시에 명시된 권한 계층 목적을 실제로 달성하는 부분이다. 다른 곳에서 시작하는
  작업은 이번 이식을 촉발한 요구사항에 닿지 못한 채 공을 들이게 된다.
- **chat 잔재 감사의 사각지대가 기록됐다.** 그 계획의 grep 세트는 `*.md`, `ADR/`,
  `.env.example`만 — 즉 문서만 — 훑는다. 이번 이식은 chat 프로젝트 용어(`apollo`,
  `graphql-operations`, `errorLink`, `zustand`, `session-guard`, `protected-route`, 방·닉네임
  식별자)를 기존 grep 전부의 바깥인 **추적되는 소스 코드**에 들여놓는다. 같은 변경에서 계획
  문서에 이 사실을 반영했다.

## 기각한 대안

- **`frontend/` 안에 `/admin` 구역을 새로 구현**(위 B안, ADR 0010의 원래 명세) — 최적화 대상인
  단 하나의 축을 제외하면 모든 면에서 가장 깔끔하다. 하지만 이미 동작하는 형태로 존재하는
  라우터, 라우트 가드, 인증 스토어, 단일 비행 갱신 가드, Playwright 하네스를 전액 토큰 비용으로
  다시 만든다. 오직 그 이유로 기각한다. 적응해보니 이식된 콘솔의 대부분을 버려야 한다는 결론이
  나면 이 길이 더 낫고, ROADMAP의 미결 사항이 이쪽으로 뒤집힌다.
- **도메인 무관 파일만 이식**(인증 스토어, session guard, protected route, 설정)하고 페이지는
  두고 오기 — diff가 더 작고 오해를 덜 부른다. 말 그대로의 *잘못된 절약*이라 기각한다. 어떤
  파일이 도메인 무관인지 고르는 일 자체가 적응 분석인데, 콘솔 전체를 읽어볼 이점 없이 미리
  해야 한다. 게다가 버리는 페이지들은 남기는 조각들이 실제로 어떻게 쓰이는지 보여주는 동작
  예제이기도 하다. 원본 그대로의 이식본 + 문서화된 백로그가, 그 판단을 제대로 할 수 있는 작업에
  판단을 넘겨준다.
- **이식하면서 곧바로 적응 — 동작하는 admin 앱을 한 커밋에 넣기** — 저장소가 동작하지 않는
  코드를 품는 구간이 없다. 두 가지 이유로 기각한다. 첫째, "이게 어디서 왔는가"와 "우리가 무엇을
  바꿨는가"를 하나의 읽을 수 없는 diff로 뭉갠다. 둘째, 적응은 백로그의 모든 행을 건드리는데,
  그중 몇 가지(없는 `role` 클레임, 존재하지 않는 ban/force-logout 엔드포인트, `GET /user`
  페이지네이션)는 클라이언트 수정이 아니라 **백엔드** 사안이고 각자의 결정을 요구한다.
- **`admin/`을 추적하지 않고 디스크에만 두기** — git 이력에 chat 프로젝트 코드가 전혀 남지 않는다.
  기각한다. 추적되지 않는 폴더는 리뷰에 보이지 않고, 이후 모든 감사에서 빠지며, 작업 사본과 함께
  사라진다. 무엇보다 토큰 절약이라는 이번 결정 자체가 기록되지 않는데, 그것이 바로 여기서 문서로
  남길 가치가 있는 것이다.
- **출처를 밝히지 않고 코드만 복사** — 문서 부담이 가장 작다. 단호히 기각한다. 다른 프로젝트 앱을
  출처 없이 복사하는 것이야말로
  [chat 잔재 제거 계획](../CHAT-REMNANT-REMOVAL-PLAN.ko.md)이 쓰이게 만든 바로 그 실패다:
  `CLAUDE.md` 자체가 그렇게 이 저장소에 들어왔고, 정리 비용이 이식으로 아낀 것을 훨씬 넘어섰다.
