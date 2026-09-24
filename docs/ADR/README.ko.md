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
| [0022](0022-admin-console-import-from-chat-project.ko.md) | Chat Project에서 가져온 admin 콘솔 — 수정 기반으로서의 이식 | 승인됨 | 2026-07-30 |
| [0023](0023-board-domain-schema.ko.md) | Board 도메인 스키마 — post와 comment | 승인됨 | 2026-07-30 |
| [0024](0024-account-cascade-fk-refusal.ko.md) | 계정 연쇄 삭제 — FK 위반 500 대신 타입 있는 거절 | 승인됨 | 2026-07-31 |
| [0025](0025-file-visibility-and-media-expansion.ko.md) | 파일 가시성, 접근 제어 서빙, 미디어 타입 확장 | 승인됨 — 구현 완료(0026, 0027) | 2026-07-31 |
| [0026](0026-file-visibility-implementation.ko.md) | 파일 가시성 구현 — 서빙 방식, 메타데이터 필터링, 콘텐츠/메타데이터 노출 정책 분리 | 승인됨 | 2026-08-01 |
| [0027](0027-media-type-expansion-implementation.ko.md) | 미디어 타입 확장 구현 — 타입별 업로드 필드 | 승인됨 | 2026-08-01 |
| [0028](0028-access-token-role-claim.ko.md) | 액세스 토큰에 `role` 클레임 추가 | 승인됨 | 2026-08-05 |
| [0029](0029-storage-port-adapter.ko.md) | 스토리지 포트-어댑터 — `FileStorage` 인터페이스, 0005 개정 | 승인됨 | 2026-08-07 |
| [0030](0030-container-non-root-and-arch-stance.ko.md) | 컨테이너 non-root 실행 — distroless·멀티아치는 보류 | 승인됨 | 2026-08-08 |
| [0031](0031-health-and-readiness-endpoints.ko.md) | Liveness/Readiness 엔드포인트 | 승인됨 | 2026-08-08 |
| [0032](0032-migration-as-separate-deploy-step.ko.md) | 마이그레이션을 부팅이 아닌 별도 배포 스텝으로 분리 | 승인됨 | 2026-08-08 |
| [0033](0033-secrets-delivery-target.ko.md) | 시크릿 전달 목표 — Kubernetes Secrets, AWS Secrets Manager는 보류 | 승인됨 (설계만) | 2026-08-08 |
| [0034](0034-https-termination-stance.ko.md) | HTTPS 종단은 Ingress에서, 앱 안에서는 하지 않는다 | 승인됨 (설계만) | 2026-08-08 |
| [0035](0035-arm64-bcrypt-source-rebuild.ko.md) | arm64 지원 — bcrypt는 원래 잘 동작함(검증됨), `onlyBuiltDependencies`는 안전장치로 유지, 0030 정정 | 승인됨 | 2026-08-12 |
| [0036](0036-s3-presigned-content-redirect.ko.md) | `GET /file/:id/content`의 S3 presigned URL 리다이렉트, 0029 확장 | 승인됨 — 구현 완료 | 2026-08-13 |
| [0037](0037-helm-chart-scaffold.ko.md) | Helm 차트 — 스캐폴딩만 랜딩, 아직 이 프로젝트 전용은 아님 | 승인됨 (스캐폴딩만) | 2026-08-11 |
| [0038](0038-terraform-iac-scaffold.ko.md) | Terraform IaC — upstream EKS+Istio 예제가 그대로 랜딩, 아직 이 프로젝트 전용은 아님 | 승인됨 (스캐폴딩만) | 2026-08-11 |
| [0039](0039-db-tls-verification-stance.ko.md) | 프로덕션 DB TLS — `rejectUnauthorized: false` 제거, 실제 대상이 생기면 정식 CA로 검증 | 승인됨 | 2026-08-15 |
| [0040](0040-persisted-media-type-for-playback.ko.md) | 재생 태그 선택을 위한 영속 `mediaType` 컬럼, 0025/0027 확장 | 승인됨 | 2026-08-16 |
| [0041](0041-helm-chart-project-adaptation.ko.md) | Helm 차트 프로젝트 적응 — ADR 0037의 유예 해제 | 승인됨 | 2026-08-17 |
| [0042](0042-k8s-helm-directory-consolidation.ko.md) | `k8s/`와 `helm/` 통합 — 둘이 아니라 하나의 Kubernetes 디렉터리로 | 승인됨 | 2026-08-17 |
| [0043](0043-terraform-project-adaptation.ko.md) | Terraform 프로젝트 적응 — 이 프로젝트의 실제 AWS 리소스, 실제 apply로 검증, 0038 개정 | 승인됨 — 구현됨 (실제 apply 여부는 이 ADR과 무관하게 계속 바뀜 — ROADMAP §9 참고) | 2026-08-18 |
| [0044](0044-terraform-three-state-split.ko.md) | Terraform 3-state 분리 — cluster/addons/app-infra lifecycle 분리, 0043 개정 | 승인됨 — 구현됨 (실제 apply 여부는 이 ADR과 무관하게 계속 바뀜 — ROADMAP §9 참고) | 2026-08-19 |
| [0045](0045-audit-log-target-type.ko.md) | 감사 로그 `targetType` — 다형 `targetId`를 위한 판별자, 0013 개정 | 승인됨 — 구현됨 | 2026-08-24 |
| [0046](0046-deploy-sequence-automation.ko.md) | 배포 순서 자동화 — 로컬 쉘 스크립트, Terraform + Helm까지만 | 승인됨 — 구현됨 | 2026-08-27 |
| [0047](0047-observability-prometheus-grafana.ko.md) | 관측 가능성 스택 — Prometheus와 Grafana, eks-blueprints-addons를 통한 자체호스팅, 0017 확장 | 승인됨 | 2026-08-28 |
| [0048](0048-ci-trigger-restoration-and-docker-publish-design.ko.md) | CI 트리거 복원과 `docker-publish` 브랜치별 설계, 0016 개정 | 승인됨 — 구현됨 | 2026-08-30 |
| [0049](0049-performance-capacity-criteria.ko.md) | 성능·용량 기준 — 응답시간 목표, ADR 0021이 유예한 인덱스 채택, 디스크는 사용률 모니터링으로 | 승인됨 — 구현됨 | 2026-08-31 |
| [0050](0050-consent-based-file-ownership-transfer.ko.md) | 동의 기반 파일 소유권 이전 — 제안/수락/거절/취소, 무동의 userId 필드 대체, 0024 amend | 승인됨 — 구현됨 | 2026-09-04 |
| [0051](0051-orphaned-granted-file-reclaim.ko.md) | 고아 `granted_` 파일 회수 — DB 조인 훑기(Sweep), 리포트 우선 기본값, 0018/0029/0020 확장 | 승인됨 — 구현됨 (리포트만) | 2026-09-05 |
| [0052](0052-superadmin-seed-manual-trigger.ko.md) | Superadmin 시딩을 수동 트리거로 전환 — 부팅 시 무검증 자동 승격 제거, 0013 amend | 승인됨 — 구현됨 | 2026-09-09 |
| [0053](0053-global-rate-limiting.ko.md) | `@nestjs/throttler`를 통한 전역 요청 횟수 제한 — 최초의 전역 `APP_GUARD`, health/metrics 예외 | 승인됨 — 구현됨, e2e 검증 완료 | 2026-09-10 |
| [0054](0054-per-route-rate-limit-tuning.ko.md) | 라우트별 요청 횟수 제한 차등화 — auth/upload 강화, skipIf 기반 우회, 0053 amend | 승인됨 — 구현됨, e2e 검증 완료 | 2026-09-10 |
| [0055](0055-helmet-security-headers.ko.md) | `helmet`을 통한 보안 응답 헤더 — 전역 미들웨어, Swagger UI를 위해 CSP script-src 완화 | 승인됨 — 구현됨, 라이브 검증 완료 | 2026-09-11 |
| [0056](0056-networkpolicy-east-west-restriction.ko.md) | 클러스터 내부(east-west) 트래픽 제한용 NetworkPolicy — 아웃바운드 중심, 기본 비활성 게이팅, 0041 확장 | 승인됨 — 구현됨, kind+Calico 검증 완료 | 2026-09-11 |
| [0057](0057-terraform-state-backend-s3-native-lock.ko.md) | Terraform state 백엔드 — S3 네이티브 락, DynamoDB·KMS 없이, 0044 amends | 승인됨 — 코드 완료, 미적용 | 2026-09-12 |
| [0058](0058-ingress-path-allowlist.ko.md) | Ingress 경로 allow-list — health·metrics·docs 차단, 0041 extends | 승인됨 — 구현 완료, helm template/lint 검증 | 2026-09-13 |
| [0059](0059-upload-malware-scanning-clamav.ko.md) | 업로드 악성코드 스캔 — temp 쓰기 전 동기 ClamAV 게이트 | 승인됨 — 구현 완료, 라이브+CI+kind/Calico 검증 완료 | 2026-09-14 |
| [0060](0060-frontend-same-alb-path-routing.ko.md) | 프론트엔드 호스팅 — 같은 Helm 릴리스의 별도 nginx 워크로드를 하나의 ALB에서 경로로 분기, 0058·0010 amend, 0041 확장 | 승인됨 — 구현 완료, helm template/lint·로컬 이미지·Docker Desktop `helm install --wait`·CI 검증 (라이브 ALB 미검증) | 2026-09-21 |
| [0061](0061-shutdown-hooks-and-pid1-sigterm.ko.md) | 우아한 종료 — `enableShutdownHooks()`와 SIGTERM을 무시하던 PID 1 node, 0030 확장 | 승인됨 — 구현 완료, 컨테이너·`kind` 검증 완료(EKS 미검증) | 2026-09-21 |
| [0062](0062-admin-same-alb-subpath-routing.ko.md) | admin 콘솔 호스팅 — 같은 ALB의 세 번째 워크로드, `/admin` 서브패스, 0060·0058 확장 | 승인됨 — 구현 완료, helm template/lint·로컬 이미지·Docker Desktop `helm install --wait`·CI 실행 검증 (라이브 ALB 미검증) | 2026-09-23 |

관례: 새 ADR은 다음 번호를 사용하며 `NNNN-short-kebab-title.md`, 한국어 파일은
`NNNN-short-kebab-title.ko.md`입니다. ADR을 대체할 때는 원본을 수정하지 않고
상태를 `NNNN에 의해 대체됨`으로 바꿉니다.
