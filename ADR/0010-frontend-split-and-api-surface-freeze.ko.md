# ADR 0010: 프론트엔드 분리와 API 표면 동결

- 상태: 승인됨
- 날짜: 2026-07-23
- English: [0010-frontend-split-and-api-surface-freeze.md](0010-frontend-split-and-api-surface-freeze.md)

## 맥락

이 프로젝트는 지금까지 Swagger가 유일한 소비자인 백엔드 전용 포트폴리오
API였다. 이제 브라우저 프론트엔드가 필요해졌고, 그 순간 세 가지 구조적 질문이
한꺼번에 제기된다: 프론트엔드를 어디에 둘 것인가(같은 repo인가 아닌가), admin
화면을 별도 애플리케이션으로 만들 것인가, 그리고 실제 소비자가 API에 의존하기
시작하면 API 계약은 어떻게 되는가. 현재 소비자는 **0명** — 아직은 어떤 breaking
변경도 비용이 들지 않는다. opt-in CORS([ADR 0008](0008-opt-in-cors.ko.md))는
이미 cross-origin 프론트엔드를 염두에 둔 장치다.

## 결정

- **프론트엔드는 별도 repository로 만든다.** 이 repo는 백엔드 전용으로
  유지하고, 프론트엔드는 HTTP로 API를 소비하는 새 repo로 시작한다. pnpm
  workspace 모노레포는 현시점에서는 기각 — 모노레포의 이점(계약 변경의 원자성,
  타입 직접 공유)은 공유 코드와 잦은 계약 변경이 있어야 실현되는데 둘 다 아직
  없고, 비용(이 repo를 `apps/backend`로 재배치, Jest·마이그레이션 경로와
  CLAUDE.md 규칙 체계 전면 수정)은 즉시 확정적으로 발생한다. 나중에 전환해도
  비용은 비슷하다.
- **admin은 프론트엔드 내부의 라우트 구역(`/admin/*`)으로 시작한다** — 세 번째
  애플리케이션이 아니다. 별도 admin 앱으로의 승격은 RBAC이 랜딩하고 실제 admin
  요구사항이 쌓인 뒤에만 재검토한다. 지금 3분리를 하면 백엔드가 구분조차 못
  하는(role이 없는) 앱을 먼저 만드는 셈이다.
- **라우트를 정리한 뒤 동결한다.** 첫 소비자가 나타나기 전에 비표준 라우트
  4건을 리네임한다:
  `POST /file/uploadFile` → `POST /file`,
  `PATCH /file/patch/:id` → `PATCH /file/:id`,
  `DELETE /file/delete/:id` → `DELETE /file/:id`,
  `POST /auth/token/refreshaccess` → `POST /auth/token/refresh`.
  이후 API 표면은 **동결**된다: breaking 라우트 변경에는 버저닝 결정이
  선행되어야 한다(ROADMAP > 설계 기준 > API 계약 안정성 참조). 복수형
  리네임(`/user` → `/users`, `/file` → `/files`)은 검토 후 기각 — 앱 전체가
  단수형으로 일관되어 있고, 일관성이 REST 미학보다 우선한다.
- **RBAC은 프론트엔드 준비 작업(ROADMAP Stage F) 뒤로 재배치한다.** RBAC은 API
  표면을 바꾸지 않고 권한만 더하므로 미뤄도 프론트엔드 재작업이 없다. 표면
  동결을 먼저 하는 것은 정확히 그 반대 이유다.
- **정적 파일 서빙은 Stage 4까지 무인증을 유지한다.** 업로드된 파일은 Stage 4의
  VOD 재생 접근 제어 작업이 [ADR 0005](0005-local-disk-storage.ko.md)를
  재검토할 때까지 공개 URL(`{BASE_URL}/file/upload/granted_...`)로 남는다 —
  링크를 아는 사람은 누구나 접근할 수 있다. 조기 수정 대신, 문서화된 알려진
  제약으로 감수한다.

## 기각한 대안

- **모노레포(pnpm workspace)** — 이점의 성립 조건(공유 코드, 잦은 계약 변경,
  3개 이상의 앱)이 아직 하나도 충족되지 않은 반면, 재배치 비용은 즉시 확정.
- **3분리(frontend / backend / admin)** — 시기상조: 백엔드에 role이 없고 admin
  요구사항도 문서화된 것이 없다. 목적지가 틀린 게 아니라 순서의 문제.
- **복수형 라우트 리네임** — 미학적 이득 대비 repo 전체의 일관성 손실.

## 결과

- ROADMAP에 Stage 0보다 앞서는 **Stage F — 프론트엔드 준비** 파이프라인이
  생긴다: 라우트 정리·계약 동결 → 에러 코드 체계(전역 exception filter) →
  refresh 토큰 httpOnly cookie 전환 + rotation(Stage 2에서 앞당김).
- cookie/rotation 작업은 [ADR 0002](0002-dual-secret-token-pair.ko.md)의 "토큰
  서버 측 저장 금지" 스탠스를 개정하는 자체 ADR과 리뷰된 스키마 마이그레이션을
  필요로 한다 — 여기서는 그 필요를 인지할 뿐, 결정하지 않는다.
- 프론트엔드 스택 선정과 `POST /auth/signin/local`의 장기 존치 여부(동결에서는
  일단 생존)는 ROADMAP 7절의 미결 사항으로 남는다.
- 프론트엔드가 API를 소비하기 시작하면 모든 breaking 변경에 비용이 붙는다 —
  부담 없이 리네임하던 Swagger 전용 시대는 이 ADR로 끝난다.
