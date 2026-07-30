# 아키텍처 결정 기록 (ADR)

> English version: [README.md](README.md)

이 프로젝트의 아키텍처적으로 중요한 결정을 경량 MADR 스타일(상태 / 맥락 / 결정 /
결과)로 기록합니다. 이 결정들에서 도출된 규칙의 원천은 `CLAUDE.md`(Architecture
Decisions 섹션)이며, 각 ADR은 그 규칙 이면의 *이유*를 기록합니다.

| # | 제목 | 상태 | 결정일 |
|---|---|---|---|
| [0001](0001-basic-token-authentication.ko.md) | 등록/로그인에 HTTP Basic 토큰 사용 | 승인됨 | 2025-12-17 |
| [0002](0002-dual-secret-token-pair.ko.md) | `type` 클레임을 가진 이중 시크릿 액세스/리프레시 토큰 쌍 | 승인됨 | 2025-12-17 |
| [0003](0003-two-phase-upload-contract.ko.md) | `temp_` → `granted_` 접두사 상태 머신의 2단계 업로드 | 승인됨 | 2025-12-17 |
| [0004](0004-transaction-pattern-selection.ko.md) | 다중 쓰기별 트랜잭션 패턴 선택 기준 | 승인됨 | 2025-12-17 |
| [0005](0005-local-disk-storage.ko.md) | ServeStaticModule로 서빙하는 로컬 디스크 저장 | 승인됨 | 2025-12-17 |
| [0006](0006-schema-policy-and-migration-adoption.ko.md) | `synchronize: false` + 수동 스키마, 마이그레이션 도입 예정 | 승인됨 | 2026-07-22 |
| [0007](0007-ownership-checks-without-rbac.ko.md) | RBAC 없는 소유권 검사 | 승인됨 | 2026-07-22 |
| [0008](0008-opt-in-cors.ko.md) | `CORS_ORIGIN`을 통한 opt-in CORS | 승인됨 | 2026-07-22 |
| [0009](0009-rest-only-api-with-swagger.ko.md) | Swagger로 문서화된 REST 전용 API 계층 | 승인됨 | 2025-12-17 |
| [0010](0010-frontend-split-and-api-surface-freeze.ko.md) | 프론트엔드 분리와 API 표면 동결 | 승인됨 | 2026-07-23 |
| [0011](0011-error-code-contract.ko.md) | 기계 판독 가능한 에러 코드 계약 | 승인됨 | 2026-07-23 |
| [0012](0012-refresh-cookie-rotation.ko.md) | httpOnly 쿠키 기반 refresh 토큰과 회전·재사용 감지 | 승인됨 | 2026-07-24 |
| [0013](0013-rbac-and-audit-log.ko.md) | 역할 기반 접근 제어와 감사 로그 | 승인됨 | 2026-07-25 |
| [0014](0014-node-pnpm-version-pinning.ko.md) | Node.js·pnpm 버전 고정 | 승인됨 | 2026-07-25 |
| [0015](0015-docker-and-compose.ko.md) | 로컬 개발용 Docker·docker-compose | 승인됨 | 2026-07-25 |
| [0016](0016-github-actions-ci.ko.md) | GitHub Actions 기반 지속적 통합(CI) | 승인됨 | 2026-07-25 |
| [0017](0017-logging-conventions.ko.md) | Nest 내장 Logger 기반 로깅 규약 | 승인됨 | 2026-07-25 |
| [0018](0018-orphan-temp-file-cleanup.ko.md) | 미청구 temp 파일 스케줄 정리 | 승인됨 | 2026-07-26 |
| [0019](0019-upload-claim-idempotency.ko.md) | 업로드 중복 제출 정책 — attach 파일명을 1회용 청구 토큰으로 | 승인됨 | 2026-07-27 |
| [0020](0020-account-deletion-cascade.ko.md) | 삭제 정책 — soft delete 대신 확인 기반 계정 연쇄 삭제 | 승인됨 | 2026-07-30 |
| [0021](0021-list-query-search-filter-sort.ko.md) | 목록 조회 — 화이트리스트 정렬, ILIKE 제목 검색, 작성자 필터 | 승인됨 | 2026-07-30 |

관례: 새 ADR은 다음 번호를 사용하며 `NNNN-short-kebab-title.md`, 한국어 파일은
`NNNN-short-kebab-title.ko.md`입니다. ADR을 대체할 때는 원본을 수정하지 않고
상태를 `NNNN에 의해 대체됨`으로 바꿉니다.
