# 로드맵

> English version: [ROADMAP.md](ROADMAP.md)

Upload Board Project의 전체 계획서. 2026-07-23에 11개 축(본질 → 방법론 → 설계
기준 → 아키텍처 → 모듈 → 도메인 → 메커니즘 → 자료 처리 → 플랫폼 → 인프라 →
배포 환경) 순서의 결정 검토를 거쳐 수립했다. 같은 날 프론트엔드 분리
결정([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))으로
개정되어, Stage 0 앞에 Stage F(프론트엔드 준비)가 삽입되었다. 아래 모든 항목은
각각 독립된 설계·검토를 거치는 전용 작업으로 진행한다
([CLAUDE.md](CLAUDE.md) > Scope Discipline).

> **정합성 안내**: 이 계획의 항목 중 CLAUDE.md가 "명시적 요청 없이는 제안 금지"로
> 표시한 것들(CI, Docker, 클라우드 스토리지/배포)은 **2026-07-23 명시적 결정**으로
> 이 계획에 편입되었다. 각 전용 작업이 실제로 완료되기 전까지는(각자의 ADR 포함)
> 현행 Architecture Decisions가 그대로 유효하다.

## 현재 위치 (2026-07-23 기준)

- 2026-07-22 하드닝 런은 모두 반영 완료됐다: 보안 quick-win, lint 0 오류
  베이스라인, 문서 재작성, TypeORM 마이그레이션 도입(`79603ad`,
  [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)), 이어서
  `.ko.md` 문서 전반의 한국어 유창성 패스(`dc1ad72`)까지.
- 이 계획서 자체는 2026-07-23의 11축 결정 검토로 수립되었다.
- 2026-07-23 프론트엔드 분리 결정([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)):
  별도 프론트엔드 repo가 이 API를 소비하며, admin은 그 안의 `/admin` 라우트
  구역으로 시작한다. RBAC은 Stage F 뒤로 재배치 — RBAC은 API 표면을 바꾸지
  않고 권한만 더하므로 미뤄도 프론트엔드 재작업이 없고, 표면 동결을 먼저 하면
  실제 재작업을 아낀다.
- 라우트 정리·계약 동결은 2026-07-23 반영 완료: `POST /file`, `PATCH /file/:id`,
  `DELETE /file/:id`, `POST /auth/token/refresh`가 정식 라우트이며, API 표면은
  이제 동결 상태다(ADR 0010).
- 에러 코드 계약은 2026-07-23에 완료되었다
  ([ADR 0011](ADR/0011-error-code-contract.ko.md)): 모든 에러 응답이 전역 예외
  필터를 거쳐 안정적인 기계 판독 가능 `code`를 싣는다.
- **다음 전용 작업: refresh 토큰 httpOnly 쿠키 이동 + 회전 (Stage F)**.

## 1. 비전과 본질

- **현재**: 포트폴리오/학습용 백엔드 — 작지만 완결된 API 위에서 엔지니어링
  규율(설계·문서·테스트)을 증명하는 것이 목적이다.
- **목표**: 브라우저 프론트엔드(별도 repo,
  [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))를 결정된
  소비자로 두는 실서비스 지향 백엔드. 후반 단계(기반 인프라, AWS 배포, 재생
  접근 제어)는 이 전환을 구호가 아닌 실체로 만들기 위해 존재한다.
- **우선순위 축** (기존 "보안 → 결정된 아키텍처 작업 → 위생 → 문서/테스트"를
  대체): 보안 → 프론트엔드 준비(API 표면 동결) → 결정된 아키텍처 작업(RBAC) →
  기반(재현성 · 관측성 · 테스트 신뢰성) → 메커니즘 보강 → 도메인 확장 →
  실서비스 전환.

## 2. 방법론

- **전용 작업 단위.** 모든 로드맵 항목은 자체 설계·검토·문서화를 갖춘 독립
  작업이다 — [CLAUDE.md](CLAUDE.md) > Scope Discipline의 로드맵 차원 재서술이다.
  묶음 처리도, 부수 작업도 없다.
- 6절의 단계(Stage)는 **의존 순서에 따른 묶음일 뿐 마일스톤이 아니다**: 진행은
  항목 단위로 이뤄지며, 단계 경계를 넘는 데 별도의 의식은 없다.

## 3. 설계 기준

**동결 (변경 없음)** — 기존 3축, [CLAUDE.md](CLAUDE.md)의 Never Do 그룹 1–3:
런타임 안전, 데이터 무결성, 보안. 모든 로드맵 작업은 이 기준을 통과해야 하며,
기준 자체는 로드맵의 대상이 아니다.

**2026-07-23 채택** — 이 계획을 지배하는 신규 5축:

| 축 | 근거 |
|---|---|
| 관측성 | 현재 로깅 인프라가 전무하다. 진단할 수 없는 백엔드는 운영할 수 없다 — 실서비스 목표의 첫 번째 선행 조건. |
| 재현성/이식성 | Node/pnpm 버전 미고정, DB 수동 구성. 배포 대상이 생기는 순간 환경 편차는 곧바로 장애 원인이 된다. |
| API 계약 안정성 | 소비자가 결정되었다(프론트엔드, 2026-07-23) — Stage F가 이 축의 발동이다: 소비자가 0명인 동안 라우트를 정리·동결하고, 에러 코드는 Stage F 작업으로 전달한다. URI 버저닝은 동결 이후 실제 breaking 변경이 필요해질 때까지 계속 유예. |
| 테스트 신뢰성 | e2e 스위트가 Nest 템플릿 그대로다. 단위 테스트만으로는 인증 흐름과 `temp_` → `granted_` 경로 전체를 보장할 수 없다. |
| 성능/용량 | 게시판 도메인 확장은 목록 쿼리 복잡도를 올리고, 비디오 서빙은 디스크·대역폭 부하가 크다. 응답시간 목표, 인덱스 정책, 디스크 상한이 명시적 기준이 된다. |

**Advisory (기록만, 지배 기준 아님)**:

- 개인정보/컴플라이언스 — PII 로그 금지는 이미 강제(Never Do G3); 삭제 정책은
  Stage 2의 삭제 설계 작업과 연결된다.
- 릴리스/변경 관리 — semver 태깅 + 마이그레이션 순서 규약; 배포와 함께 활성화.
- 문서 최신성(Docs-as-Code) 강제 — README/엔드포인트 일치의 기계 검증; CI 작업
  아래의 후보.

## 4. 아키텍처 방향

- **현재**: 계층형 모듈러 모놀리스 유지 — Controller → Service → Repository,
  단일 책임의 4모듈. 패턴 변경은 로드맵 범위에 없다.
- **향후 목표 (2026-07-23 결정)**: **스토리지 포트-어댑터** — 물리 파일 조작을
  `FileStorage` 인터페이스로 분리해, Stage 4에서 필요해질 때 로컬 디스크
  구현([ADR 0005](ADR/0005-local-disk-storage.ko.md))을 클라우드 스토리지(S3)로
  교체할 수 있게 한다. 착수 시 ADR 0005 재검토와, ISP 규약("실제 두 번째 구현체가
  생기기 전에는 서비스 인터페이스 계층 금지")을 Principle Conflict Protocol로
  통과시키는 절차가 필요하다.
- **프론트엔드 분리 (2026-07-23 결정, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))**:
  별도 프론트엔드 repo가 HTTP로 이 API를 소비한다. admin은 그 프론트엔드 안의
  `/admin` 라우트 구역으로 시작하며, RBAC이 랜딩하고 실제 admin 요구사항이
  쌓인 뒤에만 별도 앱으로 승격한다. pnpm workspace 모노레포와 즉시
  3분리(frontend/backend/admin)는 검토 후 시기상조로 기각.
- **알려진 제약 (감수)**: 정적 파일 서빙은 Stage 4의 VOD 재생 접근 제어 작업이
  [ADR 0005](ADR/0005-local-disk-storage.ko.md)를 재검토할 때까지 무인증으로
  유지된다 — `{BASE_URL}/file/...` URL은 공개이며, 프론트엔드도 그렇게 다뤄야
  한다.
- 검토 후 보류한 대안: 이벤트 기반 보강(분리할 부수효과가 rename 하나뿐이며,
  rename을 트랜잭션 밖으로 빼면 `temp_`/`granted_` 원자성이 깨진다), CQRS-lite
  (읽기 모델이 분리할 만큼 복잡하지 않다; YAGNI).
- **모듈 방침**: 4모듈 유지, 예정 작업은 기존 모듈에 수용(RBAC → auth/user).
  신규 모듈은 새 도메인이 생길 때만 — 게시판 확장(Stage 3)이 그 승인된 사례다.

## 5. 도메인 계획

- **현재**: 인증된 비디오 파일 업로드/관리뿐. 프로젝트명의 "board"(게시판)는
  미구현이다.
- **결정**: 실제 업로드 게시판으로 확장 — 게시글이 업로드 파일을 참조하는
  post/comment 도메인. 엔티티 관계(post ↔ `FileEntity`, comment ↔ post/user)는
  먼저 평문으로 기술한 뒤 검토된 마이그레이션으로 반영한다
  ([CLAUDE.md](CLAUDE.md) > Scope Discipline의 스키마 변경 규약).
- 목록 검색/필터/정렬(Stage 3)이 게시판 목록의 데이터 계층 선행 조건이다.

## 6. 단계별 작업 목록

순서는 의존 관계 기준이다. 각 행이 하나의 전용 작업이다.

### Stage F — 프론트엔드 준비 (2026-07-23 결정, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))

프론트엔드 착수 전 백엔드 파이프라인 — 브라우저 클라이언트가 의존하게 될
모든 것을 소비자가 0명인 동안 확정한다.

| 작업 | 근거 / 의존성 |
|---|---|
| 라우트 정리 및 API 계약 동결 | `POST /file`, `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh`로 정규화하고, breaking 변경이 아직 공짜인 동안 표면을 동결한다 (복수형 리네임과 auth 액션 라우트 변경은 검토 후 기각 — ADR 0010). |
| 에러 코드 체계 (전역 exception filter) | 프론트엔드가 메시지 문자열이나 status 단독 분기에 의존하기 전에 기계 판독 가능한 에러 계약을 마련한다. |
| Refresh 토큰 httpOnly cookie 전환 + 회전/재사용 감지 | **Stage 2에서 앞당김 (2026-07-23)** — 브라우저 프론트엔드가 생기면 토큰 저장이 실제 XSS 표면이 된다. [ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)의 "토큰 서버 미저장" 스탠스를 개정하는 자체 ADR과 검토된 스키마 마이그레이션이 필요하다. |

### Stage 0 — 결정된 아키텍처 작업 (RBAC)

| 작업 | 근거 / 의존성 |
|---|---|
| **RBAC** — `role` 컬럼 + role 인식 가드 | 2026-07-22 결정; 설계 확정: 3단계(`user`/`admin`/`superadmin`), `PATCH /user/:id/role`은 superadmin 전용, 소유권 검사는 "본인 **또는** admin"으로 확장. Stage F 뒤로 유예(2026-07-23) — RBAC은 API 표면을 바꾸지 않으므로 프론트엔드 재작업이 생기지 않는다. `role` 컬럼은 검토된 마이그레이션으로 배포. |

### Stage 1 — 기반 (재현성 · 관측성 · 테스트 신뢰성)

| 작업 | 근거 / 의존성 |
|---|---|
| Node/pnpm 버전 고정 (`engines` + `.nvmrc`) | 비용이 거의 0; CLAUDE.md가 명시한 공백("버전 미고정")을 해소; 이후 Docker 베이스 이미지 태그의 단일 출처가 된다. |
| Docker / docker-compose (앱 + 로컬 PostgreSQL) | DB 수동 구성 제거 — 온보딩과 E2E의 최대 장벽; AWS 단계의 선행 조건. |
| CI — GitHub Actions (lint + test) | 0 오류 lint 베이스라인이 현재는 사람의 기억으로만 유지된다; 최소 파이프라인, 그 이상은 아님. |
| 로깅 규약 (Nest Logger부터) | 관측성의 첫 증분; 외부 에러 추적(예: Sentry)은 배포 환경 확정 이후로 유예. |
| E2E 재작성 | 인증 흐름, 소유권 403, 페이지네이션, `temp_` → `granted_` 승격. Docker DB에 의존. |

### Stage 2 — 메커니즘 보강

| 작업 | 근거 / 의존성 |
|---|---|
| 고아 temp 파일 정리 | `POST /file`이 끝내 호출되지 않으면 `temp_` 파일이 영구 누적된다 — 현재 유일한 무관리 리소스 누수. |
| 삭제 정책 설계 (soft delete + FK) | soft delete 채택 여부와 `DELETE /user/:id`의 FK 제약 500(`FileEntity.creator`가 `nullable: false`)을 하나의 설계 작업으로 통합. |
| 업로드 멱등성/중복 정책 명문화 | CLAUDE.md 규약상 새 쓰기 엔드포인트는 중복 제출 동작을 명시해야 한다 — 게시판 확장으로 쓰기 엔드포인트가 늘기 전에 틀을 확정. |

### Stage 3 — 도메인 확장

| 작업 | 근거 / 의존성 |
|---|---|
| 목록 검색/필터/정렬 | 게시판 목록의 선행 조건; `GET /file`이 QueryBuilder 기반이라 확장 경로는 이미 있다. |
| 게시판 도메인 — post/comment 모듈 | 신규 도메인 모듈(모듈 방침이 승인한 사례); 평문 스키마 기술 → 검토된 마이그레이션 순서를 지키고, RBAC·소유권·페이지네이션 패턴을 처음부터 적용. |

### Stage 4 — 실서비스 전환

| 작업 | 근거 / 의존성 |
|---|---|
| AWS 컨테이너 배포 | 로컬: Docker(compose), 배포: AWS — 컨테이너 기반. 신규 배포 ADR 필요; Stage 1의 Docker + CI에 의존. |
| VOD 재생 접근 제어 | 업로드된 파일이 현재 공개 URL이다 — 링크만 알면 누구나 시청 가능. 인증된 재생 경로를 도입하며, ADR 0005의 정적 서빙 결정 재검토를 포함한다. (라이브 방송이 아니라 업로드된 파일의 재생.) |
| 스토리지 포트-어댑터 | S3 필요가 확정될 때만 — 아키텍처 방향(4절) 참조. |
| 성능/용량 기준 적용 | 인덱스 정책, 응답시간 목표, 디스크 상한 — 최적화 전에 측정부터. |

## 7. 미일정 / 미결 사항

- 라이선스: `package.json`은 `UNLICENSED`인데 재작성 전 README는 MIT로 표기 —
  저장소 공개 전 결정 필요.
- Chat 프로젝트 잔재 처리 ([계획서](CHAT-REMNANT-REMOVAL-PLAN.ko.md)): git
  히스토리 결정 + 신규/붙여넣기 문서 재검증 트리거.
- dev 전이 의존성 `pnpm audit` 지적(handlebars — ts-jest 경유; glob/minimatch —
  jest·@nestjs/cli 경유) — 빌드/테스트 시점 전용; 업스트림 릴리스 대기.
- API 버저닝 시점 — 소비자는 이제 결정되었다; 버저닝은 동결 이후 실제 breaking
  변경이 필요해질 때 활성화한다(설계 기준 참조).
- 프론트엔드 스택 선정(프레임워크, 빌드 도구, 호스팅) — 프론트엔드 repo의
  결정 사항; 이 repo의 어떤 것도 여기에 의존하지 않는다.
- `POST /auth/signin/local`의 장기 존치 여부 — Stage F 동결에서는 일단
  생존한다; 프론트엔드가 공식 로그인 경로 하나를 고르는 시점에 나머지의 운명을
  결정한다.
- 문서 문구 동기화 (2026-07-23 유예 결정): 계획 수립 이전의 "후보(candidate)"
  표현 3곳이 이 계획으로 대체됨 — ADR 0003("candidate roadmap item" → Stage 2
  확정), ADR 0006 Consequences("top roadmap item" → 완료),
  CHAT-REMNANT-REMOVAL-PLAN("ROADMAP's CI candidate" → Stage 1 확정). 다음 문서
  정리 패스에서 처리: ADR은 날짜 병기 한 줄 주석(ADR 0006 implementation-note
  선례), 살아있는 계획 문서는 문구 직접 수정.

## 8. Advisory 노트

작업 일정에는 반영하지 않되 판단에 참고할 기준: 개인정보/컴플라이언스(삭제 정책,
보관 기간), 릴리스/변경 관리(semver + 마이그레이션 순서), 문서 최신성 강제
(README/엔드포인트 일치의 자동 검증 — CI 작업 아래의 후보).

## 9. 완료

### 2026-07-23

| 항목 | 비고 |
|---|---|
| 전체 로드맵 계획 수립 | 11축 결정 검토; 이 문서가 그 기록 |
| 프론트엔드 분리 결정 + Stage F 파이프라인 | 별도 프론트엔드 repo, admin은 `/admin` 라우트, 계약 동결; RBAC은 Stage F 뒤로 재배치 ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)) |
| 라우트 정리 및 API 계약 동결 | `POST /file`, `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh` — 소비자 0명 상태에서 표면 동결 (Stage F 작업 1) |
| 에러 코드 계약 | 동결된 `ErrorBody` 형태 + 18개 코드 카탈로그 + `APP_FILTER`로 등록한 전역 `AllExceptionsFilter` (Stage F 작업 2, [ADR 0011](ADR/0011-error-code-contract.ko.md)) |

### 2026-07-22

| 항목 | 비고 |
|---|---|
| 소유권 검사 | user 쓰기는 본인만, file 쓰기는 creator만 (`0549ca4`) |
| `GET /file` 페이지네이션 | `GetFilesDto`: `take` 1–100 (기본 20), `skip` (기본 0) |
| `getFiles` creator join | 목록 응답에 `creator` 포함, `GET /file/:id`와 일치 |
| Opt-in CORS | `CORS_ORIGIN` 환경변수, 미설정 시 비활성 |
| 업로드 타입 allowlist | `POST /upload/attach`에 mp4/mov/webm mimetype + 확장자 필터 |
| 런타임 CVE 핀 고정 | `pnpm.overrides`로 `jws ^3.2.3`, `validator ^13.15.22` |
| lint 복구 및 클린 | `typescript-eslint` 추가, 기존 오류 45건 수정, 0 오류 베이스라인 |
| 문서 동기화 | README 엔드포인트/제약, CLAUDE.md gaps, `.env.example` (`BASE_URL`, `CORS_ORIGIN`) |
| `@nestjs/jwt` dependencies 이동 | 런타임 사용인데 devDependencies에 있던 문제 — `--prod` 설치가 더는 깨지지 않음 |
| `saved!`/`updated!` 제거 | `FileService` 커밋 후 재조회를 `try` 밖으로 이동 + null 가드 |
| TypeORM 마이그레이션 도입 | `migration:*` 스크립트, `src/data-source.ts`, 베이스라인 `InitialSchema`; 기존 DB는 `pnpm migration:run -- --fake` 1회 ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)) |
