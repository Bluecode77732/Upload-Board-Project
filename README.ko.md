![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)

# Upload Board Project

> English version: [README.md](README.md)

인증된 사용자가 동영상 파일을 업로드하고 관리하는 NestJS REST API.
JWT 인증(Passport), TypeORM 기반 PostgreSQL, Multer 디스크 저장, 트랜잭션으로
보호되는 파일 승격, Swagger 문서화를 갖춘 로컬/포트폴리오 백엔드 프로젝트입니다 —
프론트엔드와 배포 파이프라인은 없습니다.

- 기간: 6주(초기 구축), 이후 지속 개선
- 기술: TypeORM, PostgreSQL, 트랜잭션, DTO 검증, Passport, 가드, Jest, Swagger

## 문서

| 문서 | 목적 |
|---|---|
| [ARCHITECTURE.ko.md](ARCHITECTURE.ko.md) | 모듈 구성, 요청 흐름, 엔티티, 관례 |
| [ADR/](ADR/README.ko.md) | 아키텍처 결정 기록 — 설계 이면의 *이유* |
| [CHANGELOG.ko.md](CHANGELOG.ko.md) | 버전 이력 |
| [ROADMAP.ko.md](ROADMAP.ko.md) | 단계별 전체 프로젝트 계획과 알려진 공백 |
| [CONTRIBUTING.ko.md](CONTRIBUTING.ko.md) | 개발 워크플로와 관례 |
| [CLAUDE.md](CLAUDE.md) | AI 협업 개발을 위한 운영 규약 |

각 문서에는 영어 원본(`.md`)과 한국어 버전(`.ko.md`)이 있습니다.

## 기능

- **인증** — HTTP Basic 토큰으로 등록/로그인; `type` 클레임을 가진 이중 시크릿
  JWT 액세스/리프레시 쌍 ([ADR 0002](ADR/0002-dual-secret-token-pair.ko.md))
- **2단계 업로드** — `temp_` → `granted_` 접두사 상태 머신; DB insert와 물리 파일
  이동이 함께 커밋되거나 함께 롤백됨
  ([ADR 0003](ADR/0003-two-phase-upload-contract.ko.md))
- **소유권 검사** — 사용자 쓰기는 본인만, 파일 쓰기는 작성자만
  ([ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md))
- **경계 검증** — 전역 `ValidationPipe`(`whitelist` + `forbidNonWhitelisted`);
  직렬화된 엔티티는 `password`를 유출하지 않음
- **Swagger** — `/doc`에서 전체 API 문서 열람과 수동 테스트 가능

## 빠른 시작

사전 요건: Node.js ≥ 18, PostgreSQL ≥ 14, pnpm.

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

### 환경변수

필수 (부팅 시 Joi 검증 — 누락 시 즉시 실패): `ENV`, `DB_TYPE`(`postgres`),
`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, `HASH_ROUNDS`,
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `ACCESS_TOKEN_SECRET_EXPIRES_IN`,
`REFRESH_TOKEN_SECRET_EXPIRES_IN`.

선택: `BASE_URL`(기본 `http://localhost:3000`; 공개 파일 URL 조합에 사용),
`CORS_ORIGIN`(미설정 = CORS 비활성; 콤마 구분 허용 목록 —
[ADR 0008](ADR/0008-opt-in-cors.ko.md)), `PORT`(기본 3000).

## API 엔드포인트

`/auth/*`를 제외한 모든 엔드포인트는 Bearer 액세스 토큰이 필요합니다.

**인증**
- `POST /auth/register` — Basic 토큰으로 등록 (`base64(email:password)`)
- `POST /auth/signin` — `{ refreshToken, accessToken }` 발급 (Basic 토큰)
- `POST /auth/signin/local` — body 자격 증명으로 동일 발급 (Passport local 전략)
- `POST /auth/token/refreshaccess` — 새 액세스 토큰 (Bearer 리프레시 토큰)

**사용자** — 사용자 생성은 `POST /auth/register`이며 `POST /user`는 없습니다
- `GET /user` — 사용자 목록
- `GET /user/:id` — 사용자 조회
- `PATCH /user/:id` — 사용자 수정 (본인만)
- `DELETE /user/:id` — 사용자 삭제 (본인만)

**파일**
- `POST /upload/attach` — 동영상을 임시 저장소로 업로드 (multipart 필드 `video`, 100 MB 제한)
- `GET /file` — 파일 목록 (페이지네이션: `take` 1–100, 기본 20 / `skip` 기본 0)
- `GET /file/:id` — 파일 메타데이터 조회
- `POST /file/uploadFile` — 임시 파일을 영구 저장소로 승격 (트랜잭션)
- `PATCH /file/patch/:id` — 파일 메타데이터 수정 (작성자만)
- `DELETE /file/delete/:id` — 파일 메타데이터 삭제 (작성자만)

### 일반적인 흐름

```
POST /auth/register   (Basic)          → 사용자 생성
POST /auth/signin     (Basic)          → { refreshToken, accessToken }
POST /upload/attach   (Bearer, video)  → { filename: "temp_..." }
POST /file/uploadFile (Bearer, { title, filePath: "temp_..." })
                                       → 승격; {BASE_URL}/file/upload/granted_... 로 서빙
```

전체 요청·데이터 흐름은 [ARCHITECTURE.ko.md](ARCHITECTURE.ko.md)를 참조하세요.

## 스택

- **NestJS** (Express 플랫폼) — 모듈러 모놀리스: 단일 책임으로 분리된
  Auth / User / File / Upload
- **TypeORM + PostgreSQL** — `synchronize: false`; 파일시스템 부수효과가 DB 쓰기와
  함께 커밋되어야 하는 곳에는 수동 QueryRunner 트랜잭션
  ([ADR 0004](ADR/0004-transaction-pattern-selection.ko.md))
- **Passport** — `JwtAuthGuard` / `LocalAuthGuard` 뒤의 `jwt`·`local` 전략
- **Multer** — 서버가 생성한 파일명(`temp_{uuid}_{timestamp}`)으로 디스크에 저장
- **Jest** — 소스 파일 옆에 `*.spec.ts`로 배치한 단위 테스트; 리포지토리/QueryRunner 모킹, DB 접근 없음
- **Swagger** — `/doc`, `persistAuthorization`으로 Bearer 세션 유지

## 알려진 한계

[ROADMAP.ko.md](ROADMAP.ko.md)에서 추적하며, 2026-07-23부터는 단계별 전체
프로젝트 계획이기도 합니다. 요점: RBAC 미도입(소유권 검사만 — RBAC이 다음 전용
작업), e2e 스위트는 아직 Nest 템플릿 그대로, CI/Docker/로깅 인프라 부재(Stage 1
확정 로드맵 항목). 업로드는 mp4/mov/webm 허용 목록을 강제하며 `pnpm lint`는
2026-07-22 기준 클린.

## 작성자

BLUECODE77732 — https://github.com/Bluecode77732
