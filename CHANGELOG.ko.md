# 변경 이력

> English version: [CHANGELOG.md](CHANGELOG.md)

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따릅니다. 아직
버전 태그가 없으므로, 이력은 초기 `0.0.1` 개발 라인(package.json 버전) 아래에
커밋 날짜별로 묶었습니다.

> **재구성 안내**: 2026-07-22까지의 항목은 git 이력에서 사후 재구성했습니다(커밋
> 해시 병기). 커밋 메시지가 불충분한 경우 diff가 실제로 보여주는 내용을
> 기술했습니다.

## [Unreleased]

### 추가
- **`admin/`에 이식한 admin 콘솔 — 수정 기반으로 문서화**
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)) — 저자의 다른
  프로젝트인 **Chat Project**(NestJS + GraphQL + Redis + Socket.IO)에는, 이 프로젝트가
  [ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)에서 채택한 것과 같은 3단계
  `user`/`admin`/`superadmin` 역할 모델을 대상으로 만들어 검증까지 끝낸 admin 콘솔이 이미
  있었다. 이를 최상위 `admin/` 폴더로 통째로 가져와 **수정하지 않은 상태로** 커밋했다.
  이유는 명시적이고 경제적이다 — **LLM 토큰 사용량**. 라우터, 라우트 가드, Zustand 인증
  스토어, 단일 비행 무음 갱신 가드, axios 인터셉터, Playwright·Vitest 하네스는 도메인과
  무관한 골격이고 이미 검증된 형태로 존재했으므로, 가져오는 비용이 프롬프트로 하나씩 다시
  생성하는 토큰의 극히 일부다 — 아낀 토큰은 API 차이분에 쓴다. **이 폴더는 이 백엔드에 대해
  동작하지 않으며, 아직 동작해야 하는 것도 아니다**: 그 안의 모든 파일이 여전히 Chat
  Project의 API를 대상으로 한다. `admin/README.md`(.ko)가 폴더 현장에서 그 사실을 밝히고,
  검증을 거친 13행 수정 백로그는 ADR 0022에 있다(삭제할 Apollo `/graphql` 계층,
  `refreshaccess`/`signOut` 라우트명, 숫자 대 문자열 역할, 액세스 토큰에 없는 `role` 클레임,
  채팅 도메인 페이지, 여기 없는 ban/force-logout 엔드포인트, `page`/`take` 대 `take`/`skip`,
  `/audit-log/export`, [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)의 삭제 확인 절차,
  `ErrorBody` 코드 분기, 그리고 chat 프로젝트 Railway 호스트로 고정된 `vercel.json` CSP —
  적응 작업이 원본을 기준으로 diff를 뜰 수 있도록 의도적으로 손대지 않았다). 적응은 **별도의
  전용 과제**이며, 백로그의 몇 행은 각자의 결정이 필요한 백엔드 사안이다. **어디에도 연결하지
  않았다**: `admin/`은 린트 glob(`{backend,apps,libs,test}/**/*.ts`), Jest
  `roots`(`["backend"]`), `tsconfig.build.json`, `docker-compose.yml`, CI 전부의 바깥에 있고,
  자체 `package.json`/`node_modules`를 갖는다 — pnpm 워크스페이스가 아니며 `frontend/`가 세운
  선례와 같다. 백엔드 동작·엔드포인트·스키마·환경변수·guard는 아무것도 바뀌지 않았다. 추적되는
  비밀 값도 없다(`admin/.gitignore`가 이미 `.env`, `.env.local`, `e2e/.env`, `node_modules`,
  `dist`를 포함하며 `git check-ignore`로 확인).
- `GET /file` 목록 검색 / 필터 / 정렬 (Stage 3 — 도메인 확장;
  [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)): 선택적 쿼리 파라미터 네 개를
  모두 `GetFilesDto`에 선언해 추가했고, `[files, totalCount]` 응답 형태는 그대로다.
  **`search`**는 제목을 대소문자 구분 없이 부분일치로 찾는다(`ILIKE '%term%'`). LIKE
  메타문자(`\`, `%`, `_`)를 이스케이프하고 `ESCAPE '\'`를 명시하므로, 검색어에 든 `%`는
  결과를 조용히 넓히는 대신 문자 그대로 매칭된다. 공백뿐인 검색어는 미지정으로 취급하고,
  길이는 100자로 제한한다. **`creatorId`**는 이미 존재하는 creator join을 통해 작성자로
  필터링한다(추가 쿼리 없음). **`sortBy`**(`createdAt` | `title` | `id`)와
  **`order`**(`DESC` | `ASC`)는 `FileService`의 완전한 `Record<FileSortField, string>`를
  통해서만 해석되므로, 클라이언트 문자열이 컬럼명으로 쿼리에 도달하지 않고 정렬 키만
  추가하고 컬럼 매핑을 빠뜨리면 컴파일 에러가 난다. `filePath`는 의도적으로 제공하지 않는다.
  풀텍스트 검색, `pg_trgm`, 복합 `sort=field:dir` 문자열, `creatorEmail` 필터, keyset
  페이지네이션은 모두 ADR에서 검토 후 배제했다.
- 삭제 정책 (Stage 2 — 메커니즘 강화;
  [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)): **soft delete는 채택하지 않는다** —
  삭제는 hard delete로 유지하며, 그 근거는 ADR에 기록했다. `DELETE /user/:id`는 이제 선택적
  `deleteFiles` 확인 값을 받는다. `deleteFiles=true`면 계정을 **그 계정이 소유한 모든 파일과
  함께** 삭제한다(파일 행 → 계정 행을 하나의 `dataSource.transaction` 안에서 지우고, 물리
  파일 unlink는 롤백이 불가능하므로 **커밋 이후에** 수행한다). 확인이 없으면 파일을 보유한
  계정의 삭제를 신규 **409 `USER_HAS_FILES`**로 거절하며, 클라이언트 경고 문구에 쓸 파일
  개수를 메시지에 담는다 — 기존의 FK 위반 **500**(`23503`, 원인을 알 수 없는 "Internal server
  error")을 대체한다. `deleteFiles=false`는 확인하지 않은 것으로 취급한다. 이 플래그를 boolean이
  아니라 검증된 문자열 리터럴(`'true' | 'false'`)로 받은 이유는, 전역 파이프의
  `enableImplicitConversion`이 커스텀 `@Transform`보다 먼저 `"false"`를 truthiness로 `true`로
  바꾸는 것이 실측으로 확인됐기 때문이다 — `delete-user-query.dto.spec.ts`가 이 동작을 고정한다.
  파일이 없는 계정의 삭제는 기존과 완전히 동일하다. `USER_DELETE` 감사 기록에는
  `detail: files=N`이 붙는다. 스키마 변경은 없다(FK는 `ON DELETE NO ACTION` 유지, 연쇄는
  서비스에서 명시적으로 수행). E2E는 거절, 확인된 연쇄 삭제, 잘못된 플래그,
  `deleteFiles=false`를 모두 커버한다.
- 업로드 중복 제출 정책 (Stage 2 — 메커니즘 강화;
  [ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)): `POST /upload/attach`가 발급하는
  파일명을 **1회용 청구 토큰**으로 삼아, 새 저장소도 스키마 변경도 없이 `POST /file`의
  재시도 계약을 확정했다. 이미 청구된 파일명을 다시 제출하면, 그 청구자 본인에게는 기존
  파일을 **replay**한다 — 두 번째 201이 아니라 HTTP **200**으로 원래 리소스를 돌려준다 —
  그 외 사용자에게는 신규 **409 `FILE_ALREADY_CLAIMED`**를 낸다(역할이 아니라 신원만 본다:
  관리자가 타인의 파일명을 다시 제출하는 것은 재시도가 아니라 충돌이다). 형식은 맞지만 뒤를
  받쳐 줄 temp 파일이 없으면(발급된 적 없거나 [ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)
  스윕이 TTL 초과로 회수) 어떤 쓰기보다 먼저 400 `FILE_INVALID_PATH`로 실패한다.
  `POST /upload/attach`는 의도적으로 비멱등을 유지한다 — 호출마다 새 토큰을 발급하고, 청구되지
  않은 토큰은 스윕이 회수한다. `FileService.uploadFile`의 반환 타입은 `{ replayed, file }`로
  바뀌었고, `FileController`가 `@Res({ passthrough: true })`(기존 `AuthController` 패턴)로
  `replayed`를 상태 코드에 반영한다. E2E는 2회 제출, 타 사용자 충돌, 거절되는 두 경로를
  모두 커버한다.
- 미청구 temp 파일 정리 (Stage 2 — 메커니즘 강화;
  [ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)): 새 운영 모듈 `TempCleanupModule`
  (`backend/temp-cleanup/`)이 스케줄 스윕을 돌려, `POST /file`이 끝내 호출되지 않아
  `file/temp`에 남은 미청구 `temp_` 파일을 삭제한다 — 시스템에서 유일하게 관리되지 않던
  리소스 누수(ADR 0003)다. `@nestjs/schedule`(새 런타임 의존성, MIT; `cron@4.4.0`은 pnpm
  아래에서 direct 의존성으로 승격 — `multer` phantom-transitive 선례)을 쓰고, 주기·TTL·
  dry-run·활성 플래그가 모두 config에서 오도록 **명령형** `SchedulerRegistry` 등록을 사용한다.
  안전성: TTL을 넘은 `temp_` 접두 파일만 삭제하고(이중 접두 가드: service 스킵 + 순수 함수
  `selectExpiredTempFiles` 재확인), `granted_`/`file/upload`는 결코 건드리지 않으며,
  `fs/promises`만 사용, unlink 배치 처리, 개별 파일 실패 격리, `ENOENT` no-op, dry-run 모드를
  갖춘다. 설정(Joi + `.env.example`, 모두 기본값 보유): `TEMP_SWEEP_ENABLED`(`true`),
  `TEMP_SWEEP_CRON`(`0 * * * *`, 매시간), `TEMP_SWEEP_TTL_HOURS`(`24`),
  `TEMP_SWEEP_DRY_RUN`(`false`); e2e는 `TEMP_SWEEP_ENABLED=false`로 둔다. `AppModule`에
  `ScheduleModule.forRoot()`를 추가했다. 운영/cross-cutting 모듈을 허용하도록 모듈 정책을
  개정한다.
- 로깅 규약 (Stage 1 — 관측성;
  [ADR 0017](ADR/0017-logging-conventions.ko.md)): `AllExceptionsFilter`에서 Nest 내장
  `Logger`를 사용한다 — 5xx는 클라이언트 응답에서 빠지는(Never Do Group 3) 스택과 함께
  `error`로, 4xx는 `debug`로 기록해 일상적인 인증/검증 실패를 조용히 둔다. `status code
  method url`만 기록하고 본문·헤더·토큰은 절대 기록하지 않는다. 새 코드를 위한 레벨
  규약(`error`/`warn`/`log`/`debug`)을 정립하며, 구조적/JSON 출력과 외부 에러
  추적(Sentry)은 Stage 4로 유예한다. 새 의존성 없음(Nest `Logger`는 내장).
- GitHub Actions CI (Stage 1 — 자동 품질 게이트;
  [ADR 0016](ADR/0016-github-actions-ci.ko.md)): `.github/workflows/ci.yml`가
  `main`/`dev`의 push·PR에서 두 잡으로 실행된다 — `lint-and-unit`(신규 `lint:ci`
  스크립트 = `--fix` 없는 `eslint`, 이어서 `pnpm test`)과 `e2e`(`pg_isready`
  헬스체크를 갖춘 `postgres:16` 서비스 대상 스위트, 환경 변수는 인라인 주입). 툴체인은
  ADR 0014 고정값(`actions/setup-node` + `.nvmrc` + Corepack pnpm)에서 온다. 0-오류
  lint 베이스라인과 단위 + e2e 스위트가 이제 기억이 아니라 매 push/PR에서 강제된다.
- Docker + docker-compose (Stage 1 — 재현성;
  [ADR 0015](ADR/0015-docker-and-compose.ko.md)): 멀티 스테이지 `Dockerfile`(빌드는
  `node:24.8.0`, `pnpm prune --prod`, slim 런타임; `CMD`가 커밋된 마이그레이션을 실행한
  뒤 `node dist/main`)과 `docker-compose.yml`(`db` 서비스 — `postgres:16`, 명명 볼륨,
  헬스체크; `api` 서비스 — 이미지 빌드, db 헬스 대기, `env_file: .env`에 `DB_HOST=db`
  덮어쓰기, `./file` 볼륨). `.dockerignore`가 시크릿·의존성·업로드를 이미지에서 제외한다.
  수동 `upload-board-pg` 컨테이너를 대체하고 e2e의 수동 Postgres 의존을 제거한다. 베이스
  이미지 태그는 ADR 0014의 고정값에서 온다. 검증: 이미지 빌드 성공, slim 런타임에서
  `bcrypt` 네이티브 모듈 동작, `docker compose config` 정상 해석.
- Node/pnpm 툴체인 고정 (Stage 1 — 재현성;
  [ADR 0014](ADR/0014-node-pnpm-version-pinning.ko.md)): `.nvmrc`(`24.8.0`, Node 24
  "Krypton" LTS), `package.json`의 `engines` 하한(`node >=24`, `pnpm >=10` — 권고적,
  `engine-strict`는 계속 끔), `packageManager` `pnpm@10.14.0`(Corepack). 문서화돼 있던
  "버전 미고정" 공백을 해소하고, 곧 도입될 Docker 베이스 이미지 태그와 CI 툴체인에
  단일 출처를 제공한다.
- 백엔드 e2e 스위트 재작성 (Stage 1 — 테스트 신뢰성): `test/app.e2e-spec.ts`(18개
  케이스)와 신규 `test/e2e-utils.ts` 하네스가 실제 HTTP+DB로 요청→응답 전체 경로를
  검증한다 — register/signin, refresh 회전·재사용(`AUTH_REFRESH_REUSED`, ADR 0012),
  RBAC 소유권 403(`FORBIDDEN_NOT_OWNER`/`FORBIDDEN`), 목록 페이지네이션,
  `temp_` → `granted_` 물리 승격. 격리 전략: 일회용 `upload_board_e2e` 데이터베이스를
  실제 마이그레이션으로 만들고 테스트마다 truncate하며 종료 시 drop — 개발용 DB는 전혀
  건드리지 않는다. 존재하지 않는 `GET /`를 치던 기존 Nest 템플릿을 대체한다.
  `test/jest-e2e.json`에는 `backend/*` 모듈 매퍼와 uuid ESM 변환 허용을 추가했고,
  `eslint.config.mjs`는 `test/**`에 한해 `no-unsafe-*` 계열을 완화한다(supertest 응답
  본문 타입이 `any`이기 때문). 로컬 Postgres(5435)가 필요하며, Docker-compose
  프로비저닝은 별도의 미완료 Stage 1 작업으로 남는다.
- RBAC + 감사 로그 ([ADR 0013](ADR/0013-rbac-and-audit-log.ko.md), Stage 0 —
  **Stage 0 완결**): `user`/`admin`/`superadmin` 역할(신규 `user_entity.role`
  컬럼의 문자열 enum, 마이그레이션 `AddUserRoleAndAuditLog`); `RolesGuard` +
  `@Roles`와 `@AuthUser` 데코레이터; 소유권 검사를 "본인/작성자 또는 admin"으로
  확장; superadmin 전용 `PATCH /user/:id/role`(SERIALIZABLE 트랜잭션, 신규
  `AUTH_LAST_SUPERADMIN`으로 마지막 superadmin 강등 거부, 대상자 refresh 세션
  무효화). 신규 append-only `audit_log_entity`(외래 키 없음)가 커밋 후
  `ROLE_CHANGE`/`USER_DELETE`/`FILE_DELETE`를 기록하고 admin 전용 페이지네이션
  `GET /audit-log`로 노출된다. `GET /user`는 이제 admin 전용. `SuperadminSeedService`가
  선택적 `SUPERADMIN_EMAIL` 계정을 부팅 시 승격한다. 신규 의존성 없음.
- Refresh 토큰 httpOnly 쿠키 + 회전/재사용 감지
  ([ADR 0012](ADR/0012-refresh-cookie-rotation.ko.md), Stage F 작업 3 —
  **Stage F 완결**): 리프레시 토큰은 이제 httpOnly 쿠키(`SameSite=Strict`,
  `Path=/auth/token`, prod에서 `Secure`)로만 이동하고, 그 SHA-256이 신규
  nullable 컬럼 `user_entity.refreshTokenHash`에 앵커로
  저장된다(마이그레이션 `AddUserRefreshTokenHash`). 회수된 토큰을 재사용하면
  401 `AUTH_REFRESH_REUSED`(신규 코드)와 함께 세션이 무효화된다. 신규
  `POST /auth/signout`이 앵커와 쿠키를 삭제한다. 신규 런타임 의존성
  `cookie-parser`(MIT).
- 기계 판독 가능한 에러 코드 계약
  ([ADR 0011](ADR/0011-error-code-contract.ko.md), Stage F 작업 2): 동결된
  `ErrorBody` 응답 형태(`statusCode`/`code`/`message`/`timestamp`/`path`,
  `stack`은 dev 전용), 18개 코드의 문자열 enum 카탈로그
  (`backend/common/error-code.ts`), `APP_FILTER`로 등록한 전역
  `AllExceptionsFilter` — 스로우 지점 23곳이 `{ code, message }`를 싣는다.
  클라이언트 분기는 `message`가 아니라 `code`로만.
- [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md) — 프론트엔드
  분리와 API 표면 동결(2026-07-23; 구조 2026-07-24 개정): 프론트엔드는 이 저장소
  안의 `frontend/` 하위 폴더(백엔드는 루트에 그대로)로 두고 admin은 그 안의
  `/admin` 라우트 구역으로 시작; 비표준 라우트 4건을 리네임한 뒤 API 표면을
  동결; pnpm workspace 모노레포와 즉시 3분리는 기각.
- `frontend/` 하위 폴더 생성 2026-07-24: React 19 + Vite + TypeScript SPA로 API를
  소비(Basic 로그인, 메모리 내 access 토큰, httpOnly refresh 쿠키 회전),
  자체 스코프 `frontend/CLAUDE.md`·`docs/API-CONTRACT.md`와 Vite dev 프록시 포함 —
  인증 플로를 백엔드와 E2E 검증.
- TypeORM 마이그레이션 도입 ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)):
  `migration:generate`/`run`/`revert`/`show` 스크립트(컴파일된
  `dist/data-source.js` 대상 실행), CLI DataSource `backend/data-source.ts`(환경변수는
  Node 내장 `process.loadEnvFile()` — dotenv 의존성 없음), 베이스라인
  `backend/migrations/1784678400000-InitialSchema.ts`. 새 DB: `pnpm migration:run`;
  수동 생성된 기존 DB: `pnpm migration:run -- --fake` 1회.
  수동 "`synchronize` 임시 전환" 워크플로를 대체하며 RBAC의 선행 조건 해소.
- 문서 세트: `README.md` 재작성, 신규 `ARCHITECTURE.md`, `CHANGELOG.md`,
  `ROADMAP.md`, `CONTRIBUTING.md`, `ADR/`(9건) — 각각 한국어 `.ko.md` 동반.

### 변경
- 백엔드 소스 폴더를 `src/` → `backend/`로 개명 — `frontend/` 하위 폴더와의
  루트 대칭성 목적(ADR 0010 2026-07-24 개정): `nest-cli.json` sourceRoot, Jest
  `roots`/`moduleNameMapper`, lint glob, `tsconfig.build.json`(이제 `frontend`
  제외), e2e import, 모든 `backend/…` 절대 import와 문서 경로를 갱신. 컴파일된
  `dist/` 구조와 `dist/data-source.js` 마이그레이션 경로는 그대로; 백엔드
  build/test(43)/lint와 마이그레이션 재검증 완료.
- **Breaking** — 인증 전송 방식(ADR 0012, 소비자 0명 상태의 사전 결정 Stage F
  작업): `POST /auth/signin`·`POST /auth/signin/local` 응답 body가
  `{ accessToken }`으로 축소(리프레시 토큰은 Set-Cookie 헤더로 이동);
  `POST /auth/token/refresh`는 Bearer 헤더 대신 httpOnly 쿠키를 읽는다.
  브라우저는 refresh/signout에 `credentials: 'include'`가 필요하다.
  `AuthService.parseBearerToken`은 분해 — 순수 `verifyToken` 코어(시크릿 +
  `type` 클레임)는 존속, "Bearer " 분리 래퍼는 제거.
- **Breaking** — API 표면 동결에 앞선 라우트 정규화
  ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md), Stage F
  작업 1). 데코레이터 인자만 변경했으며 가드/DTO/핸들러는 그대로:
  - `POST /file/uploadFile` → `POST /file`
  - `PATCH /file/patch/:id` → `PATCH /file/:id`
  - `DELETE /file/delete/:id` → `DELETE /file/:id`
  - `POST /auth/token/refreshaccess` → `POST /auth/token/refresh`
- `ROADMAP.md`를 전체 프로젝트 계획서로 전면 개편(11축 결정 검토, 2026-07-23):
  실서비스 지향 목표, 신규 설계 기준 5축(관측성, 재현성, API 계약 안정성,
  테스트 신뢰성, 성능/용량), 단계별 전용 작업 목록(RBAC → 기반 → 메커니즘
  보강 → 게시판 도메인 확장 → AWS 실서비스 전환), 스토리지 포트-어댑터를
  향후 아키텍처 목표로 선언. 관련 문서 동기화: `CLAUDE.md`(로드맵/CI/스토리지
  주석), `README.md`(낡은 알려진 한계 수정), `CONTRIBUTING.md`(마이그레이션
  기반 설정).
- `ROADMAP.md`를 프론트엔드 분리 결정으로 개정(ADR 0010, 2026-07-23): Stage 0
  앞에 **Stage F — 프론트엔드 준비**(라우트 정리·계약 동결, 에러 코드 체계,
  refresh 토큰 cookie 전환 + 회전) 신설; RBAC은 Stage F 뒤로 재배치(API 표면을
  바꾸지 않으므로); refresh 토큰 회전은 Stage 2에서 앞당김; 정적 파일 무인증
  서빙을 Stage 4까지 감수하는 알려진 제약으로 명문화. 관련 문서 동기화:
  `CLAUDE.md`, `README.md`.

### 수정
- `GET /file` 페이지네이션이 결정적으로 동작한다
  ([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)). 이 쿼리에는 **`ORDER BY`가
  아예 없었고**, PostgreSQL에서 정렬되지 않은 쿼리에 `OFFSET`/`LIMIT`을 얹으면 행 순서가
  미정의다 — 페이지를 넘기다 어떤 행은 중복되고 어떤 행은 건너뛰어질 수 있었다. 이제 기본
  정렬이 `createdAt DESC`이고 `file.id`를 tiebreaker로 덧붙이므로(이미 유일한 `id`로 정렬할
  때는 생략), 정렬 컬럼 값이 같은 행들이 두 번의 페이지 요청 사이에 순서를 바꿀 수 없다.
  기존 호출자는 이전에 임의 순서로 받던 결과를 이제 정렬된 순서로 받는다. 응답 형태와 기존
  파라미터는 모두 그대로다.
- `DELETE /file/:id`가 행뿐 아니라 저장된 물리 파일까지 지운다
  ([ADR 0020](ADR/0020-account-deletion-cascade.ko.md)): 그동안 파일을 삭제해도 `granted_`
  파일은 `file/upload`에 영구히 남았고, `ServeStaticModule`을 통해 계속 공개 서빙되면서
  아무도 회수하지 않았다(ADR 0018 스윕은 `file/temp`의 `temp_` 파일만 건드린다). unlink는 행이
  사라진 뒤에 best-effort로 수행한다 — 실패하면 `warn`으로 남기고 고아 파일을 남길 뿐, 이미
  커밋된 삭제를 되돌리지 않는다. `file/upload/` 바깥 경로는 거부하며, 이는 `UpdateFileDto`가
  폴더 없는 맨 `granted_` 이름을 허용하므로 실제로 도달 가능한 분기다.
- `POST /file`이 예측 가능한 클라이언트 시퀀스에 500을 내지 않는다
  ([ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)): 이미 청구된 파일명을 다른 title로
  다시 제출하면 행을 insert한 뒤 `rename`이 `ENOENT`로 실패해 `INTERNAL_ERROR`로 무너졌고,
  동시 제출 2건은 락 없는 title 사전검사를 둘 다 통과해 패자의 `QueryFailedError`(
  `HttpException`이 아님)도 500이 됐다. 이제 unique 위반(`23505`)을 다시 해석한다 — 승자가
  같은 파일명을 청구했다면 패자는 같은 요청의 두 번째 사본이므로 replay하고, 아니면 진짜 title
  충돌이므로 400 `FILE_TITLE_TAKEN`을 낸다.
- Auth 응답 직렬화: `AuthController`에 `ClassSerializerInterceptor`가 없어
  `POST /auth/register`가 bcrypt `password` 해시(기존 결함)와 신규
  `refreshTokenHash`를 노출했다 — 인터셉터 없이는 `@Exclude`가 동작하지
  않는다. ADR 0012 플로 라이브 검증에서 발견.
- Refresh 토큰에 무작위 `jti` 클레임 추가: 같은 초에 발급된 두 토큰이
  바이트 단위로 동일해(`sub`/`type`/`iat`/`exp` 동일 → 서명 동일) 회전
  재사용 감지가 무력화되던 문제.

### 보안
- `UploadFileDto.filePath`를 attach 발급 형식으로 고정
  (`^temp_{uuid}_{ms}\.(mp4|mov|webm)$`, [ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)).
  이전에는 형식 검증 없이 `join(cwd, 'file/temp', filePath)`의 `rename` 소스로 들어가서,
  클라이언트가 `../` 세그먼트를 넣으면 타인의 `granted_` 파일을 가리키는 `FileEntity` 행을
  만들 수 있었다. "filePath는 서버가 생성한다"는 전제(Never Do Group 3)를 이제 DTO 경계에서
  강제한다. `UpdateFileDto`는 이 필드를 omit 후 재선언한다 — PATCH는 반대편 생명주기 상태인
  `granted_` 이름을 받기 때문이다.
- `pnpm audit --prod` 클린(2026-07-24): `multer`를 직접 의존성으로
  승격(`upload.module.ts`가 직접 import하는데 팬텀 전이 의존성이라 pnpm 엄격
  레이아웃에서 `node dist/main`이 크래시) 후 `^2.2.0` 핀; 런타임 도달
  지적들을 `pnpm.overrides`로 핀(`body-parser`, `path-to-regexp`,
  `file-type`, `lodash`, `diff`, 스코프 지정 `@nestjs/swagger>js-yaml`);
  범위 내 업데이트 `@nestjs/common`/`core`/`platform-express`(11.1.28),
  `typeorm`(0.3.31), `joi`(18.2.3), `uuid`(13.0.2). dev 전이 지적은
  의도적으로 유지(빌드/테스트 시점 전용).

## [0.0.1] — 개발 라인

### 2026-07-22 — `da676c0` … `d97916d` (하드닝 & 빠른 수정)
- **보안**: 런타임 CVE 지적을 `pnpm.overrides`로 핀 고정(`jws ^3.2.3`,
  `validator ^13.15.22`); `POST /upload/attach`에 mp4/mov/webm mimetype + 확장자
  허용 목록 강제 (`da676c0`).
- **수정**: lint 오류 0건 기준선 도달(unsafe-`any` 체인에 타입 지정, spec
  파일에서는 `unbound-method` 규칙 비활성화); `GET /file` 목록이 `creator`를
  조인해 `GET /file/:id`와 일치 (`063ca14`).
- **수정**: `@nestjs/jwt`를 `devDependencies`에서 `dependencies`로 이동 —
  AuthModule의 런타임 의존성이며 `--prod` 설치가 더는 깨지지 않음 (`44a0ac9`).
- **리팩터**: `FileService.uploadFile`/`updateFile` 커밋 후 재조회를 트랜잭션
  `try` 밖으로 이동하고 명시적 null 가드로 `saved!`/`updated!` 단언 대체
  (`d97916d`).
- **문서**: 하드닝 이후 gaps/로드맵 동기화, chat 잔재 제거 계획, `CLAUDE.md`에
  `.ko.md` 문서 관례 추가 (`dc336ef`, `837fd14`).

### 2026-07-22 — `0549ca4`, `48ab8b7`, `7bbc6b6`
- **추가**: 스키마 변경 없는 소유권 검사
  ([ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md)): `PATCH /user/:id`·
  `DELETE /user/:id`는 본인만, `PATCH /file/patch/:id`·`DELETE /file/delete/:id`는
  작성자만 가능(불일치 시 `ForbiddenException`).
- **추가**: 새 `GetFilesDto`를 통한 `GET /file` 페이지네이션 — `take` 1–100
  (기본 20), `skip` ≥ 0(기본 0); "목록에 페이지네이션이 없다"는 알려진 공백 해소.
- **추가**: opt-in CORS ([ADR 0008](ADR/0008-opt-in-cors.ko.md)): 선택적
  `CORS_ORIGIN` 환경변수(콤마 구분 허용 목록); 미설정 시 CORS 비활성 유지.
  Joi 스키마와 `.env.example`에 추가.
- **변경**: 테스트 스위트를 현재 서비스 시그니처에 맞춤; `bcrypt`는
  `jest.mock('bcrypt')`로 모킹; 삭제된 `UserService.create` 테스트 제거
  (30개 테스트 통과).
- **변경**: README 엔드포인트 목록을 실제 라우트로 수정(`POST /user` 없음).
- **수정**: `pnpm lint` 복구 — `eslint.config.mjs`가 import하는 통합
  `typescript-eslint` 패키지를 `devDependencies`에 선언; lint가 다시 실행되며
  기존 오류 약 45건은 알려진 공백으로 유지 ([ROADMAP.ko.md](ROADMAP.ko.md) 참조).
- **스타일**: 복구된 `pnpm lint --fix`로 Prettier 저장소 전체 적용;
  `CLAUDE.md` 로드맵 동기화(소유권 검사 완료 표시).

### 2026-07-22 — `f3fff1c`
- `CLAUDE.md`를 이 저장소에 특화된 운영 규약으로 재작성(이전에는 범용).
- **수정**: `@UserId` 데코레이터가 이제 JWT가 채운 `request.user.id`를 읽고, 인증된
  사용자가 없으면 `UnauthorizedException`을 던짐 — 요청 페이로드로 신원을 위장할
  수 없게 됨.
- 로드맵 결정 기록: 마이그레이션 도입, 소유권 검사, RBAC
  ([ROADMAP.ko.md](ROADMAP.ko.md) 참조).

### 2026-06-16 — `c8eb19f`, `4d00bc2`
- `CLAUDE.md` 추가(초기 AI 협업 지침).
- **리팩터 (SOLID & NestJS 원칙)**:
  - DI 수정: `AuthModule`이 자체 `providers[]`에 `UserService`를 재선언하는 대신
    `UserModule`을 import.
  - `FileResponseDto` + `FileService.toResponse()` 추가 — 공개 파일 URL을 엔티티의
    하드코딩 `@Transform` 대신 `BASE_URL`(신규 선택 환경변수)로 조합.
  - 엔티티 정리: 중복 `FileEntity.user` / `UserEntity.files` 관계 쌍과 엔티티
    레벨 표현 데코레이터 제거.
  - `UserService.create` 제거(등록은 `POST /auth/register`만);
    `UserService.update`가 설정된 `HASH_ROUNDS`로 재해싱(이전엔 하드코딩 salt).
  - 타입 안전성: `issueToken`을 `Pick<UserEntity, 'id'>`로 좁힘; local 로그인
    요청 타입 지정; 여러 `any` 제거.

### 2026-04-14 — `2f2fc99`
- **변경**: `app.module.ts`의 `synchronize`를 `true` → `false`로 전환 — 부팅 시
  스키마 자동 변경이 더 이상 일어나지 않음
  ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md) 참조).

### 2026-03-24 — `d1e830d`
- **제거**: `GET /auth/profile` 엔드포인트(사용되지 않는 role 실험 잔재).
- 사소한 `FileService` 정리.

### 2026-03-17 — `3d4d5c1`, `595e7fb`
- **제거**: 자리표시자 `upload.controller.spec.ts`.
- 인증 컨트롤러/서비스와 `main.ts` 정리; README 갱신.

### 2026-01-05 — `8b3b633`
- README 편집(커밋 메시지: "few changes" — diff는 README만 변경).

### 2025-12-27 — `6528b96`
- README 편집(한 줄).

### 2025-12-19 — `283e9ab`, `88b327a`
- **수정**: 파일 제목 중복 오류 — `updateFile`이 변경 적용 전에 동일 제목이 이미
  있는지 확인.
- `FileEntity`에 `@IsString`/`@IsNotEmpty` 검증 데코레이터 추가; `FileService`
  주석 정리.
- `file/temp` / `file/upload`에 커밋됐던 샘플 미디어 제거(참고: `88b327a`의
  메시지는 "swagger additional update"이지만 diff는 추적된 미디어 제거만 포함).

### 2025-12-18 — `0a77627`
- `.env.example` 추가; README 정리.

### 2025-12-17 — `434c2bc`
- **초기 애플리케이션**: 4개 모듈의 NestJS 앱 —
  - `AuthModule`: Basic 토큰 등록/로그인, `type` 클레임을 가진 이중 시크릿 JWT 쌍,
    `jwt`/`local` Passport 전략, 리프레시 엔드포인트.
  - `UserModule`: `JwtAuthGuard` 뒤의 사용자 CRUD, bcrypt 해싱, `@Exclude` 비밀번호.
  - `FileModule`: 파일 메타데이터 CRUD; 수동 QueryRunner 트랜잭션 안의 2단계
    `temp_` → `granted_` 승격.
  - `UploadModule`: 서버가 생성한 파일명으로 `file/temp`에 저장하는 Multer
    diskStorage, 100 MB 제한.
  - Joi 검증 설정, `file/` 위의 `ServeStaticModule`, `/doc`의 Swagger, 세 서비스의
    Jest 단위 테스트.
