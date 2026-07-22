# 로드맵

> English version: [ROADMAP.md](ROADMAP.md)

Upload Board Project의 결정된 다음 단계와 알려진 미해결 지점. 우선순위는
보안 → 결정된 아키텍처 작업 → 위생 → 문서/테스트 순이며, 각 로드맵 항목은
독립된 전용 작업으로 진행한다 ([CLAUDE.md](CLAUDE.md) — Scope Discipline 참조).

## 결정된 로드맵 항목

### 1. TypeORM 마이그레이션 도입
- **내용**: `migration:generate` / `migration:run` 스크립트, `src/data-source.ts`,
  `src/migrations/` — 수동 "`synchronize` 임시 전환" 워크플로 대체.
- **지금인 이유**: RBAC의 `role` 컬럼을 포함한 모든 스키마 변경의 선행 조건.
- **참고**: 기존 dev DB는 수동 생성됐으므로 베이스라인 전략(초기 마이그레이션을
  적용 완료로 표시)을 첫 `migration:run` 전에 결정해야 한다.

### 2. RBAC
- **내용**: `UserEntity.role` 컬럼 + role 인식 가드/데코레이터.
- **결정된 설계 (2026-07-22)**: Chat-project 방식 — 3단계
  (`user` / `admin` / `superadmin`) + superadmin 전용 `PATCH /user/:id/role`
  엔드포인트. 소유권 검사(2026-07-22 완료)는 "본인 **또는** admin"으로 확장.
- **의존**: 마이그레이션 도입 (`role` 컬럼 필요).

## 빠른 수정 (소규모, 미일정)

- 파일을 보유한 사용자의 `DELETE /user/:id` cascade/소유권 이전 정책 결정 —
  `FileEntity.creator`가 `nullable: false`라 현재는 혼란스러운 FK 제약 500으로
  드러난다.
- 라이선스 결정: `package.json`은 `UNLICENSED`, 재작성 전 README는 MIT 주장.
  저장소 공개 전에 필요하다.

## 규모 있는 미일정 작업

- **E2E 테스트 재작성** — `test/app.e2e-spec.ts`는 Nest 템플릿 그대로
  (존재하지 않는 `GET /` 대상)이며 AppModule 부팅에 실DB가 필요하다.
  의미 있는 스위트라면 인증 흐름, 소유권 403, 페이지네이션,
  `temp_` → `granted_` 승격을 커버해야 한다.
- **dev 전이 의존성 audit 지적** — handlebars(ts-jest 경유),
  glob/minimatch(jest·@nestjs/cli 경유)가 남아 있다. 빌드/테스트 시점 전용이며
  업스트림 릴리스 대기. 런타임 지적(jws, validator)은 2026-07-22에
  `pnpm.overrides`로 핀 고정 완료.
- **Chat 프로젝트 잔재 처리** ([계획서](CHAT-REMNANT-REMOVAL-PLAN.ko.md)) —
  2026-07-22 전체 추적 문서 검토 완료: 잔재 0건(검색 결과는 의도적 부정문,
  고유 기능, 명시적 설계 참조뿐). 처리 예정: Git 히스토리 결정(과거 커밋에
  채팅 앱 CLAUDE.md 잔존) + 신규/붙여넣기 문서 재검증 트리거.

## 완료 (2026-07-22)

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
