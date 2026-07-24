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
- Auth 응답 직렬화: `AuthController`에 `ClassSerializerInterceptor`가 없어
  `POST /auth/register`가 bcrypt `password` 해시(기존 결함)와 신규
  `refreshTokenHash`를 노출했다 — 인터셉터 없이는 `@Exclude`가 동작하지
  않는다. ADR 0012 플로 라이브 검증에서 발견.
- Refresh 토큰에 무작위 `jti` 클레임 추가: 같은 초에 발급된 두 토큰이
  바이트 단위로 동일해(`sub`/`type`/`iat`/`exp` 동일 → 서명 동일) 회전
  재사용 감지가 무력화되던 문제.

### 보안
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
