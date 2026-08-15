![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)

# Upload Board Project

> English version: [README.md](README.md)

인증된 사용자가 이미지·오디오·동영상 파일을 업로드하고 관리하는 NestJS REST API.
JWT 인증(Passport), TypeORM 기반 PostgreSQL, Multer 디스크 저장, 트랜잭션으로
보호되는 파일 승격, Swagger 문서화를 갖춘 로컬/포트폴리오 백엔드 프로젝트입니다 —
배포 파이프라인은 없습니다. React + Vite 브라우저 프론트엔드는 이 저장소의
`frontend/` 하위 폴더에 있으며([ADR 0010](docs/ADR/0010-frontend-split-and-api-surface-freeze.ko.md)),
이 README는 저장소 루트의 백엔드를 다룹니다.

- 기간: 6주(초기 구축), 이후 지속 개선
- 기술: TypeORM, PostgreSQL, 트랜잭션, DTO 검증, Passport, 가드, Jest, Swagger

## 문서

| 문서 | 목적 |
|---|---|
| [ARCHITECTURE.ko.md](docs/ARCHITECTURE.ko.md) | 모듈 구성, 요청 흐름, 엔티티, 관례 |
| [ADR/](docs/ADR/README.ko.md) | 아키텍처 결정 기록 — 설계 이면의 *이유* |
| [CHANGELOG.ko.md](docs/CHANGELOG.ko.md) | 버전 이력 |
| [ROADMAP.ko.md](docs/ROADMAP.ko.md) | 단계별 전체 프로젝트 계획과 알려진 공백 |
| [CONTRIBUTING.ko.md](docs/CONTRIBUTING.ko.md) | 개발 워크플로와 관례 |
| [CLAUDE.md](CLAUDE.md) | AI 협업 개발을 위한 운영 규약 |

각 문서에는 영어 원본(`.md`)과 한국어 버전(`.ko.md`)이 있습니다.

## 기능

- **인증** — HTTP Basic 토큰으로 등록/로그인; `type` 클레임을 가진 이중 시크릿
  JWT 액세스/리프레시 쌍 ([ADR 0002](docs/ADR/0002-dual-secret-token-pair.ko.md))
- **2단계 업로드** — `temp_` → `granted_` 접두사 상태 머신; DB insert와 물리 파일
  이동이 함께 커밋되거나 함께 롤백됨
  ([ADR 0003](docs/ADR/0003-two-phase-upload-contract.ko.md))
- **RBAC + 감사 로그** — `user`/`admin`/`superadmin` 역할; 소유권 검사가 "본인
  또는 admin"으로 확장되고, 역할 변경·삭제가 감사된다
  ([ADR 0013](docs/ADR/0013-rbac-and-audit-log.ko.md),
  [ADR 0007](docs/ADR/0007-ownership-checks-without-rbac.ko.md) 위에 얹힘)
- **경계 검증** — 전역 `ValidationPipe`(`whitelist` + `forbidNonWhitelisted`);
  직렬화된 엔티티는 `password`를 유출하지 않음
- **Swagger** — `/doc`에서 전체 API 문서 열람과 수동 테스트 가능

## 빠른 시작

사전 요건: Node.js 24([.nvmrc](.nvmrc) 참고)와 Corepack 기반 pnpm 10, 그리고
PostgreSQL 16 — 또는 그냥 Docker(아래 [Docker로 실행](#docker로-실행) 참고).

```bash
# 1. 의존성 설치
pnpm install

# 2. 환경 설정
cp .env.example .env        # DB 자격 증명과 토큰 시크릿을 채워 넣기

# 3. 저장 폴더가 저장소 루트에 있는지 확인:
#      file/temp/    (임시 업로드)
#      file/upload/  (승격된 파일)

# 4. 데이터베이스 생성 후 마이그레이션으로 스키마 적용 (ADR 0006)
#    DB_DATABASE에 지정한 데이터베이스를 만든 뒤(createdb / pgAdmin):
#      pnpm migration:run
#    마이그레이션 도입 이전의 스키마를 이미 가진 데이터베이스라면:
#      pnpm migration:run -- --fake     # 베이스라인을 적용 완료로 표시(1회)

# 5. 개발 서버 실행 (포트 3000)
pnpm run start:dev

# 6. Swagger UI 열기
#    http://localhost:3000/doc

# 테스트
pnpm test              # 단위 테스트
pnpm run test:cov      # 커버리지 (서비스만 측정)
```

### Docker로 실행

`docker compose`가 Postgres와 API를 함께 띄웁니다([ADR 0015](docs/ADR/0015-docker-and-compose.ko.md)).
호스트 포트 5435를 점유하는 레거시 `upload-board-pg` 컨테이너를 먼저 멈추세요.

```bash
cp .env.example .env        # 시크릿 채우기; DB_*는 compose용으로 그대로 둬도 됨
docker compose up --build   # db(postgres:16) → migrate(one-shot) → api를 :3000에 기동
```

`db` 서비스가 `${DB_PORT}`(5435)를 노출하므로, 호스트에서 돌리는 `pnpm test:e2e`와
`pnpm migration:*`도 같은 데이터베이스에 접속합니다. 마이그레이션은 `api`의 부팅 과정이
아니라 별도의 `migrate` 서비스로 실행됩니다([ADR 0032](docs/ADR/0032-migration-as-separate-deploy-step.ko.md))
— `api`는 `migrate`가 0으로 종료될 때까지 기다립니다. 이미지는 non-root 사용자로
실행됩니다([ADR 0030](docs/ADR/0030-container-non-root-and-arch-stance.ko.md)) — 네이티브
Linux 호스트에서 바인드 마운트된 `./file` 디렉터리에 쓰기가 실패하면 한 번
`chown`하세요: `sudo chown -R 1001:1001 file/` (Windows/Mac Docker Desktop은 영향
없음).

### 환경변수

필수 (부팅 시 Joi 검증 — 누락 시 즉시 실패): `ENV`, `DB_TYPE`(`postgres`),
`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `HASH_ROUNDS`,
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `ACCESS_TOKEN_SECRET_EXPIRES_IN`,
`REFRESH_TOKEN_SECRET_EXPIRES_IN`.

선택: `BASE_URL`(기본 `http://localhost:3000`; 공개 파일 URL 조합에 사용),
`CORS_ORIGIN`(미설정 = CORS 비활성; 콤마 구분 허용 목록 —
[ADR 0008](docs/ADR/0008-opt-in-cors.ko.md)), `PORT`(기본 3000),
`SUPERADMIN_EMAIL`(미설정 = 비활성; 부팅 시 해당 계정을 superadmin으로 승격 —
[ADR 0013](docs/ADR/0013-rbac-and-audit-log.ko.md)).

## API 엔드포인트

`/auth/*`를 제외한 모든 엔드포인트는 Bearer 액세스 토큰이 필요합니다.

**인증** — 리프레시 토큰은 httpOnly 쿠키(`SameSite=Strict`,
`Path=/auth/token`)로만 이동합니다; 브라우저는 refresh/signout 호출에
`credentials: 'include'`가 필요합니다
([ADR 0012](docs/ADR/0012-refresh-cookie-rotation.ko.md))
- `POST /auth/register` — Basic 토큰으로 등록 (`base64(email:password)`)
- `POST /auth/signin` — `{ accessToken }` + 리프레시 쿠키 발급 (Basic 토큰)
- `POST /auth/signin/local` — body 자격 증명으로 동일 발급 (Passport local 전략)
- `POST /auth/token/refresh` — 리프레시 쿠키를 회전시키고 새 액세스 토큰 반환;
  회수된 토큰을 재사용하면 세션이 무효화됩니다(`AUTH_REFRESH_REUSED`)
- `POST /auth/signout` — 서버 측 세션 앵커 무효화 + 쿠키 삭제 (Bearer 액세스 토큰)

**사용자** — 사용자 생성은 `POST /auth/register`이며 `POST /user`는 없습니다.
역할: `user` / `admin` / `superadmin` ([ADR 0013](docs/ADR/0013-rbac-and-audit-log.ko.md))
- `GET /user` — 사용자 목록 (admin만). `take`(1–100, 기본 20), `skip`(기본 0)로
  페이지네이션합니다; `search`는 email에 대한 대소문자 구분 없는 부분일치입니다(와일드카드는
  이스케이프됨). `sortBy`(`createdAt`|`email`|`id`, 기본 `createdAt`)와
  `order`(`ASC`|`DESC`, 기본 `DESC`)로 정렬을 제어하며, `id`가 항상 tiebreaker로
  덧붙습니다 — `GET /file`이 이미 갖고 있는 것과 같은 검색/정렬 형태입니다
  ([ADR 0021](docs/ADR/0021-list-query-search-filter-sort.ko.md)). 선언되지 않은 쿼리
  파라미터는 조용히 무시되지 않고 400 `VALIDATION_FAILED`로 거부됩니다 — 전역
  `ValidationPipe`의 `forbidNonWhitelisted`가 `?orderby=email`같은 오타를 오류로
  취급합니다. 응답은 `GET /file`과 동일한 `[users, totalCount]` 튜플입니다
- `GET /user/:id` — 사용자 조회
- `PATCH /user/:id` — 사용자 수정 (본인, 또는 자신보다 낮은 role의 계정에 대해서만 동작하는
  admin/superadmin — admin은 동급 admin이나 superadmin은 수정할 수 없다)
- `PATCH /user/:id/role` — 역할 부여 (superadmin만; 마지막 superadmin은 강등 불가)
- `DELETE /user/:id` — 사용자 삭제 (본인, 또는 위와 동일한 동급/상위 role 제한이 적용되는
  admin/superadmin). 파일을 보유한 계정은 409
  `USER_HAS_FILES`로 거절되며, `?deleteFiles=true`로 연쇄 삭제를 확인해야 계정과 파일을
  함께 삭제한다 — 되돌릴 수 없다 ([ADR 0020](docs/ADR/0020-account-deletion-cascade.ko.md)).
  해당 계정의 **게시글은 별도 확인 없이 항상 함께 삭제된다** — 이 플래그가 지키는 대상은
  미디어 바이트뿐이기 때문이다 ([ADR 0023](docs/ADR/0023-board-domain-schema.ko.md)). 확인을
  거쳤더라도 그 계정의 파일이 *다른 사용자의* 게시글에 걸려 있으면 409 `USER_FILES_IN_USE`로
  거절된다 — 그 게시글을 먼저 지워야 한다
  ([ADR 0024](docs/ADR/0024-account-cascade-fk-refusal.ko.md))

**파일**
- `POST /upload/attach` — 파일을 임시 저장소로 업로드 (100 MB 제한). 각자 고유한 클래스
  허용 목록을 가진 세 멀티파트 필드 중 정확히 하나: `image`(jpg/jpeg/png/webp), `audio`
  (mp3), `video`(mp4/mov/webm). 필드가 0개면 400 `UPLOAD_FILE_REQUIRED`, 2개 이상이면 400
  `UPLOAD_MULTIPLE_FIELDS`, 필드의 허용 목록과 맞지 않는 파일이면 400
  `UPLOAD_INVALID_TYPE` ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.ko.md)
  D4/D5, [ADR 0027](docs/ADR/0027-media-type-expansion-implementation.ko.md))
- `GET /file` — 파일 목록. 모든 쿼리 파라미터는 선택적이며 함께 조합할 수 있다. 선언되지 않은
  파라미터는 400 `VALIDATION_FAILED`로 거절된다
  ([ADR 0021](docs/ADR/0021-list-query-search-filter-sort.ko.md))

  | 파라미터 | 허용 값 | 기본값 |
  |---|---|---|
  | `take` | 1–100 | `20` |
  | `skip` | 0 이상 | `0` |
  | `search` | 제목 부분일치, 대소문자 무시, 100자 이하 (`%`와 `_`는 문자 그대로 매칭) | — |
  | `sortBy` | `createdAt` \| `title` \| `id` | `createdAt` |
  | `order` | `DESC` \| `ASC` | `DESC` |
  | `creatorId` | 유저 id | — |

  예: `GET /file?search=holiday&creatorId=3&sortBy=title&order=ASC&take=10`
- `GET /file/:id` — 파일 메타데이터 조회. `private`/`unlisted` 파일은 작성자·admin 외에게는
  404 `FILE_NOT_FOUND`로 답한다 — 존재 자체를 숨긴다
  ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.ko.md),
  [ADR 0026](docs/ADR/0026-file-visibility-implementation.ko.md))
- `GET /file/:id/content` — 저장된 파일 바이트를 스트리밍하며, `visibility`로 접근을
  검사한다: `public`은 인증 불필요, `private`은 작성자·admin의 Bearer 토큰 필요(아니면 403
  `FORBIDDEN_NOT_OWNER`), `unlisted`는 일치하는 `?share=<token>` 필요(로그인 불필요; 누락·오류·
  만료 시 403 `FILE_SHARE_INVALID`). 영상/오디오 탐색을 위한 `Range` 요청을 지원한다.
  granted 바이트를 서빙하는 **유일한** 경로다 — `ServeStaticModule`은 더 이상 `file/upload`를
  노출하지 않는다
  ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.ko.md) D1/D2,
  [ADR 0026](docs/ADR/0026-file-visibility-implementation.ko.md)). `STORAGE_DRIVER=s3`에서는
  접근 검사를 통과하면 바이트를 직접 스트리밍하는 대신 수명이 짧은 presigned S3 URL로
  `302` 리다이렉트한다 — 기본값인 `local` 드라이버에서는 동작이 그대로다
  ([ADR 0036](docs/ADR/0036-s3-presigned-content-redirect.ko.md))
- `POST /file` — 임시 파일을 영구 저장소로 승격 (트랜잭션), 기본 `visibility: private`로
  시작한다. attach로 받은 파일명은 1회용 청구 토큰이라, 다시 제출하면 청구한 본인에게는 기존
  파일을 200으로 돌려주고(멱등 재시도), 다른 사용자에게는 409 `FILE_ALREADY_CLAIMED`를
  반환합니다 ([ADR 0019](docs/ADR/0019-upload-claim-idempotency.ko.md))
- `PATCH /file/:id` — 파일 메타데이터 수정 (작성자 또는 admin), `visibility` 토글 포함.
  `unlisted`로 전환하면 `shareToken`이 발급되어 `shareUrl`로 반환된다(소유자·admin에게만);
  `rotateShareToken: true`는 이를 재발급해 이전에 공유된 링크를 모두 무효화한다; 선택적
  `shareExpiresAt`으로 만료 시각을 둘 수 있다(기본: 만료 없음)
  ([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.ko.md) D3)
- `DELETE /file/:id` — 파일 메타데이터와 저장된 물리 파일 삭제 (작성자 또는 admin). 게시글이
  참조 중인 파일은 409 `FILE_IN_USE`로 거절되므로 게시글을 먼저 지워야 한다
  ([ADR 0023](docs/ADR/0023-board-domain-schema.ko.md))

**게시글** — 게시판 본체 ([ADR 0023](docs/ADR/0023-board-domain-schema.ko.md)). 게시글은 본문과 함께
작성자 본인이 올린 파일 **하나**를 선택적으로 참조한다. 참조일 뿐 소유가 아니므로 게시글을 지워도
파일은 그대로 남는다
- `GET /post` — 게시글 목록. 쿼리 파라미터 규약은 위 `GET /file`과 동일하다
  (`take` / `skip` / `search` / `sortBy` / `order` / `creatorId`, 기본값도 같음)
- `GET /post/:id` — 작성자와 첨부 파일을 포함한 게시글 조회
- `POST /post` — 게시글 작성 (`{ title, body, fileId? }`). `fileId`는 요청자 본인이 만든 파일이어야
  하고(아니면 403 `FORBIDDEN_NOT_OWNER`, 없는 id면 404 `FILE_NOT_FOUND`), 다른 게시글이 이미
  점유하지 않은 것이어야 한다. 이 제약이 곧 멱등 키 역할을 한다 — **완전히 동일한** 본문으로 다시
  제출하면 기존 게시글을 200으로 돌려주고, 같은 `fileId`에 본문이 다르면 409 `POST_FILE_TAKEN`이다.
  `fileId` 없는 게시글은 자연 키가 없어 재제출 시 새 글이 만들어진다
- `PATCH /post/:id` — `title` / `body` 수정 (작성자 또는 admin). 첨부는 작성 시점에 고정되므로,
  영상을 떼려면 게시글을 삭제해야 한다
- `DELETE /post/:id` — 게시글 삭제 (작성자 또는 admin), 되돌릴 수 없다. 그 글의 댓글은 FK 연쇄로
  함께 사라지지만, 첨부 파일은 그대로 남는다

**댓글** — 게시글 아래 스레드 ([ADR 0023](docs/ADR/0023-board-domain-schema.ko.md)). 평면 구조이며
대댓글은 없다
- `GET /post/:postId/comment` — 한 게시글의 댓글 목록, **오래된 순**(최신순인 파일·게시글 목록과
  반대다. 정렬은 고정이라 정렬 파라미터를 받지 않는다). `take` / `skip`으로 페이지네이션한다.
  없는 글이면 404 `POST_NOT_FOUND`
- `POST /post/:postId/comment` — 댓글 작성 (`{ body }`, 1,000자 이하). 글이 없으면 404
  `POST_NOT_FOUND`. 댓글에는 유니크한 컬럼이 없어 멱등 키도 없으므로, 동일한 내용을 다시 제출하면
  **두 번째** 댓글이 만들어진다
- `PATCH /comment/:id` — `body` 수정 (작성자 또는 admin)
- `DELETE /comment/:id` — 댓글 삭제 (작성자 또는 admin), 되돌릴 수 없다. 게시글은 그대로다

게시글 작성자라고 해서 자기 글의 댓글에 **특별한 권한을 얻지는 않는다** — 수정과 삭제는 댓글
작성자 본인이나 admin의 몫이며, 그 외 누구의 것도 아니다.

**감사 로그**
- `GET /audit-log` — ROLE_CHANGE / USER_DELETE / FILE_DELETE / POST_DELETE / COMMENT_DELETE 기록 조회 (admin만; 페이지네이션, `?action` 필터). `?userId`는 해당 유저가 actor이거나 target인 기록만 반환합니다(둘 다 주어지면 두 필터가 AND로 묶입니다)

**헬스 체크** (운영용 — 애플리케이션 소비자가 아니라 로드밸런서/오케스트레이터
프로브를 위한 것이며, 설계상 인증 없음, [ADR 0031](docs/ADR/0031-health-and-readiness-endpoints.ko.md))
- `GET /health/live` — 프로세스가 살아 있는지만 확인; 의존성 체크 없음
- `GET /health/ready` — 추가로 DB 연결을 확인; 연결 불가 시 503

### 일반적인 흐름

```
POST /auth/register   (Basic)          → 사용자 생성
POST /auth/signin     (Basic)          → { accessToken } + Set-Cookie: refreshToken (httpOnly)
POST /upload/attach   (Bearer, image/audio/video 중 하나) → { filename: "temp_..." }
POST /file            (Bearer, { title, filePath: "temp_..." })
                                       → 승격(visibility: private); {BASE_URL}/file/:id/content로
                                         서빙 (PATCH /file/:id로 public/unlisted를 설정하기
                                         전까지는 Bearer 필요)
```

### 에러 응답

모든 에러는 동결된 기계 판독 가능 형태를 따릅니다
([ADR 0011](docs/ADR/0011-error-code-contract.ko.md)):

```json
{
  "statusCode": 400,
  "code": "FILE_TITLE_TAKEN",
  "message": "Title already in use.",
  "timestamp": "2026-07-23T09:00:00.000Z",
  "path": "/file/1"
}
```

분기는 반드시 `code`(안정 계약 — `backend/common/error-code.ts` 참조)로만 하고,
`message`(언제든 변경 가능)로는 하지 마세요. 검증 실패는
`code: "VALIDATION_FAILED"`에 `message` 배열이 오고, `ENV=dev`에서는 `stack`
필드가 추가됩니다.

전체 요청·데이터 흐름은 [ARCHITECTURE.ko.md](docs/ARCHITECTURE.ko.md)를 참조하세요.

## 스택

- **NestJS** (Express 플랫폼) — 모듈러 모놀리스: 단일 책임으로 분리된
  Auth / User / File / Upload
- **TypeORM + PostgreSQL** — `synchronize: false`; 파일시스템 부수효과가 DB 쓰기와
  함께 커밋되어야 하는 곳에는 수동 QueryRunner 트랜잭션
  ([ADR 0004](docs/ADR/0004-transaction-pattern-selection.ko.md))
- **Passport** — `JwtAuthGuard` / `LocalAuthGuard` 뒤의 `jwt`·`local` 전략
- **Multer** — 서버가 생성한 파일명(`temp_{uuid}_{timestamp}`)으로 디스크에 저장
- **Jest** — 소스 파일 옆에 `*.spec.ts`로 배치한 단위 테스트; 리포지토리/QueryRunner 모킹, DB 접근 없음
- **Swagger** — `/doc`, `persistAuthorization`으로 Bearer 세션 유지

## 알려진 한계

[ROADMAP.ko.md](docs/ROADMAP.ko.md)에서 추적하며, 2026-07-23부터는 단계별 전체
프로젝트 계획이기도 합니다. 요점: **Stage 1 기반이 완료**되었습니다 — 툴체인 고정,
Docker/compose, CI(GitHub Actions), 로깅 규약, e2e 재작성이 2026-07-25에 모두
반영되었고(ADR 0014–0017) e2e 스위트가 인증/소유권/페이지네이션/승격 경로를 커버합니다.
**Stage 2가 시작**되었습니다 — 고아 temp 파일 정리가 2026-07-26에 반영되었습니다
([ADR 0018](docs/ADR/0018-orphan-temp-file-cleanup.ko.md)). **파일 가시성이 2026-08-01에
반영**되었습니다 — 모든 저장 파일은 이제 `public`/`private`/`unlisted` 상태(기본
`private`)를 가지며 접근 제어된 `GET /file/:id/content`로만 서빙됩니다. `file/upload`는
더 이상 정적으로 노출되지 않습니다
([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.ko.md) D1/D2/D3/D6,
[ADR 0026](docs/ADR/0026-file-visibility-implementation.ko.md)). **미디어 타입 확장도
2026-08-01에 반영**되었습니다 — `POST /upload/attach`는 이제 각자 고유한 허용 목록을 가진
세 타입별 필드(`image`/`audio`/`video`) 중 하나를 받습니다
([ADR 0025](docs/ADR/0025-file-visibility-and-media-expansion.ko.md) D4/D5,
[ADR 0027](docs/ADR/0027-media-type-expansion-implementation.ko.md)). 두 변경 모두 아직 반영하지
않은 살아 있는 `frontend/` 소비자에게는 breaking 변경입니다. **컨테이너 하드닝이
2026-08-08에 반영**되었습니다 — 이미지 non-root 실행, liveness/readiness 엔드포인트,
마이그레이션의 별도 배포 스텝 분리
([ADR 0030](docs/ADR/0030-container-non-root-and-arch-stance.ko.md)–[ADR 0032](docs/ADR/0032-migration-as-separate-deploy-step.ko.md)).
distroless 런타임 베이스, 실제 시크릿 매니저, HTTPS 종단은 여전히 미착수 항목으로
남아 있습니다([ADR 0033](docs/ADR/0033-secrets-delivery-target.ko.md),
[ADR 0034](docs/ADR/0034-https-termination-stance.ko.md), distroless는 ROADMAP.md >
Unscheduled). `pnpm lint`는 2026-07-22 기준 클린.

## 작성자

BLUECODE77732 — https://github.com/Bluecode77732
