# 아키텍처

> English version: [ARCHITECTURE.md](ARCHITECTURE.md)

인증된 파일 업로드, 게시판 글, 댓글까지 다루는 단일 패키지 NestJS REST API입니다.
JWT 인증(Passport), TypeORM 기반 PostgreSQL, Prometheus 지표, Swagger 문서화를 씁니다.

이 문서는 저장소 루트에 있는 백엔드만 다룹니다. 같은 git 저장소 안에 다른 두 프로젝트가
더 있지만 이 문서의 대상은 아닙니다 — React + Vite 프론트엔드(`frontend/`, ADR 0010)와,
가져온 코드로 시작한 관리자 콘솔(`admin/`, ADR 0022)입니다. 둘 다 pnpm 워크스페이스가
아니라 각자 자기 `package.json`과 툴체인을 갖고 따로 빌드·테스트됩니다. 아래 내용은 이
둘과 무관합니다.

설계 결정과 그 이유는 [ADR/](ADR/)에 있습니다. 이 문서는 *현재* 구조를 설명하며, 예정된
작업은 [ROADMAP.ko.md](ROADMAP.ko.md)에 있습니다.

## 모듈 구성

```
AppModule
├── ConfigModule        — 전역 환경변수, 부팅 시 Joi로 검증(.env.example이 기준)
├── TypeOrmModule        — PostgreSQL, synchronize: false. DB_SSL을 켜면 DB 접속에 TLS를 씁니다(ADR 0039)
├── ServeStaticModule    — file/temp만 /file/temp로 정적 서빙. granted 파일은 정적 URL이 없습니다(ADR 0025/0026)
├── ScheduleModule       — TempCleanupModule의 크론 작업을 돌리는 기반
├── ThrottlerModule      — 전역 요청 횟수 제한, 기본값 분당 100회(auth 분당 5회, upload 분당 15회); THROTTLE_ENABLED가 e2e에서만 우회(ADR 0053/0054)
├── AuthModule           — 토큰 + RBAC: Basic 파싱, JWT 발급/검증, Passport 전략, 역할 가드(ADR 0013)
├── UserModule           — 사용자 CRUD, 역할 부여
├── FileModule           — 파일 메타데이터: 행, 가시성, 매체 종류, temp 승격 트랜잭션
├── PostModule           — 게시글 본문과 그에 딸린 선택적 첨부 파일(ADR 0023)
├── CommentModule        — 게시글에 매달린 댓글(ADR 0023)
├── UploadModule         — 물리 바이트를 받아 temp 객체로 임시 저장
├── AuditLogModule       — 역할 변경·삭제 같은 특권 행위를 남기는 append-only 기록
├── TempCleanupModule    — 방치된 temp 업로드를 크론으로 청소(ADR 0018)
├── HealthModule         — 프로브용 /health/live, /health/ready(ADR 0031)
├── MetricsModule        — Prometheus용 /metrics(ADR 0047)
├── APP_FILTER           — AllExceptionsFilter가 모든 에러를 ErrorBody 계약 형태로 성형(ADR 0011)
└── APP_GUARD            — ThrottlerGuard가 health/metrics를 제외한 모든 라우트를 제한; 이 앱 최초의 전역 가드(ADR 0053)
```

이 트리에 안 보이는 모듈이 하나 있는데, `AppModule`에 직접 연결되지 않기 때문입니다.
**StorageModule**은 `FileStorage` 포트(로컬 디스크 또는 S3, `STORAGE_DRIVER`로 선택)를
갖고 있고, 물리 파일을 다뤄야 하는 모듈마다 — `UploadModule`, `FileModule`, `UserModule`,
`TempCleanupModule` — 개별적으로 이걸 import합니다(ADR 0029).

모듈을 이렇게 나눈 건 의도적인 단일 책임 원칙 적용입니다(`CLAUDE.md` > Module
Responsibility 참조). "물리 파일"과 "파일 메타데이터"에 걸친 변경은 한 모듈 안에서 대충
처리할 수 있는 게 아니라, 원래부터 두 모듈의 일입니다.

### AuthModule (`backend/auth/`)

| 라우트 | 인증 | 동작 |
|---|---|---|
| `POST /auth/register` | Basic 토큰 | `Basic base64(email:password)`를 파싱하고, 중복 이메일을 거부하고, `HASH_ROUNDS`로 bcrypt 해싱해 저장합니다 |
| `POST /auth/signin` | Basic 토큰 | 자격 증명을 검증하고 `{ accessToken }`을 돌려주면서 httpOnly 리프레시 쿠키를 심습니다 |
| `POST /auth/token/refresh` | httpOnly 리프레시 쿠키 | 토큰 쌍을 회전(재사용 감지)합니다 — 새 쿠키와 새 액세스 토큰 |
| `POST /auth/signout` | Bearer 액세스 토큰 | 저장된 리프레시 토큰 해시와 쿠키를 지웁니다 |

- `AuthService`(`backend/auth/auth.service.ts`)에 이 모든 게 들어 있습니다:
  `parseBasicToken`, `validateUser`, `issueToken(user: Pick<UserEntity, 'id' | 'role'>,
  isRefreshToken)`, `verifyToken(token, isRefreshToken)`, `issueTokenPair`,
  `rotateRefreshToken`, `signOut`, `register`, `signIn`.
- 액세스·리프레시 토큰은 **서로 다른 시크릿**으로 서명되고 `payload.type: 'access' |
  'refresh'`를 담습니다. `verifyToken`이 시크릿과 type을 둘 다 확인하므로, 리프레시
  토큰을 액세스 토큰인 척 재사용할 수 없습니다([ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)).
- 액세스 토큰에는 `role` 클레임도 실려 있어서, 클라이언트가 추가 요청 없이 자기 역할을
  바로 알 수 있습니다([ADR 0028](ADR/0028-access-token-role-claim.ko.md)).
- 리프레시 토큰은 httpOnly 쿠키로만 이동합니다(`SameSite=Strict`, prod에서 `Secure`).
  그 SHA-256이 `UserEntity.refreshTokenHash`에 앵커로 저장되며, 회수된 토큰을 재사용하면
  세션 전체가 401 `AUTH_REFRESH_REUSED`로 무효화됩니다([ADR 0012](ADR/0012-refresh-cookie-rotation.ko.md)).
  계정당 세션은 1개입니다.
- **RBAC(ADR 0013)**: 역할은 `user` / `admin` / `superadmin` 세 단계이고,
  `ROLE_RANK`(`backend/auth/role/role.ts`)로 순위가 매겨집니다. `RolesGuard` +
  `@Roles(min)`이 핸들러에 최소 등급을 강제하고, `@Roles`가 없는 핸들러는 `JwtAuthGuard`
  이상의 제약이 없습니다. `@AuthUser()` 데코레이터는 검증된 JWT에서 바로 `{ id, role }`을
  꺼내 줍니다 — 절대 요청 본문에서 오지 않습니다.
- 전략: `JwtStrategy`(`"jwt-auth-guard"`, `UserService.findOne`으로 사용자를 로드하고
  `password`를 제거). `JwtModule.register({})`가 비어 있는 건 의도된 것입니다 —
  시크릿 두 개가 동시에 쓰이므로 호출마다 시크릿을 따로 넘깁니다.

### UserModule (`backend/user/`)

모든 라우트는 `JwtAuthGuard` 뒤에 있습니다.

| 라우트 | 동작 |
|---|---|
| `GET /user` | **admin 전용** — 목록에 모든 계정의 이메일이 드러나기 때문입니다. `GetFilesDto`와 같은 형태로 페이지네이션·검색·정렬을 지원합니다(ADR 0021 대응) |
| `GET /user/:id` | 인증된 사용자라면 누구나 |
| `PATCH /user/:id` | 본인, 또는 자기보다 등급이 확실히 낮은 계정을 대상으로 한 admin. 비밀번호가 오면 `HASH_ROUNDS`로 다시 해싱합니다 |
| `PATCH /user/:id/role` | **superadmin 전용** — `UserEntity.role`을 바꿀 수 있는 유일한 경로입니다. 마지막 superadmin을 강등시키는 건 거부되고, 대상의 리프레시 세션은 즉시 끊깁니다(ADR 0013) |
| `DELETE /user/:id` | 본인 또는 admin, 하드 삭제. 파일을 보유한 계정은 `?deleteFiles=true`가 있어야 게시글·댓글·파일 행과 물리 파일까지 함께 지워집니다. 없으면 409 `USER_HAS_FILES`(ADR 0020) |

- **`POST /user`는 일부러 없습니다** — 계정 생성은 `POST /auth/register`로만 합니다.
- 삭제 트랜잭션은 `UserService.remove`가 소유하고, `CommentService` → `PostService` →
  `FileService` 순서로 위임합니다. 댓글을 먼저 지우는 이유는, 이 계정이 *다른 사람의*
  게시글에 남긴 댓글은 게시글 FK 연쇄만으로는 지워지지 않기 때문입니다. 물리 파일은
  트랜잭션이 커밋된 뒤에만 unlink됩니다([ADR 0020](ADR/0020-account-deletion-cascade.ko.md),
  [ADR 0023](ADR/0023-board-domain-schema.ko.md)).
- `UserModule`은 `UserService`를 export합니다 — 이게 이 모듈의 유일한 공개 계약이고,
  `JwtStrategy`의 토큰 검증이 이걸 씁니다.

### FileModule (`backend/file/`)

컨트롤러가 둘로 나뉘어 있는데, 기준은 URL 접두사가 아니라 인증 요건입니다
([ADR 0026](ADR/0026-file-visibility-implementation.ko.md)).

**FileController** — `JwtAuthGuard` 뒤:

| 라우트 | 동작 |
|---|---|
| `GET /file` | 페이지네이션 목록, 제목 검색·작성자·정렬 필터(ADR 0021). 소유자도 admin도 아닌 요청자에게는 `private`/`unlisted` 행이 아예 보이지 않습니다 |
| `GET /file/:id` | 메타데이터 + 작성자. 소유자도 admin도 아니면 403이 아니라 404로 숨깁니다 — 존재 여부 자체를 드러내지 않기 위해서입니다 |
| `POST /file` | 첨부된 temp 파일을 승격합니다: DB insert와 물리 이동을 한 번에 함께 처리합니다. temp 파일명은 1회용 청구 토큰이라, 재제출하면 먼저 청구한 사람에게는 replay(200), 다른 사람에게는 409 `FILE_ALREADY_CLAIMED`가 됩니다(ADR 0019) |
| `PATCH /file/:id` | 작성자 또는 admin. 제목, `granted_` filePath, 소유권 재할당, 가시성 전환까지 전부 이 엔드포인트 하나로 처리합니다 — 가시성만 따로 바꾸는 엔드포인트는 없습니다 |
| `DELETE /file/:id` | 작성자 또는 admin, 하드 삭제. 행을 먼저 지우고 나서 저장된 파일을 unlink합니다(ADR 0020) |

**FileContentController** — `OptionalJwtAuthGuard` 뒤(토큰이 있어도 없어도 동작합니다):

| 라우트 | 동작 |
|---|---|
| `GET /file/:id/content` | 실제로 파일 바이트를 돌려주는 유일한 경로입니다 |

- 저장된 파일마다 `visibility`가 있습니다: `public` / `private` / `unlisted`(기본값
  `private` — 갓 올린 파일은 소유자가 공개로 바꾸기 전까지 아무도 못 봅니다).
  `resolveContentAccess`가 모든 읽기가 반드시 통과해야 하는 단일 관문입니다 — public은
  조건 없음, private는 소유자·admin만, unlisted는 로그인 없이 `?share=<token>`이 맞아야
  통과합니다([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)/[ADR 0026](ADR/0026-file-visibility-implementation.ko.md)).
- `mediaType`(`image` / `audio` / `video`)은 업로드 시점에 확장자로 판정되며 클라이언트
  값을 절대 믿지 않습니다 — 프런트엔드가 `<img>` / `<audio>` / `<video>` 중 어떤 태그를
  쓸지 이걸로 고릅니다([ADR 0040](ADR/0040-persisted-media-type-for-playback.ko.md)).
- 이 컨트롤러는 파일시스템을 직접 만지지 않습니다. 먼저 `FileStorage` 포트에 서명된
  URL을 요청하고, 어댑터가 줄 수 있으면(S3만) 302로 리다이렉트하고 바이트를 직접 읽지
  않습니다. 못 주면(로컬 디스크) `stat()`/`createReadStream()`으로 폴백하는데, Range도
  완전히 지원합니다 — 영상·오디오 탐색용 206 부분 응답, 범위를 벗어나면 416
  ([ADR 0029](ADR/0029-storage-port-adapter.ko.md), [ADR 0036](ADR/0036-s3-presigned-content-redirect.ko.md)).
- `FileService.uploadFile` / `updateFile`이 수동 QueryRunner 트랜잭션을 쓰는 이유는
  물리 `rename`/`promote`가 DB 트랜잭션 경계 *안에* 있어야 하기 때문입니다 — 비-DB
  부수효과가 그 경계 안으로 들어가야 하는 유일한 지점입니다
  ([ADR 0004](ADR/0004-transaction-pattern-selection.ko.md)). 삭제는 반대입니다: 행을
  먼저 지우고 커밋된 뒤에만 물리 unlink를 실행합니다. unlink는 되돌릴 수 없기
  때문입니다.
- 응답은 `FileService.toResponse()`가 `FileResponseDto`로 만듭니다. `fileUrl`은 정적
  경로가 아니라 콘텐츠 엔드포인트를 가리키고, `shareUrl`은 `unlisted` 파일을 관리할 수
  있는 사람에게만 보입니다.

### PostModule (`backend/post/`)

모든 라우트는 `JwtAuthGuard` 뒤에 있습니다.

| 라우트 | 동작 |
|---|---|
| `GET /post` | 페이지네이션, 최신순 — 제목 검색·작성자 필터·정렬(`GET /file`과 같은 형태) |
| `GET /post/:id` | 게시글, 작성자, 첨부 파일 |
| `POST /post` | 게시글을 만들고, 원한다면 요청자가 소유한 파일을 하나 첨부합니다. 같은 파일을 같은 내용으로 두 번 첨부하면 에러 대신 replay(200)됩니다 — 게시글에는 그 이상의 자연스러운 멱등성 키가 없기 때문입니다(ADR 0023) |
| `PATCH /post/:id` | 작성자 또는 admin |
| `DELETE /post/:id` | 작성자 또는 admin. 댓글은 DB 레벨 연쇄로 함께 사라지고, 첨부 파일은 그대로 남습니다 — 게시글은 파일을 참조할 뿐 소유하지 않기 때문입니다 |

- `PostService`는 `file.creator`를 직접 들여다보지 않습니다 — 파일을 첨부해도 되는지는
  `FileModule`의 판단이고(`assertAttachableBy`), `PostModule`은 그 관계를 직접 파고들지
  않고 그냥 묻기만 합니다([ADR 0023](ADR/0023-board-domain-schema.ko.md)).
- `PostModule`은 `UserModule`의 계정 삭제 연쇄를 위해 `PostService`를 export합니다.

### CommentModule (`backend/comment/`)

URL 접두사가 둘이라 컨트롤러도 둘입니다 — 스레드는 게시글에 매달려 있지만, 이미 있는
댓글은 자기 자신의 id로 다룹니다.

| 라우트 | 동작 |
|---|---|
| `GET /post/:postId/comment` | 오래된 순(스레드는 쓰인 순서대로 읽혀야 하므로) — 순서가 고정이라 정렬 파라미터가 없습니다 |
| `POST /post/:postId/comment` | 댓글을 만듭니다. 자연스러운 멱등성 키가 없어서, 같은 내용을 다시 보내면 그냥 댓글이 하나 더 생깁니다(문서화된 대로 받아들인 동작이고, 파일 없는 게시글과 같은 취급입니다) |
| `PATCH /comment/:id` | 작성자 또는 admin |
| `DELETE /comment/:id` | 작성자 또는 admin |

- `CommentModule`은 `post_entity`를 직접 조회하지 않고 `PostModule`에게 게시글이
  존재하는지 묻습니다(`assertPostExists`) — `PostModule`이 `FileModule`을 대하는 것과
  같은 "직접 파지 말고 물어보라" 규칙입니다.
- comment→post 외래키는 이 스키마에서 유일한 DB 레벨 `ON DELETE CASCADE`입니다. 댓글은
  게시글 밖에서 독립적으로 존재할 이유가 없어서, 행이 사라지기 전에 따로 읽어야 할 게
  없기 때문입니다([ADR 0023](ADR/0023-board-domain-schema.ko.md) D3).

### UploadModule (`backend/upload/`)

| 라우트 | 동작 |
|---|---|
| `POST /upload/attach` | `image`, `audio`, `video` 세 멀티파트 필드 중 정확히 하나를 첨부합니다 — 필드마다 확장자/mimetype 허용 목록이 따로 있습니다. 100MB 제한. `{ filename }`을 반환합니다 |

- Multer는 파일을 직접 디스크에 쓰지 않고 메모리에 버퍼링만 합니다 — 실제 쓰기는
  `FileStorage` 포트를 거칩니다(`UploadService.stageTemp`). 그래서 temp 파일의 첫
  바이트부터 이미 설정된 어댑터를 통과합니다 — 승격된 사본만이 아니라
  ([ADR 0029](ADR/0029-storage-port-adapter.ko.md) D4).
- 생성되는 이름은 항상 `temp_{uuid}_{timestamp}.{ext}` 형태입니다. 클라이언트는
  `POST /file`에서 이 이름을 그대로 돌려줄 뿐, 경로를 스스로 고르는 일은 없습니다.

### StorageModule (`backend/storage/`)

도메인 모듈이 아니라 운영 모듈입니다 — 물리 파일을 만지는 모듈들이 공유합니다.

- `FileStorage`가 포트입니다: `saveTemp`, `existsTemp`, `promote`, `stat`,
  `createReadStream`, `unlink`, `listTemp`, `getSignedReadUrl`. 소비하는 쪽은 모두
  `FILE_STORAGE` 토큰으로 주입받고, `fs/promises`를 직접 호출하지 않습니다.
- 어댑터는 둘입니다. `STORAGE_DRIVER`로 고릅니다(`local` 기본 | `s3`): `LocalDiskStorage`
  (원래 있던 디스크 방식)와 `S3Storage`(SDK를 모킹한 단위 테스트만 있고, 실제 버킷에는
  아직 붙여본 적 없음). `getSignedReadUrl`만 어댑터마다 실제로 다르게 동작합니다 —
  로컬은 그런 개념이 없어서 `null`, S3는 짧게 유효한 서명 URL을 돌려줍니다
  ([ADR 0029](ADR/0029-storage-port-adapter.ko.md), [ADR 0036](ADR/0036-s3-presigned-content-redirect.ko.md)).

### AuditLogModule (`backend/audit-log/`)

특권 행위가 남에게 한 일 — 역할 변경, 파일·게시글·댓글 삭제 — 을 남기는 append-only
기록입니다.

- 행마다 `{ actorId, targetId, targetType, action, detail }`을 담습니다. `targetType`
  (`user` / `file` / `post` / `comment`)이 없으면 `targetId`만으로는 파일 id인지 유저
  id인지 구별할 수 없어서, 유저 기준 필터링이 엉뚱한 종류의 행까지 걸러낼 수
  있습니다([ADR 0045](ADR/0045-audit-log-target-type.ko.md)).
- `actorId`/`targetId`는 일부러 외래키가 **아닙니다** — 유저를 하드 삭제해도 그 삭제
  사실을 적어 둔 감사 기록까지 같이 사라지면 안 되기 때문입니다.
- `GET /audit-log`는 admin 전용입니다. `AuditLogModule`은 `AuditLogService`를
  export하고, `UserModule`·`FileModule`·`PostModule`·`CommentModule`이 각자 행위를
  기록할 때 씁니다.

### TempCleanupModule (`backend/temp-cleanup/`)

이것도 도메인 모듈이 아니라 운영 모듈입니다 — `UploadModule`의 역할을 temp 쓰기 하나로
좁게 유지하고, 청소는 따로 떼어 놨습니다([ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)).

- `TempCleanupService`가 부팅 시 `SchedulerRegistry`로 자기 크론 작업을 등록합니다
  (스케줄, TTL, dry-run 모드가 전부 `TEMP_SWEEP_*` 환경변수로 결정됩니다). 매 틱마다
  `FileStorage` 포트로 temp 객체 목록을 받으므로, 어느 어댑터를 쓰든 동일하게
  동작합니다.
- `TEMP_SWEEP_TTL_HOURS`를 넘기도록 아무도 청구하지 않은 `temp_` 객체는 삭제됩니다.
  `granted_` 객체는 애초에 후보조차 되지 않습니다 — 접두사 자체가 "아직 `temp_`면
  아무도 소유하지 않은 것"이라는 안전한, DB 없이도 판단 가능한 신호이기 때문입니다.

### HealthModule (`backend/health/`)

일부러 인증을 걸지 않았습니다 — kubelet이나 로드밸런서 프로브는 Bearer 토큰을 들고 오지
않습니다([ADR 0031](ADR/0031-health-and-readiness-endpoints.ko.md)).

| 라우트 | 동작 |
|---|---|
| `GET /health/live` | 의존성 확인 없이 "프로세스가 HTTP에 응답하는가"만 봅니다 |
| `GET /health/ready` | DB에 핑을 날립니다. 연결이 안 되면 503을 돌려줘서 오케스트레이터가 이 인스턴스로 트래픽을 그만 보내게 합니다 |

### MetricsModule (`backend/metrics/`)

이것도 `HealthModule`처럼 인증이 없습니다 — Prometheus의 스크레이프도 Bearer 토큰을
갖고 오지 않기 때문입니다([ADR 0047](ADR/0047-observability-prometheus-grafana.ko.md)).

| 라우트 | 동작 |
|---|---|
| `GET /metrics` | Prometheus exposition 포맷 스냅샷(`prom-client`) |

- 전역 `MetricsInterceptor`가 모든 라우트의 요청별 소요 시간을 기록합니다.
- 도메인 카운터 둘은 나중에 따로 붙인 게 아니라 실제 이벤트가 일어나는 자리에
  있습니다: `FileService`의 `uploadClaimsTotal`(신규 청구 vs. replay)과
  `TempCleanupService`의 `tempCleanupDeletedTotal`입니다.

## 요청 흐름

### 가드 체인

아래 인증 체인보다 먼저, 전역 `ThrottlerGuard`(`APP_GUARD`)가 모든 요청에 대해 돌면서
요청 횟수를 제한합니다 — 기본값 분당 100회. 이건 인증과는 별개의, 직교하는 레이어입니다 —
토큰이 있든 없든 돌고, 여기서 막히면 `JwtAuthGuard`까지 아예 가지도 못합니다
([ADR 0053](ADR/0053-global-rate-limiting.ko.md)). 분당 100회 한도는 **앱 전체가 나눠
쓰는 하나의 풀이 아니라 라우트별로 독립적**입니다 — 라이브러리 기본 키는 컨트롤러
클래스+핸들러 메서드+클라이언트 IP를 해시한 값이라, 같은 클라이언트라도 `GET /file`과
`POST /auth/signin`은 서로 다른 두 카운터로 추적됩니다 — `GET /file`을 한도 이상으로
두드려 429를 받은 직후 같은 클라이언트로 `POST /auth/signin`을 호출해 전혀 영향받지
않음을 실측으로 확인했습니다.

두 라우트 그룹은 핸들러에 `@Throttle({ default: { limit, ttl } })`를 붙여 이 기본값을
더 낮게 오버라이드합니다([ADR 0054](ADR/0054-per-route-rate-limit-tuning.ko.md)):
`POST /auth/register`, `POST /auth/signin`, `POST /auth/token/refresh`는 분당 5회까지만
허용합니다(무차별 대입 공격의 대상이 될 자격 증명 확인 지점이기 때문). `POST
/upload/attach`는 분당 15회까지만 허용합니다(소유권 확인보다 먼저 매 호출마다
`file/temp`에 파일을 씁니다). `POST /auth/signout`은 분당 100회 기본값 그대로입니다 —
이미 유효한 액세스 토큰이 있어야 호출 가능해서 자격 증명 추측 경로가 아닙니다.
`THROTTLE_ENABLED=false`(e2e 전용 우회, 아래 Config 참고)는 `limit`을 부풀리는 대신
모듈 수준 `skipIf`로 구현되어 있어, 기본값과 이 라우트별 오버라이드 모두를 한 번에
끕니다.

대부분의 컨트롤러는 클래스 레벨로 가드됩니다:

```
요청 → ThrottlerGuard (APP_GUARD, 전역 — 라우트별 기본값 분당 100회, ADR 0053)
     → JwtAuthGuard (Passport "jwt-auth-guard")
     → JwtStrategy.validate (UserService.findOne으로 사용자 로드, password 제거)
     → request.user
     → [RolesGuard + @Roles(min), 이걸 선언한 핸들러에서만]
     → 핸들러 (@AuthUser()는 { id, role }을, @UserId()는 id만 읽음)
```

이 *인증* 체인 밖에 있는 라우트가 셋 있습니다. `GET /file/:id/content`는
`OptionalJwtAuthGuard`를 써서 로그인 안 한 방문자도 public/unlisted 파일에 닿을 수
있고, `GET /health/*`와 `GET /metrics`는 아예 인증 가드가 없습니다 — 프로브도
Prometheus 스크레이프도 Bearer 토큰을 제시할 방법이 없기 때문입니다. `GET /health/*`와
`GET /metrics`는 `ThrottlerGuard` 자체에서도 유일하게 예외 처리된 라우트입니다
(`@SkipThrottle()`) — 프로브나 스크레이프는 일반 사용자 트래픽과 달리 파드가 떠 있는
내내 고정 간격으로 반복되도록 설계돼 있고, 한도가 라우트별이기 때문에 그 반복만으로
**그 라우트 자신의** 한도가 소진될 수 있습니다(짧은 probe 주기, 또는 여러 replica가
같은 egress IP를 공유하는 경우) — 무관한 다른 앱 트래픽과 경쟁하는 문제가 아니라,
다른 라우트의 호출은 애초에 이 카운터에 전혀 반영되지 않습니다(ADR 0053).

쓰기 권한은 기본적으로 소유권 기반입니다(본인만 / 작성자만). 그것만으로 부족한 소수의
라우트에는 RBAC이 그 위에 얹힙니다 — 대상보다 확실히 높은 등급이 필요하거나, admin
전용 목록 조회처럼요([ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md),
[ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)).

### 경계 검증

전역 `ValidationPipe`(`backend/main.ts`)는 `transform + whitelist +
forbidNonWhitelisted + enableImplicitConversion`을 실행합니다. DTO에 선언되지 않은
요청 필드는 서비스에 도달하지 못합니다 — 서비스는 검증된 입력을 신뢰하고 그 모양을
다시 확인하지 않습니다.

### 에러 응답 (`ErrorBody`)

던져진 모든 에러는 — `HttpException`이든 아니든 — 전역 `AllExceptionsFilter`를 거쳐
`{ statusCode, code, message, timestamp, path }` 모양으로 나가고, `ENV=dev`일 때만
`stack`이 붙습니다. 스로우 지점은 `{ code: ErrorCode.X, message }`를 실어 던지고, 코드
없이 던져진 예외는 상태 기반 폴백을 받고, `HttpException`이 아닌 에러는 바깥으로
`"Internal server error"`만 남깁니다([ADR 0011](ADR/0011-error-code-contract.ko.md)).
클라이언트는 `code`로만 분기해야 합니다 — `message`는 언제든 바뀔 수 있습니다.

### 2단계 업로드 (`temp_` → `granted_`)

```
1. POST /upload/attach   (multipart: image, audio, 또는 video)
      └─ UploadService.stageTemp가 FileStorage 포트를 통해
         file/temp/temp_{uuid}_{ts}.{ext} 를 씀     → { filename } 반환

2. POST /file  { title, filePath: <그 파일명> }
      └─ FileService.uploadFile, 트랜잭션을 열기 전에(ADR 0019):
           이 사용자가 이미 청구       → 기존 행을 200으로 replay
           다른 사용자가 청구         → 409 FILE_ALREADY_CLAIMED
           뒤를 받쳐 줄 temp 객체 없음 → 400 FILE_INVALID_PATH
         미청구 파일명일 때만, 하나의 QueryRunner 트랜잭션 안에서:
           a. FileEntity INSERT (filePath를 file/upload/granted_...로 재작성,
              mediaType은 확장자로 판정, visibility는 기본값 private)
           b. storage.promote(temp 키 → granted 키)
           c. commit   (실패 시 rollback; release()는 finally)

3. 이 행의 바이트는 이제 GET /file/:id/content로만 닿을 수 있고,
   그 가시성(public / private / unlisted)에 따라 접근이 걸립니다 — 정적 URL은 없습니다.
```

접두사는 상태 머신입니다: `temp_`는 "업로드는 됐지만 아직 아무도 안 가짐", `granted_`는
"DB 행이 가짐"을 뜻합니다. 파일명은 항상 서버가 만듭니다 — 클라이언트는 그걸 그대로
돌려줄 뿐, 경로를 스스로 고르지 않습니다([ADR 0003](ADR/0003-two-phase-upload-contract.ko.md)).
아무도 청구하지 않은 `temp_` 객체는 TTL을 넘기면 `TempCleanupModule`이
치웁니다([ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)).

## 엔티티 (TypeORM)

```
UserEntity                          FileEntity
├── id             PK               ├── id            PK
├── email          unique           ├── title         unique
├── password       @Exclude         ├── filePath      "file/upload/granted_..."
├── role            'user'|'admin'|'superadmin', 기본값 'user' (ADR 0013)
├── refreshTokenHash  @Exclude, nullable (회전 앵커 — ADR 0012)
├── creator        OneToMany ─────► ├── creator       ManyToOne (nullable: false, cascade: true)
├── createdAt                       ├── mediaType      'image'|'audio'|'video' (ADR 0040)
└── updatedAt                       ├── visibility     'public'|'private'|'unlisted', 기본값 'private'
                                     ├── shareToken     nullable (unlisted일 때만 — ADR 0025)
                                     ├── shareExpiresAt nullable
                                     ├── createdAt
                                     └── updatedAt

PostEntity                          CommentEntity
├── id             PK               ├── id            PK
├── title          unique 아님       ├── body          text, 1,000자 이하(DTO에서 제한)
├── body           text             ├── creator       ManyToOne (nullable: false)
├── creator        ManyToOne        ├── post          ManyToOne, ON DELETE CASCADE
├── file           OneToOne, nullable, unique          (이 스키마의 유일한 DB 레벨 연쇄)
├── createdAt                       ├── createdAt
└── updatedAt                       └── updatedAt
```

- `PostEntity`/`CommentEntity`의 관계는 일부러 **단방향**입니다 — `UserEntity`나
  `FileEntity`에 역방향 컬렉션을 두지 않습니다. 어차피 아무 쿼리도 그걸 안 읽기
  때문입니다([ADR 0023](ADR/0023-board-domain-schema.ko.md)).
- `FileEntity.title`과 `PostEntity.title`은 겉보기와 달리 같은 종류의 unique가 아닙니다.
  파일 제목은 테이블 전체에서 유일해야 하지만, 게시글 제목은 아예 유일할 필요가
  없습니다(모든 작성자를 통틀어 제목 하나를 한 번만 쓸 수 있는 게시판이라면, 그건
  기능이 아니라 버그입니다).
- `FileEntity`/`PostEntity` 둘 다 `(createdAt, id)` 인덱스와 `creator` 인덱스, 그리고
  검색용 `title` `pg_trgm` GIN 인덱스를 갖고 있습니다 — 셋 다 1만 개 행을 넣고 실제
  쿼리를 재본 뒤에 채택한 것입니다([ADR 0049](ADR/0049-performance-capacity-criteria.ko.md)).
  trigram 인덱스는 마이그레이션 SQL에만 있습니다 — `@Index`로는 연산자 클래스를 표현할
  수 없어서, `migration:generate`를 돌리면 계속 "이걸 지워라"는 diff가 나올 겁니다.
  실제 변경이 아니라 예상된 노이즈입니다.
- 공유 베이스 엔티티는 없습니다 — 타임스탬프를 엔티티마다 따로 선언한 건 의도적입니다.
  달리 공유할 게 없기 때문입니다.
- 스키마 변경은 TypeORM 마이그레이션으로 배포합니다(`backend/migrations/`,
  `pnpm migration:run`으로 적용). `synchronize: false`는 계속 커밋된 상태로
  둡니다([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)).

## 설정

모든 환경변수는 `backend/app.module.ts`에서 부팅 시 Joi로 검증됩니다. 하나라도 빠지면
부팅이 실패합니다. 접근은 항상 `ConfigService`를 거칩니다(필수는 `getOrThrow`, 선택은
기본값과 함께 `get`) — `process.env`를 직접 읽지 않습니다.

DB/JWT/해싱 같은 기본값 말고도, 특정 기능을 위한 그룹이 몇 개 더 있습니다:

- **DB TLS**: `DB_SSL`(기본 꺼짐), `DB_SSL_CA` — 대상 Postgres가 암호화 연결을
  강제할 때(예: RDS의 기본값) 둘 다 필요합니다(ADR 0039).
- **저장소 어댑터**: `STORAGE_DRIVER`(`local` 기본 | `s3`), `S3_BUCKET`/`AWS_REGION`
  (`s3`일 때만 필수), `CONTENT_SIGNED_URL_TTL_SECONDS`(기본 300 — 서명된 콘텐츠 URL이
  얼마나 유효한지)(ADR 0029, ADR 0036).
- **고아 파일 청소**: `TEMP_SWEEP_ENABLED`(기본 켜짐), `TEMP_SWEEP_CRON`,
  `TEMP_SWEEP_TTL_HOURS`(기본 24), `TEMP_SWEEP_DRY_RUN`(ADR 0018).
- **RBAC 시드**: `SUPERADMIN_EMAIL` — 선택 사항이며, `pnpm promote-superadmin`이
  superadmin으로 승격시킬 대상 계정을 지정합니다(부팅 시 자동이 아니라 수동 단계 —
  [ADR 0052](ADR/0052-superadmin-seed-manual-trigger.ko.md)).
- **요청 횟수 제한**: `THROTTLE_ENABLED`(기본 켜짐) — dev/prod를 가르는 스위치가 아니라,
  `test/e2e-env.ts`가 e2e 스위트의 수백 건 요청 동안 전역 한도와 라우트별 auth/upload
  강화 한도를 모듈 수준 `skipIf`로 한 번에 우회하기 위한 용도로만 존재합니다
  ([ADR 0053](ADR/0053-global-rate-limiting.ko.md), [ADR 0054](ADR/0054-per-route-rate-limit-tuning.ko.md)).
- **선택 사항**: `BASE_URL`(기본 `http://localhost:3000`), `CORS_ORIGIN`(미설정 =
  CORS 꺼짐; 브라우저 프론트엔드가 필요할 때 콤마로 구분한 허용 목록 — ADR 0008).

새 환경변수를 추가할 때는 항상 Joi 스키마와 `.env.example`을 같은 변경에서 함께
갱신해야 합니다.

## API 문서화

REST 전용이며 `/doc`의 Swagger로 문서화됩니다(`persistAuthorization: true`라서 붙여넣은
Bearer 토큰이 새로고침해도 남습니다)([ADR 0009](ADR/0009-rest-only-api-with-swagger.ko.md)).
모든 컨트롤러는 `@ApiTags`를 달고, 보호된 컨트롤러는 `@ApiBearerAuth`를, Basic 토큰
엔드포인트는 `@ApiBasicAuth`를 답니다. `/doc` 자체는 `ENV`로 가려지지 **않습니다** —
이 프로젝트의 유일한 API 문서이지, prod에서 숨겨야 할 디버그 도구가 아니기 때문입니다.

## 테스트

- 단위 테스트는 소스 옆에 `*.spec.ts`로 둡니다. Jest 설정은 `package.json`에
  내장돼 있습니다(`roots: ["backend"]`). 커버리지는 서비스와 `backend/common/`만
  측정합니다 — 컨트롤러·가드·전략·DTO·엔티티·모듈은 얇은 프레임워크 배선이라
  단위 커버리지보다 e2e로 검증하는 게 더 맞기 때문입니다.
- `fs/promises`와 `bcrypt`는 모킹됩니다(`jest.mock(...)`). `QueryRunner`는 모킹된
  `DataSource`가 돌려주는, `jest.fn()`으로 이루어진 평범한 객체입니다. 어떤 테스트도
  실제 DB에 닿지 않습니다.
- `test/*.e2e-spec.ts`(`pnpm test:e2e`)는 실제 DB를 씁니다 — 다만 매번 버리는 전용
  Postgres 데이터베이스입니다. 실제 마이그레이션으로 만들어지고, 테스트 사이마다
  비워지고, 끝나면 삭제됩니다. 인증·소유권·페이지네이션·승격 경로를 끝까지
  검증합니다.

## 인프라

이 문서는 백엔드 자체가 어떻게 만들어졌는지만 다룹니다. 실제로 이걸 무엇으로
돌리는지는 다른 곳에서 다루므로, 여기서 또 낡는 일이 없게 합니다.

- **로컬 개발**: `docker-compose.yml`이 Postgres, 1회성 마이그레이션 작업, API를
  차례로 띄웁니다([ADR 0015](ADR/0015-docker-and-compose.ko.md); non-root 사용자와
  `/health/live` 기반 `HEALTHCHECK`로 강화됨 —
  [ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md)/[ADR 0032](ADR/0032-migration-as-separate-deploy-step.ko.md)).
- **CI**: GitHub Actions가 린트, 단위·e2e 테스트를 돌리고 나서 멀티 아키텍처 Docker
  이미지를 빌드·배포합니다([ADR 0016](ADR/0016-github-actions-ci.ko.md), [ADR 0048](ADR/0048-ci-trigger-restoration-and-docker-publish-design.ko.md)로
  확장됨). 아직 CD 단계는 없습니다 — CI 안에서 `helm upgrade`를 실행하는 곳은
  없습니다.
- **클라우드 배포**: Helm 차트(`k8s/helm/`)와 별개의 Terraform 루트 모듈 세 개
  (`k8s/infra/terraform/`)로 Prometheus/Grafana까지 붙은 실제 EKS 클러스터를 띄울 수
  있습니다(ADR 0041–0044, [ADR 0047](ADR/0047-observability-prometheus-grafana.ko.md)).
  이미 한 번 끝까지 검증됐고, 그 뒤 AWS 비용을 막으려고 다시 정리됐습니다. 지금 이
  인프라가 실제로 떠 있는지는 이 문단만 보고 판단할 일이 아니라 그때그때의
  사실입니다 — `CLAUDE.md`의 Terraform 항목을 보거나 세 디렉터리에서 각각
  `terraform plan`을 돌려 확인하세요.

자세한 내용은 여기가 아니라 [README.md](../README.md)(Stack, Deployment)와
[ROADMAP.ko.md](ROADMAP.ko.md)에 있습니다 — 같은 내용을 두 곳에 적어 두면 딱 두 곳이
동시에 낡는 지름길이 될 뿐입니다.
