# 아키텍처

> English version: [ARCHITECTURE.md](ARCHITECTURE.md)

인증된 사용자의 동영상 파일 업로드·관리를 위한 단일 패키지 NestJS REST API.
JWT 인증(Passport), TypeORM 기반 PostgreSQL, Multer 디스크 저장, Swagger 문서화.
배포 파이프라인 없음 — 로컬/포트폴리오 백엔드 프로젝트. 이 문서는 저장소
루트의 백엔드를 설명하며, React + Vite 프론트엔드는 `frontend/` 하위
폴더(ADR 0010)에 있고 pnpm workspace 모노레포가 아니다 — 아래 백엔드 구성은
그 영향을 받지 않는다.

설계 결정과 그 근거는 [ADR/](ADR/)에 기록되어 있습니다. 이 문서는 *현재* 구조를
설명하며, 예정된 작업은 [ROADMAP.ko.md](ROADMAP.ko.md)에 있습니다.

## 모듈 구성

```
AppModule
├── ConfigModule        — 전역, Joi 검증 환경변수 (.env.example이 기준)
├── TypeOrmModule       — PostgreSQL, synchronize: false, 엔티티: FileEntity, UserEntity
├── ServeStaticModule   — ./file 폴더를 URL 접두사 /file 로 정적 서빙
├── AuthModule          — 토큰 전담: Basic 파싱, JWT 발급/검증, Passport 전략
├── UserModule          — 사용자 CRUD 전담; UserService export (JwtStrategy가 소비)
├── FileModule          — 파일 *메타데이터* 전담: FileEntity 행 + temp 승격 트랜잭션
├── UploadModule        — *물리* 파일 전담: Multer diskStorage; 컨트롤러 전용, DB 접근 없음
└── APP_FILTER          — AllExceptionsFilter (backend/common/filter/): 모든 에러를 ErrorBody 계약으로 성형 (ADR 0011)
```

모듈 책임은 의도적인 SRP 분리입니다(`CLAUDE.md` > Module Responsibility 참조):
"물리 파일"과 "파일 메타데이터"에 걸친 변경은 설계상 두 모듈의 작업입니다.

### AuthModule (`backend/auth/`)

| 라우트 | 인증 | 동작 |
|---|---|---|
| `POST /auth/register` | Basic 토큰 | `Basic base64(email:password)` 파싱, 중복 이메일 거부, `HASH_ROUNDS`로 bcrypt 해싱 후 저장 |
| `POST /auth/signin` | Basic 토큰 | 자격 증명 검증 후 `{ accessToken }` 반환 + httpOnly 리프레시 쿠키 설정 |
| `POST /auth/signin/local` | Body 자격 증명 | Passport `local-auth-guard` 전략으로 동일 |
| `POST /auth/token/refresh` | httpOnly 리프레시 쿠키 | 쌍을 회전(재사용 감지) — 새 쿠키 + 새 액세스 토큰 |
| `POST /auth/signout` | Bearer 액세스 토큰 | 저장된 리프레시 토큰 해시와 쿠키를 삭제 |

- `AuthService` (`backend/auth/auth.service.ts`): `parseBasicToken`, `verifyToken(token, isRefreshToken)`,
  `validateUser`, `issueToken(user: Pick<UserEntity, 'id'>, isRefreshToken)`, `issueTokenPair`,
  `rotateRefreshToken`, `signOut`, `register`, `signIn`.
- 액세스·리프레시 토큰은 **별도 시크릿**(`ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET`)으로
  서명되며 `payload.type: 'access' | 'refresh'`를 담습니다. `verifyToken`은 대응하는
  시크릿으로 검증하고 **동시에** `type` 클레임을 확인하므로, 리프레시 토큰을 액세스 토큰으로
  재사용할 수 없습니다 ([ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)).
- 리프레시 토큰은 httpOnly 쿠키(`refreshToken`: `SameSite=Strict`, `Path=/auth/token`,
  prod에서 `Secure`, `Max-Age` = 리프레시 만료)로만 이동합니다. 그 SHA-256이
  `UserEntity.refreshTokenHash`에 앵커로 저장되고 `POST /auth/token/refresh`가 회전시킵니다 —
  회수된 토큰을 재사용하면 세션 전체가 401 `AUTH_REFRESH_REUSED`로 무효화됩니다
  ([ADR 0012](ADR/0012-refresh-cookie-rotation.ko.md)). 계정당 1세션입니다.
- 전략: `JwtStrategy`(이름 `"jwt-auth-guard"`, 액세스 토큰 검증, `UserService.findOne`으로
  사용자 로드 후 `password` 제거), `LocalStrategy`(이름 `"local-auth-guard"`).
- `JwtModule.register({})`가 비어 있는 것은 의도된 것입니다 — 두 개의 시크릿이 쓰이므로
  `issueToken`에서 호출별로 시크릿을 공급합니다.
- `AuthModule`은 `UserService`를 위해 `UserModule`을 import합니다 (`exports`/`imports`를
  통한 DI — 다른 모듈의 프로바이더를 재선언하지 않음).

### UserModule (`backend/user/`)

모든 라우트는 `JwtAuthGuard` 뒤에 있으며, 컨트롤러에 `ClassSerializerInterceptor`가 있어
`UserEntity.password`(`@Exclude({ toPlainOnly: true })`)는 API 밖으로 나가지 않습니다.

| 라우트 | 동작 |
|---|---|
| `GET /user` | 사용자 목록 (`findAndCount`) |
| `GET /user/:id` | 단일 사용자 또는 404 |
| `PATCH /user/:id` | **본인만** — 비밀번호 제공 시 `HASH_ROUNDS`로 재해싱 |
| `DELETE /user/:id` | **본인만** — 하드 삭제 |

- **`POST /user`는 의도적으로 없습니다** — 등록은 `POST /auth/register`입니다.
- 본인 확인은 `@UserId()`(JWT 신원)와 경로 id를 비교해 불일치 시 `ForbiddenException`을
  던집니다 ([ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md)).
- `@UserId` 데코레이터(`backend/user/decorator/userId.decorator.ts`)는 `JwtStrategy.validate`가
  채운 `request.user.id`를 읽습니다 — 신원은 절대 body에서 오지 않습니다.
- `UserModule`은 `UserService`를 export하며, 이것이 모듈의 공개 계약입니다
  (`JwtStrategy`의 토큰 검증에 소비됨).

### FileModule (`backend/file/`)

모든 라우트는 `JwtAuthGuard` 뒤에 있습니다.

| 라우트 | 동작 |
|---|---|
| `GET /file` | 페이지네이션 목록 — `GetFilesDto`: `take` 1–100(기본 20), `skip` ≥ 0(기본 0) |
| `GET /file/:id` | 메타데이터 + creator 조인, 없으면 404 |
| `POST /file` | temp 파일 승격: DB insert + 물리 rename을 한 트랜잭션에서 수행 |
| `PATCH /file/:id` | **작성자만** — 제목(중복 검사), `granted_` filePath, 소유권 재할당 |
| `DELETE /file/:id` | **작성자만** — 메타데이터 행 하드 삭제 |

- `FileService.uploadFile` / `updateFile`은 **수동 QueryRunner** 트랜잭션 패턴을 사용합니다
  (`createQueryRunner → connect → startTransaction → commit/rollback → release`,
  `release()`는 항상 `finally`). 비-DB 부수효과(물리 `rename`)가 트랜잭션 경계 안에
  들어가야 하기 때문입니다 ([ADR 0004](ADR/0004-transaction-pattern-selection.ko.md)).
- 응답은 `FileService.toResponse()`가 `FileResponseDto`로 변환하며, `fileUrl`은
  `ConfigService`를 통해 `{BASE_URL}/{filePath}`로 조합됩니다. 엔티티에는 표현 로직이
  없습니다(엔티티의 구 `@Transform` URL은 의도적으로 제거됨).

### UploadModule (`backend/upload/`)

| 라우트 | 동작 |
|---|---|
| `POST /upload/attach` | multipart 필드 `video` → Multer diskStorage가 `file/temp/temp_{uuid}_{timestamp}.{ext}` 기록, 100 MB 제한, `{ filename }` 반환 |

- 컨트롤러 전용 모듈: 서비스도 DB 접근도 없음 — 설계상 물리 파일 관심사는
  메타데이터 관심사와 섞이지 않습니다.
- 업로드는 Multer `fileFilter`로 mp4/mov/webm의 mimetype **및** 확장자 허용 목록을
  강제합니다(두 값 모두 클라이언트가 보내는 것이므로, 오남용을 걸러내는 허용
  목록이지 내용물 보증은 아닙니다).

## 요청 흐름

### 가드 체인

인증 컨트롤러를 제외한 모든 컨트롤러는 클래스 레벨로 가드됩니다:

```
요청 → JwtAuthGuard (Passport "jwt-auth-guard")
     → JwtStrategy.validate (UserService.findOne으로 사용자 로드, password 제거)
     → request.user
     → 핸들러 (@UserId()가 request.user.id를 읽음)
```

역할(role)은 없습니다 — 인증된 모든 사용자는 동등합니다. 쓰기 권한은 핸들러/서비스
레벨의 소유권 기반(본인만 / 작성자만)입니다
([ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md)).

### 경계 검증

전역 `ValidationPipe`(`backend/main.ts`)는 `transform + whitelist + forbidNonWhitelisted +
enableImplicitConversion`을 실행합니다 — DTO에 선언되지 않은 요청 필드는 서비스에
도달하지 않습니다. 서비스는 검증된 입력을 신뢰합니다(경계 전용 검증).

### 에러 응답 (`ErrorBody`)

던져진 모든 에러는 — `HttpException`이든 아니든 — 전역
`AllExceptionsFilter`(`backend/common/filter/all-exceptions.filter.ts`, `app.module.ts`의
`APP_FILTER`로 등록)를 거쳐 동결된 `ErrorBody` 계약(`backend/common/error-code.ts`)으로
성형됩니다: `{ statusCode, code, message, timestamp, path }` + `ENV=dev`일 때만
`stack`. 스로우 지점은 `{ code: ErrorCode.X, message }`를 실어 던지고, 코드 없이
던져진 예외는 상태 기반 폴백을 받으며, `message`가 배열인 400은
`VALIDATION_FAILED`(ValidationPipe의 시그니처)로 분류되고, `HttpException`이 아닌
오류는 바깥으로 `"Internal server error"`만 남깁니다
([ADR 0011](ADR/0011-error-code-contract.ko.md)). 클라이언트 분기는 `code`로만 —
`message`는 언제든 바뀔 수 있습니다.

### 2단계 업로드 (`temp_` → `granted_`)

```
1. POST /upload/attach   (multipart "video")
      └─ Multer가 file/temp/temp_{uuid}_{ts}.{ext} 기록  → { filename } 반환

2. POST /file  { title, filePath: <그 파일명> }
      └─ FileService.uploadFile, 하나의 QueryRunner 트랜잭션 안에서:
           a. FileEntity INSERT (filePath를 file/upload/granted_... 로 재작성)
           b. file/temp/temp_...  →  file/upload/granted_...  물리 rename
           c. commit  (실패 시 rollback; release()는 finally)

3. 파일은 {BASE_URL}/file/upload/granted_... 로 공개 서빙 (ServeStaticModule)
   API 응답에서는 FileResponseDto의 fileUrl로 노출.
```

접두사는 상태 머신입니다: `temp_` = "업로드됐지만 미소유", `granted_` = "DB 행이 소유".
정적 서빙이 두 폴더 모두를 노출하므로, 접두사가 파일 수명주기 상태의 유일한 표식입니다.
`UpdateFileDto.filePath`는 `temp_` 값을 거부하고 `granted_` 값만 허용합니다. 파일명은
서버가 생성(uuid + timestamp)하며 클라이언트는 그것을 되돌려줄 뿐이므로, 클라이언트가
선택한 경로 조각이 파일시스템에 닿는 일이 없습니다
([ADR 0003](ADR/0003-two-phase-upload-contract.ko.md)).

## 엔티티 (TypeORM)

```
UserEntity                          FileEntity
├── id          PK                  ├── id        PK
├── email       unique              ├── title     unique
├── password    @Exclude(toPlain)   ├── filePath  ("file/upload/granted_...")
├── refreshTokenHash  @Exclude, nullable (회전 앵커 — ADR 0012)
├── creator     OneToMany ────────► ├── creator   ManyToOne (nullable: false, cascade: true)
├── createdAt                       ├── createdAt
└── updatedAt                       └── updatedAt
```

- 관계 프로퍼티 이름은 **양쪽 모두** `creator`입니다 — 이 명명을 따르세요.
- 공유 베이스 엔티티는 없으며 타임스탬프는 엔티티별로 선언됩니다.
- `FileEntity.creator`는 `nullable: false`입니다 — 파일을 소유한 사용자를 삭제하면
  FK 제약에 걸립니다(문서화된 하드 삭제 주의점, `CLAUDE.md` > Scope Discipline 참조).
- 스키마 관리: `synchronize: false`가 커밋되어 있으며, 스키마 변경은 TypeORM
  마이그레이션으로 배포합니다 — CLI DataSource `backend/data-source.ts`,
  `backend/migrations/`(베이스라인 `InitialSchema`), 적용은 `pnpm migration:run`
  ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)).

## 설정

- 모든 환경변수는 `backend/app.module.ts`에서 Joi로 시작 시 검증됩니다. 누락 시 부팅에서 throw.
- 접근은 `ConfigService`로만 합니다(필수는 `getOrThrow`, 선택은 기본값과 함께 `get`) —
  `process.env` 직접 접근 금지.
- 선택 변수: `BASE_URL`(기본 `http://localhost:3000`), `CORS_ORIGIN`
  (미설정 = CORS 비활성; 설정 시 콤마 구분 허용 목록 —
  [ADR 0008](ADR/0008-opt-in-cors.ko.md)).
- 새 환경변수는 같은 변경에서 Joi 스키마와 `.env.example` **둘 다** 갱신해야 합니다.

## API 문서화

REST 전용이며 `/doc`의 Swagger로 문서화됩니다(`persistAuthorization: true`)
([ADR 0009](ADR/0009-rest-only-api-with-swagger.ko.md)). 모든 컨트롤러는 `@ApiTags`,
보호된 컨트롤러는 `@ApiBearerAuth`, Basic 토큰 엔드포인트는 `@ApiBasicAuth`를 답니다.

## 테스트

- 단위 테스트는 소스 옆의 `*.spec.ts`이며, Jest 설정은 `package.json`에 내장
  (`roots: ["src"]`). 커버리지는 **서비스와 `backend/common/`**(예외 필터·에러 코드
  카탈로그)을 측정합니다(컨트롤러·가드·전략·DTO·엔티티·모듈은
  `coveragePathIgnorePatterns`로 제외).
- `fs/promises`는 `jest.mock('fs/promises')`, `bcrypt`는 `jest.mock('bcrypt')`로 모킹.
- QueryRunner는 `jest.fn()`으로 이루어진 평범한 객체로 모킹하고, 모킹된 `DataSource`가
  이를 반환합니다.
- 테스트에서 DB 직접 접근은 금지 — 리포지토리 모킹만 사용.

## 존재하지 않는 인프라 (가정 금지)

- CI 워크플로, Dockerfile, git hook, 배포 대상 없음.
- 로깅 인프라 없음(winston 없음, Nest `Logger` 미사용, 에러 트래킹 없음).
