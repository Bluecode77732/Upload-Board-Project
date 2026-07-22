# 로드맵

> English version: [ROADMAP.md](ROADMAP.md)

날짜가 아니라 우선순위 계층입니다 — 릴리스 일정이 없는 1인 포트폴리오
프로젝트입니다. 각 항목은 전용 작업으로 진행됩니다(`CLAUDE.md`의 Scope Discipline:
무관한 변경에 부수 수정을 끼워 넣지 않음). 알려진 공백은 문서화된 이탈이며 —
새 코드에서 **복제하지 마세요**.

## 최근 완료 (2026-07-22, `dev`)

- **소유권 검사** ([ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md)) —
  사용자 쓰기는 본인만, 파일 쓰기는 작성자만 (`0549ca4`).
- **`GET /file` 페이지네이션** — `GetFilesDto`(`take` 1–100 기본 20, `skip`
  기본 0) (`0549ca4`).
- **Opt-in CORS** ([ADR 0008](ADR/0008-opt-in-cors.ko.md)) — `CORS_ORIGIN`
  환경변수 (`0549ca4`).
- **`pnpm lint` 복구** — 누락됐던 `typescript-eslint` 개발 의존성 선언
  (`48ab8b7`); Prettier 저장소 전체 적용 (`7bbc6b6`). 기존 lint 오류 약 45건은
  남아 있음(알려진 공백 참조).
- **문서 세트** — README 재작성, ARCHITECTURE, CHANGELOG, ROADMAP, CONTRIBUTING,
  ADR/, 한국어 동반 파일 포함(이번 변경).

## 다음 (2026-07-22 확정)

1. **TypeORM 마이그레이션 도입**
   ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)) —
   `migration:generate`/`migration:run` 스크립트, `DataSource` CLI 설정,
   `src/migrations/`. 아래의 스키마 변경이 필요한 모든 항목의 선행 조건입니다.
   도입 전까지 스키마는 수동 적용합니다.
2. **RBAC** — `UserEntity`의 role 컬럼(스키마 변경 → 1번에 막힘) + `JwtAuthGuard`와
   합성되는 role 인식 가드. 소유권 검사를 대체하지 않고 그 위에 얹힙니다.

## 이후 (후보, 아직 미확정)

기존 README의 "Scale Up In The Future" 목록과 검토 중 발견된 공백에서 이관 —
각각 도입 전 Introduction Analysis(`CLAUDE.md`)가 필요합니다:

- 파일 타입 검증(mimetype/확장자 허용 목록) — 아래 알려진 공백 참조; 보안상 가장
  중요한 후보.
- 물리 파일 정리: `FileEntity` 행 삭제 시 디스크 파일도 삭제;
  `POST /file/uploadFile`로 소유되지 않은 고아 `temp_` 파일 청소.
- 다중 파일 업로드.
- 동영상 압축/처리.
- 대용량 업로드 진행률 추적.
- 사용자별 저장 경로.
- CI(push 시 lint + test) — 현재 파이프라인이 전혀 없음.
- 로깅 인프라(구조화 로거, 에러 트래킹) — 현재 없음.
- 클라우드 배포(원래 후보는 AWS) — [ADR 0005](ADR/0005-local-disk-storage.ko.md)
  (로컬 디스크 저장)를 다시 여는 결정이 됨.

## 알려진 공백 (문서화됨, 미배정)

| 공백 | 상세 | 위험 |
|---|---|---|
| `pnpm lint` 실패 | lint는 실행되지만(`48ab8b7`에서 복구) 45 오류 / 5 경고로 종료 — 대부분 spec 파일의 `unbound-method`와 `no-unsafe-*`/`no-floating-promises`. 0으로 줄이는 것이 남은 과제이며, 그전까지 새 오류를 만들지 말 것 | 깨끗한 lint 기준선 부재 |
| mimetype/확장자 미검증 | `POST /upload/attach`는 크기만 확인; 확장자는 `originalname`을 신뢰 | "video" 의도에도 모든 파일 타입 허용 |
| `GET /file`이 `creator` 미조인 | 목록 응답에 작성자 정보 없음(단건 `GET /file/:id`에는 있음) | 응답 형태 불일치 |
| `.env.example`에 `BASE_URL` 없음 | 선택 변수(기본 `http://localhost:3000`)가 Joi 스키마에만 존재 | 발견 가능성 |
| `upload.controller.ts` 주석 "300MB" | 실제 제한은 100,000,000바이트(100 MB) | 오해 소지 주석 |
| 파일 보유 사용자 삭제 시 FK 제약 | `FileEntity.creator`는 `nullable: false`; `DELETE /user/:id`에 cascade 경로 없음 | 해당 사례에서 혼란스러운 500 |
| 라이선스 불일치 | `package.json`은 `UNLICENSED`, 구 README는 MIT 주장 | 명시적 결정 필요 |

## 비목표 (Non-Goals)

ADR로 확정된 사항 — 명시적 요청 없이 제안 금지: 세션 기반 인증·단일 JWT 시크릿
([ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)); S3/CDN/스트리밍
([ADR 0005](ADR/0005-local-disk-storage.ko.md)); GraphQL/WebSocket/gRPC
([ADR 0009](ADR/0009-rest-only-api-with-swagger.ko.md)); `synchronize: true`
([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)).
