# 로드맵

> English version: [ROADMAP.md](ROADMAP.md)

Sharenpo의 전체 계획서. 2026-07-23에 11개 축(본질 → 방법론 → 설계
기준 → 아키텍처 → 모듈 → 도메인 → 메커니즘 → 자료 처리 → 플랫폼 → 인프라 →
배포 환경) 순서의 결정 검토를 거쳐 수립했다. 같은 날 프론트엔드 분리
결정([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))으로
개정되어, Stage 0 앞에 Stage F(프론트엔드 준비)가 삽입되었다. 2026-07-30에
[ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)로 다시 개정되어
**Stage 5(운영 화면 — admin 콘솔)가 추가되었다**: 11축 검토는 admin 화면에 어떤
단계도 배정하지 않았는데, ADR 0010이 그 배치는 이미 결정해 뒀던 탓에 그 작업은
"결정은 있으나 계획에는 자리가 없는" 상태로 남아 있었다. 2026-07-31에
[ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)로 한 번 더 개정되어
**Stage 4의 "VOD 재생 접근 제어" 행을 일반화**했다 — 파일 가시성(공개/비공개/
링크공유), 전체 미디어의 접근 제어 서빙, 미디어 타입 확장으로, 프로젝트 창립 목표를
다시 정리하며 드러난 공백이다. 아래 모든 항목은 각각 독립된 설계·검토를 거치는
전용 작업으로 진행한다 ([CLAUDE.md](../CLAUDE.md) > Scope Discipline).

> **정합성 안내**: 이 계획의 항목 중 CLAUDE.md가 "명시적 요청 없이는 제안 금지"로
> 표시한 것들(CI, Docker, 클라우드 스토리지/배포)은 **2026-07-23 명시적 결정**으로
> 이 계획에 편입되었다. 각 전용 작업이 실제로 완료되기 전까지는(각자의 ADR 포함)
> 현행 Architecture Decisions가 그대로 유효하다.

## 현재 위치 (2026-07-31 기준)

- 2026-07-22 하드닝 런은 모두 반영 완료됐다: 보안 quick-win, lint 0 오류
  베이스라인, 문서 재작성, TypeORM 마이그레이션 도입(`79603ad`,
  [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)), 이어서
  `.ko.md` 문서 전반의 한국어 유창성 패스(`dc1ad72`)까지.
- 이 계획서 자체는 2026-07-23의 11축 결정 검토로 수립되었다.
- 2026-07-23 프론트엔드 분리 결정([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)):
  프론트엔드는 이 저장소 안의 `frontend/` 하위 폴더로 두어(백엔드는 루트에
  그대로) HTTP로 이 API를 소비하며, admin은 그 안의 `/admin` 라우트 구역으로
  시작한다. RBAC은 Stage F 뒤로 재배치 — RBAC은 API 표면을 바꾸지 않고 권한만
  더하므로 미뤄도 프론트엔드 재작업이 없고, 표면 동결을 먼저 하면 실제 재작업을
  아낀다. (구조는 2026-07-24 개정: 별도 저장소 → 저장소 내 하위 폴더.)
- 라우트 정리·계약 동결은 2026-07-23 반영 완료: `POST /file`, `PATCH /file/:id`,
  `DELETE /file/:id`, `POST /auth/token/refresh`가 정식 라우트이며, API 표면은
  이제 동결 상태다(ADR 0010).
- 에러 코드 계약은 2026-07-23에 완료되었다
  ([ADR 0011](ADR/0011-error-code-contract.ko.md)): 모든 에러 응답이 전역 예외
  필터를 거쳐 안정적인 기계 판독 가능 `code`를 싣는다.
- refresh 토큰 httpOnly 쿠키 전환 + 회전/재사용 감지는 2026-07-24 반영
  완료([ADR 0012](ADR/0012-refresh-cookie-rotation.ko.md)) — **Stage F 완결**:
  프론트엔드가 의존할 API 표면·에러 계약·인증 전송이 모두 확정되었다.
  `frontend/` 하위 폴더는 2026-07-24 생성됨(React + Vite, 인증 수직 슬라이스
  E2E 검증). RBAC은 API 표면을 바꾸지 않으므로 병행 가능하다.
- RBAC + 감사 로그는 2026-07-25 반영 완료
  ([ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)) — **Stage 0 완결**:
  `user`/`admin`/`superadmin` 역할, RolesGuard, 소유권을 "본인 또는 admin"으로
  확장, superadmin 전용 역할 부여, append-only 감사 로그. 역할 체계가 프론트엔드
  `/admin` 구역을 받친다.
- **Stage 1 기반은 완결됐다** (2026-07-25): Node/pnpm 고정, Docker/compose, CI,
  로깅 규약, E2E 재작성이 모두 반영됐다 (ADR 0014–0017).
- **Stage 2가 진행 중이다**: 고아 temp 파일 정리가 2026-07-26 반영됐고
  ([ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)) — 신규 운영 모듈
  `TempCleanupModule`의 스케줄 `@nestjs/schedule` 스윕 — 업로드 중복 제출 정책이
  2026-07-27 반영됐다 ([ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)): attach가
  발급한 파일명이 1회용 청구 토큰이라, 재시도는 에러 대신 replay(200)로 응답한다.
  삭제 정책은 2026-07-30 반영됐다 ([ADR 0020](ADR/0020-account-deletion-cascade.ko.md)):
  soft delete는 채택하지 않고, 계정은 명시적인 `deleteFiles=true`가 있을 때만 자기 파일까지
  연쇄 삭제하며, 기존 FK 위반 500은 타입 있는 409가 됐다 — **Stage 2가 완결됐다**.
- **Stage 3이 완결됐다 (2026-07-31)**: 목록 검색/필터/정렬이 2026-07-30 반영됐다
  ([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)) — `GET /file`이 `search`,
  `creatorId`, `sortBy`, `order`를 받고, 정렬 키는 코드 내 화이트리스트로만 해석되며,
  이 엔드포인트에 없던 결정적 기본 정렬이 생겼다. 이어서 2026-07-30에 게시판 도메인의
  **스키마 설계 게이트**가 반영됐고 ([ADR 0023](ADR/0023-board-domain-schema.ko.md)) —
  post와 comment를 코드 없이 평문으로 함께 확정했다 — 그 구현 두 절반이 2026-07-31에
  착지했다: comment가 post에 의존하므로 post 모듈이 먼저, 그다음 comment 모듈, 그 사이에
  [ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)가 post↔file 불변식 gap을 정리했다.
  **이 프로젝트 이름이 가리키는 게시판이 이제 실제로 존재한다**: 영상을 선택적으로 첨부한
  게시글과 그 아래 스레드.
- **Stage 5(운영 화면 — admin 콘솔)가 2026-07-30 추가됐다**
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)). 원래 계획의 공백을
  닫은 것이다: ADR 0010은 2026-07-23에 admin이 어디에 살지 결정했지만, 그것을 만드는
  작업을 어느 단계도 맡지 않았다. 같은 변경에서 Chat Project의 admin 콘솔을 미적응
  수정 기반으로 `admin/`에 가져왔다. Stage 5는 아직 아무것도 시작하지 않았고, 첫 행
  — 클라이언트가 자기 역할을 어떻게 아는가 — 이 나머지를 막는 백엔드 결정이다.
  Stage 4에 의존하지 **않으며** 그보다 먼저 진행될 수도 있다.
- **남은 작업의 실행 순번을 2026-07-31에 고정했다**(6절 > 실행 순번 참조):
  ~~#1 게시판 comment 모듈~~(✅ 2026-07-31 완료) → ~~#2 `GET /user` 페이지네이션~~(✅
  2026-08-05 완료, Stage 5에서 앞당김) →
  ~~#3 Stage 5 admin 화면~~(✅ **2026-08-06 완료** — role 전달[ADR 0028], `admin/`의
  역할 관리 조각을 이 백엔드의 실제 라우트에 맞게 적응, 모더레이션 존재 여부 "아니오"로
  결론, 중복 admin 화면을 `admin/` 쪽으로 정리하며
  `frontend/src/features/admin/AdminPage.tsx` 삭제까지 네 행 모두 완료) →
  **남은 작업은 Stage 4(프로덕션 전환), 이제 다음**. 마지막 두 작업은 **프로덕션 DevOps 스택
  도입(AWS · Docker · Kubernetes · Helm · GitHub Actions · Prometheus · Grafana · Terraform ·
  Istio [Terraform 이후 예정])**, 그다음 **배포 자체**다 — 배포는 "N번째 단계"가 아니라 전체
  계획의 종착 행위이므로 **의도적으로 번호를 붙이지 않는다**(번호는 Stage 4/Stage 5 순서
  혼동을 다시 부를 뿐이다). 이로써 Stage 5의 부동 위치가 Stage 4 앞으로 확정되고, 독립적인
  페이지네이션 부채가 둘보다 앞으로 당겨진다.
- **파일 가시성 + 미디어 타입 확장을 2026-07-31에 결정했다**(설계 게이트,
  [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)): 프로젝트 창립 목표를
  다시 정리하니 공백 둘이 드러났다 — 저장된 모든 파일이 공개로만 서빙되어 비공개/링크공유
  선택지가 없고, 업로드 허용 목록이 영상 전용이다. 결정은 3-상태 `visibility`(공개/비공개/
  **링크공유**, 회전 가능한 공유 토큰 + 선택적 TTL), 접근 제어 `GET /file/:id/content`
  엔드포인트(그래서 `ServeStaticModule`이 `file/upload` 노출을 중단), 이미지+오디오+영상
  타입별 업로드 필드를 더한다. **Stage 4의 "VOD 재생 접근 제어" 행을 일반화하며 대체**하고,
  배포 대상과 독립적이므로 배포보다 앞에 둘 수 있다.
- ~~**가시성 + 접근 제어 서빙을 2026-08-01에 구현했다**~~ ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)
  D1/D2/D3/D6 + [ADR 0026](ADR/0026-file-visibility-implementation.ko.md)): 마이그레이션이
  적용됐고(라인 단위로 검토), `GET /file/:id/content`가 Range 지원과 함께 살아 있으며,
  `GET /file`·`GET /file/:id`는 비소유자에게 private/unlisted 메타데이터를 필터링한다.
- ~~**미디어 타입 확장을 2026-08-01에 구현했다**~~ ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)
  D4/D5 + [ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md)): `POST
  /upload/attach`는 이제 단일 `video` 필드 대신 `image`/`audio`/`video` 타입별 필드 세 개를
  받으며, 각각 자신만의 클래스 허용 목록을 가진다. 스키마 변경은 없다. ~~새
  `fileUrl`/`visibility` 응답 형태와 분리된 업로드 필드 모두에 대한 프론트엔드 반영~~ — ✅
  **2026-08-03 완료** (아래 미배정 참고).
- ~~**스토리지 포트-어댑터를 2026-08-07에 구현했다**~~ ([ADR 0029](ADR/0029-storage-port-adapter.ko.md)):
  Stage 4 클라우드 네이티브 인프라 과제의 코드 선행 조각으로, 아래 K8s/Helm 작업보다
  먼저 랜딩했다 — 자세한 내용은 4절(아키텍처 방향) 참고. `local`이 여전히 기본값이며,
  실제 S3 전환만 Stage 4 인프라 도입 행에 남는다.
- ~~**컨테이너/배포 하드닝을 2026-08-08에 구현했다**~~
  ([ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md)–[ADR 0034](ADR/0034-https-termination-stance.ko.md)):
  ADR 0015가 미뤘던 컨테이너/배포 하드닝 — non-root 이미지 사용자, `HEALTHCHECK` +
  liveness/readiness 엔드포인트, 별도 배포 단계로 분리한 마이그레이션은 코드와 함께
  반영됐고, 시크릿 전달 목표와 HTTPS 종단 방침은 설계만 담은 ADR로 반영됐다.
  distroless와 멀티아치는 명시적으로 계속 보류한다(7절 미일정) — 자세한 내용은
  6절 Stage 4 참고.

## 1. 비전과 본질

- **현재**: 포트폴리오/학습용 백엔드 — 작지만 완결된 API 위에서 엔지니어링
  규율(설계·문서·테스트)을 증명하는 것이 목적이다.
- **목표**: 브라우저 프론트엔드(저장소 내 `frontend/` 하위 폴더,
  [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))를 결정된
  소비자로 두는 실서비스 지향 백엔드. 후반 단계(기반 인프라, AWS 배포, 재생
  접근 제어)는 이 전환을 구호가 아닌 실체로 만들기 위해 존재한다.
- **우선순위 축** (기존 "보안 → 결정된 아키텍처 작업 → 위생 → 문서/테스트"를
  대체): 보안 → 프론트엔드 준비(API 표면 동결) → 결정된 아키텍처 작업(RBAC) →
  기반(재현성 · 관측성 · 테스트 신뢰성) → 메커니즘 보강 → 도메인 확장 →
  실서비스 전환.

## 2. 방법론

- **전용 작업 단위.** 모든 로드맵 항목은 자체 설계·검토·문서화를 갖춘 독립
  작업이다 — [CLAUDE.md](../CLAUDE.md) > Scope Discipline의 로드맵 차원 재서술이다.
  묶음 처리도, 부수 작업도 없다.
- 6절의 단계(Stage)는 **의존 순서에 따른 묶음일 뿐 마일스톤이 아니다**: 진행은
  항목 단위로 이뤄지며, 단계 경계를 넘는 데 별도의 의식은 없다.

## 3. 설계 기준

**동결 (변경 없음)** — 기존 3축, [CLAUDE.md](../CLAUDE.md)의 Never Do 그룹 1–3:
런타임 안전, 데이터 무결성, 보안. 모든 로드맵 작업은 이 기준을 통과해야 하며,
기준 자체는 로드맵의 대상이 아니다.

**2026-07-23 채택** — 이 계획을 지배하는 신규 5축:

| 축 | 근거 |
|---|---|
| 관측성 | 현재 로깅 인프라가 전무하다. 진단할 수 없는 백엔드는 운영할 수 없다 — 실서비스 목표의 첫 번째 선행 조건. |
| 재현성/이식성 | Node/pnpm 버전 미고정, DB 수동 구성. 배포 대상이 생기는 순간 환경 편차는 곧바로 장애 원인이 된다. |
| API 계약 안정성 | 소비자가 결정되었다(프론트엔드, 2026-07-23) — Stage F가 이 축의 발동이다: 소비자가 0명인 동안 라우트를 정리·동결하고, 에러 코드는 Stage F 작업으로 전달한다. URI 버저닝은 동결 이후 실제 breaking 변경이 필요해질 때까지 계속 유예. |
| 테스트 신뢰성 | e2e 스위트가 Nest 템플릿 그대로다. 단위 테스트만으로는 인증 흐름과 `temp_` → `granted_` 경로 전체를 보장할 수 없다. |
| 성능/용량 | 게시판 도메인 확장은 목록 쿼리 복잡도를 올리고, 비디오 서빙은 디스크·대역폭 부하가 크다. 응답시간 목표, 인덱스 정책, 디스크 상한이 명시적 기준이 된다. |

**Advisory (기록만, 지배 기준 아님)**:

- 개인정보/컴플라이언스 — PII 로그 금지는 이미 강제(Never Do G3); 삭제 정책은
  Stage 2의 삭제 설계 작업과 연결된다.
- 릴리스/변경 관리 — semver 태깅 + 마이그레이션 순서 규약; 배포와 함께 활성화.
- 문서 최신성(Docs-as-Code) 강제 — README/엔드포인트 일치의 기계 검증; CI 작업
  아래의 후보.

## 4. 아키텍처 방향

- **현재**: 계층형 모듈러 모놀리스 유지 — Controller → Service → Repository,
  단일 책임의 4모듈. 패턴 변경은 로드맵 범위에 없다.
- ~~**향후 목표 (2026-07-23 결정)**: 스토리지 포트-어댑터~~ — **2026-08-07 완료**
  ([ADR 0029](ADR/0029-storage-port-adapter.ko.md), Stage 4 인프라 과제의 코드 선행
  조각): `FileStorage` 인터페이스(`backend/storage/`)가 물리 파일 조작을
  `LocalDiskStorage`([ADR 0005](ADR/0005-local-disk-storage.ko.md)의 동작을 그대로
  이식)와 `S3Storage`(ISP가 요구하는 두 번째 구현체, 단위 테스트만 거침 — SDK
  모킹, 실제 버킷 미검증) 뒤로 분리한다. 선택은 `STORAGE_DRIVER`(`local` 기본값 |
  `s3`)로 한다. Multer가 `diskStorage`에서 `memoryStorage`로 바뀌어 temp 쓰기
  자체도 포트를 거치게 됐다(`UploadService.stageTemp`) — ADR 0005가 기록해 둔
  다중 인스턴스 격차를 승격 이후 절반만이 아니라 실제로 해소하는 전제조건이다.
  `local`이 여전히 기본값이며, 실제 배포를 S3로 전환하는 작업은 아래 Stage 4에
  남아 있다.
- **프론트엔드 분리 (2026-07-23 결정, 구조 2026-07-24 개정, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))**:
  프론트엔드는 이 저장소 안의 `frontend/` 하위 폴더(백엔드는 루트에 그대로)로
  두어 HTTP로 이 API를 소비한다. admin은 그 프론트엔드 안의 `/admin` 라우트
  구역으로 시작하며, RBAC이 랜딩하고 실제 admin 요구사항이 쌓인 뒤에만 별도
  앱으로 승격한다. pnpm workspace 모노레포(백엔드를 `apps/backend`로 재배치)와
  즉시 3분리(frontend/backend/admin)는 검토 후 기각.
- ~~**알려진 제약**: 정적 파일 서빙은 무인증이다~~ — **2026-08-01 백엔드에서 해소**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md) D1/D2/D3/D6 +
  [ADR 0026](ADR/0026-file-visibility-implementation.ko.md)): `ServeStaticModule`은 더 이상
  `file/upload`를 노출하지 않고, 접근은 `GET /file/:id/content`(공개/비공개/링크공유,
  Range 지원)가 강제한다. 프론트엔드는 2026-08-03에 이를 반영했다(아래 미배정 참고) —
  이제 `fileUrl`을 콘텐츠 엔드포인트로 읽고 visibility를 토글할 수 있다.
- 검토 후 보류한 대안: 이벤트 기반 보강(분리할 부수효과가 rename 하나뿐이며,
  rename을 트랜잭션 밖으로 빼면 `temp_`/`granted_` 원자성이 깨진다), CQRS-lite
  (읽기 모델이 분리할 만큼 복잡하지 않다; YAGNI).
- **모듈 방침**: 4모듈 유지, 예정 작업은 기존 모듈에 수용(RBAC → auth/user).
  신규 모듈은 새 도메인이 생길 때만 — 게시판 확장(Stage 3)이 그 승인된 사례다.

## 5. 도메인 계획

- **현재**: 인증된 비디오 파일 업로드/관리뿐. 프로젝트명의 "board"(게시판)는
  미구현이다.
- **결정**: 실제 업로드 게시판으로 확장 — 게시글이 업로드 파일을 참조하는
  post/comment 도메인. 엔티티 관계(post ↔ `FileEntity`, comment ↔ post/user)는
  ([CLAUDE.md](../CLAUDE.md) > Scope Discipline의 스키마 변경 규약에 따라) 먼저 평문으로
  기술했고, 검토된 마이그레이션은 후속 구현 과제에서 반영한다.
- **스키마는 2026-07-30 확정됐다** ([ADR 0023](ADR/0023-board-domain-schema.ko.md)) —
  구현에 앞선 설계 게이트이며 코드는 없다. 글은 자기 작성자가 올린 파일 하나만
  참조하고(unique·nullable FK), 그 제약이 곧 idempotency 키가 된다. 댓글은 평면
  구조이고 이 스키마의 유일한 `ON DELETE CASCADE`로 글과 함께 사라진다. 글이 참조 중인
  파일 삭제는 사전 검사가 아니라 FK를 통해 409 `FILE_IN_USE`로 거부한다. 계정 연쇄
  삭제([ADR 0020](ADR/0020-account-deletion-cascade.ko.md))는 글과 댓글까지 흡수하되
  `deleteFiles=true`는 여전히 파일만 확인받는다. 소유권은 "작성자 또는 admin"
  그대로이며 새로운 인가 축을 만들지 않는다.
- 목록 검색/필터/정렬(Stage 3)이 게시판 목록의 데이터 계층 선행 조건이며, 2026-07-30
  반영됐다 ([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)). post 목록은 이
  조회 계층을 새로 정의하지 않고 확장한다.

## 6. 단계별 작업 목록

순서는 의존 관계 기준이다. 각 행이 하나의 전용 작업이다.

### 순서가 의존 관계를 벗어나는 경우 (일반 기준)

이 계획에서 원래의 의존 순서보다 앞당겨진 항목은 넷이다: RBAC이 Stage F 뒤로
재배치된 것(현재 위치, 2026-07-23), 파일 가시성 + 미디어 타입 확장이 Stage 4
배포보다 앞에 놓일 수 있게 된 것(현재 위치, 2026-07-31), Stage 5가 Stage 4보다
먼저 배치된 것(아래 참조), 그리고 `GET /user` 페이지네이션이 Stage 5 나머지보다
앞으로 당겨진 것(아래 실행 순번 참조). 각각은 그 자리에서 개별적으로 논거를
댔다. 넷을 관통하는 공통 기준은 미리 계획된 것이 아니라 사후에 추출한 것이며,
이 넷뿐 아니라 앞으로 등장할 어떤 항목에도 적용되도록 일반형으로 적는다:

1. **역방향 하드 의존성이 없을 것.** 앞당겨지는 항목이 자신이 앞지르는 항목으로부터
   아무것도 필요로 하지 않아야 한다. 필요조건일 뿐 충분조건은 아니다 — 이것만으로는
   두 항목이 독립적이라는 사실만 보여줄 뿐, 재배치가 정당하다는 근거는 되지 않는다.
2. **뒤로 밀리는 쪽에 추가 비용이 없을 것.** 항목을 앞당겨도 그것이 앞지르는
   항목(들)에 재작업이 생기지 않아야 한다. 재배치 때문에 뒤로 밀린 항목이 나중에
   작업을 다시 해야 한다면, 순서는 원래대로 둔다.
3. **실제로 앞당길 만한 구체적 이유가 있을 것** — 단지 앞당겨도 된다는 것과는 다르다.
   예를 들면: 앞지르는 대상과 얽혀 있지 않은 상시 부채 해소, 순서를 반대로 뒀을 때
   생겼을 재작업의 회피, 또는 앞당기는 항목이 미룰 수 없는 이유(운영 필요성 등)다.

셋 다 성립해야 한다. (1)만으로는 두 항목의 독립성만 증명할 뿐이며, (2)나 (3) 없이는
기본값인 의존 순서를 유지한다.

### 남은 작업의 실행 순번 (2026-07-31 결정)

아래 단계들은 의존 관계로 묶여 있지만, 준비된 항목 몇 개가 단계를 가로질러 있어
실제 착수 순서를 여기서 고정한다(완결된 단계는 생략). 각 미완 항목은 자기 행에
실행 번호를 함께 표기한다.

1. ~~**게시판 도메인 — comment 모듈** (Stage 3)~~ — ✅ 2026-07-31 완료, **Stage 3 완결**.
   게이트였던 post↔file 불변식 gap을 [ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)로
   먼저 정리했고 계정 연쇄의 삭제 순서를 건드리지 않았으므로, 댓글 삭제가 게시글 앞에
   그대로 끼워 넣어졌다. **이제 실행 #2가 다음 전용 작업이다.**
2. ~~**`GET /user` 페이지네이션**~~ (Stage 5에서 앞당김) — ✅ 2026-08-05 완료.
   새 `GetUsersDto`(`take` 1–100 기본 20, `skip` ≥0 기본 0)가 `GetFilesDto`를 그대로
   미러하고, `UserService.findAll`은 `createdAt DESC, id DESC`로 정렬해 페이지 경계를
   결정적으로 만든다. 응답은 기존 `[rows, total]` 튜플 형태를 유지(`GET /file`과 형태
   일치, 별도 ADR 불필요). 검색/정렬은 이번 범위에서 의도적으로 제외 — ROADMAP 항목명이
   페이지네이션만 지칭했고, admin 콘솔 작업에서 필요해지면 그때 연다(실제로는 필요치
   않았다).
3. ~~**Stage 5 — 운영 화면 (admin 콘솔)**~~ — ✅ **2026-08-06 완료**, 네 행 모두 끝남:
   역할 전달 결정([ADR 0028](ADR/0028-access-token-role-claim.ko.md), 액세스 토큰에 `role`
   클레임 추가) → 이식 콘솔 적응(역할 관리 조각을 실제 라우트에 맞게) → 모더레이션 존재
   여부 결정("아니오"로 결론 — ban/unban/force-logout 삭제, 백엔드 쪽 대체 구현 없음) →
   중복 admin 화면 정리(`admin/` 유지,
   `frontend/src/features/admin/AdminPage.tsx` 삭제 — [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)의
   2026-08-06 추가 기록 참조). 계획대로 Stage 4보다 먼저 진행됐다: 권한 계층을 Swagger로만
   운영할 수 있는 배포 시스템은 운영이 어렵기 때문. **이제 남은 작업은 Stage 4** — 프로덕션
   DevOps 스택 도입(AWS · Docker · Kubernetes · Helm · GitHub Actions · Prometheus ·
   Grafana · Terraform · Istio[Terraform 이후]), 그다음 마지막으로 배포 자체이며, 배포는
   의도적으로 번호를 붙이지 않는다(아래 참조).
4. **프로덕션 DevOps 스택 도입** — 배포 직전 작업. **이 스택을 도입하는 이유**: 업계에서
   널리 쓰이는 표준 DevOps 툴체인으로, 이를 기반으로 실무와 유사한 개발·배포·운영 환경을
   경험하고 향후 서비스 확장에도 대응하기 위함이다. **AWS**(클라우드 플랫폼 / 배포 대상),
   **Docker**(컨테이너화 — *이미 반영됨*, Stage 1, [ADR 0015](ADR/0015-docker-and-compose.ko.md)),
   **Kubernetes**(컨테이너 오케스트레이션), **Helm**(릴리스 패키징/템플릿),
   **GitHub Actions**(CI/CD — *이미 반영됨*, Stage 1, [ADR 0016](ADR/0016-github-actions-ci.ko.md)),
   **Prometheus**(메트릭 수집), **Grafana**(메트릭 대시보드), **Terraform**(코드형
   인프라, IaC), 그리고 — **Terraform 이후 예정** — **Istio**(클러스터 위 서비스 메시:
   트래픽 관리, mTLS, 메시 텔레메트리). S3(오브젝트 스토리지)는 이 작업에 남은 스토리지 몫이다 — `FileStorage`
   포트-어댑터 자체(4절)는 이미 2026-08-07에 랜딩했으므로([ADR 0029](ADR/0029-storage-port-adapter.ko.md)),
   여기 남은 일은 실제 버킷을 대상으로 `STORAGE_DRIVER=s3`를 켜는 것뿐이다. 아직
   반영되지 않은 각 구성요소는 자체 ADR을 갖는다.

그다음, 마지막으로 — **배포 자체**. **의도적으로 실행 번호를 붙이지 않는다**: 배포는
"N번째 단계"가 아니라 위의 모든 것이 만들어지고 운영 가능해진 뒤 수행하는 전체 계획의
종착 행위다. 여기에 번호를 붙이면 이 절이 이미 정리한 Stage 4/Stage 5 순서 혼동을 다시
부를 뿐이라, 그냥 *마지막 작업*으로 표기한다.

**#2와 #3이 원래 소속 단계보다 앞당겨진 이유** — 층을 이루는 세 가지 별개 논거:

- **Stage 5 전체가 Stage 4보다 앞선다**(2026-07-31): 권한 계층을 Swagger로만 조작할 수 있는
  시스템은 실서비스로 운영하기 어렵다 — 그래서 운영 화면이 배포 이후가 아니라 이전에 온다.
- **`GET /user` 페이지네이션(#2)은 Stage 4뿐 아니라 Stage 5 나머지보다도 앞으로 빠졌다**,
  독립된 세 가지 이유로: admin 콘솔 작업이 실제로 일어나든 아니든 갚아야 할 상시 Never Do
  Group 2 부채라 콘솔과 얽혀 있지 않고; 범위가 작고 자기완결적인 빠른 승리이며; 콘솔의
  사용자 목록이 결국 끌어다 쓸 조회 계층 패턴(`GetUsersDto`, `GetFilesDto`/
  [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md) 미러)을 미리 갖춰 둔다.
- **role 전달 결정(#3)은 애초에 "앞당겨진" 항목이 아니다** — Stage 5 자체의 첫 행이자 강한
  선결 조건이다: 이식된 콘솔이 `jwtDecode<{ sub, role }>(accessToken)`을 디코드하므로, 이
  결정 없이는 콘솔 적응(Stage 5의 다음 행)이 시작될 수 없다. #2가 여기 도달하는 시점을
  늦췄을 뿐이라 "앞당겨진 것처럼" 보일 뿐이다.

이로써 Stage 5의 "번호는 의존 순서가 아니다" 노트가 Stage 5-먼저(Stage 4 앞)로
확정되고, 독립 부채 항목(#2)이 둘보다 앞으로 당겨진다. 단계 내부에서는 각 표의
의존 순서가 그대로 유효하다.

### Stage F — 프론트엔드 준비 (2026-07-23 결정, [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md))

프론트엔드 착수 전 백엔드 파이프라인 — 브라우저 클라이언트가 의존하게 될
모든 것을 소비자가 0명인 동안 확정한다.

| 작업 | 근거 / 의존성 |
|---|---|
| 라우트 정리 및 API 계약 동결 | `POST /file`, `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh`로 정규화하고, breaking 변경이 아직 공짜인 동안 표면을 동결한다 (복수형 리네임과 auth 액션 라우트 변경은 검토 후 기각 — ADR 0010). |
| 에러 코드 체계 (전역 exception filter) | 프론트엔드가 메시지 문자열이나 status 단독 분기에 의존하기 전에 기계 판독 가능한 에러 계약을 마련한다. |
| Refresh 토큰 httpOnly cookie 전환 + 회전/재사용 감지 | **Stage 2에서 앞당김 (2026-07-23)** — 브라우저 프론트엔드가 생기면 토큰 저장이 실제 XSS 표면이 된다. [ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)의 "토큰 서버 미저장" 스탠스를 개정하는 자체 ADR과 검토된 스키마 마이그레이션이 필요하다. |

### Stage 0 — 결정된 아키텍처 작업 (RBAC) — ✅ 2026-07-25 완결

| 작업 | 근거 / 의존성 |
|---|---|
| ~~**RBAC** — `role` 컬럼 + role 인식 가드~~ | **2026-07-25 반영** ([ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)): 3단계(`user`/`admin`/`superadmin`), `PATCH /user/:id/role`은 superadmin 전용, 소유권을 "본인 **또는** admin"으로 확장, 감사 로그 포함. 검토된 마이그레이션으로 배포. |

### Stage 1 — 기반 (재현성 · 관측성 · 테스트 신뢰성) — ✅ 2026-07-25 완결

| 작업 | 근거 / 의존성 |
|---|---|
| ~~Node/pnpm 버전 고정 (`engines` + `.nvmrc`)~~ | **2026-07-25 반영** ([ADR 0014](ADR/0014-node-pnpm-version-pinning.ko.md)): `.nvmrc` `24.8.0`, `engines` 하한(`node >=24`, `pnpm >=10`, 권고적), `packageManager` `pnpm@10.14.0`. Docker 베이스 이미지 태그와 CI 툴체인이 파생될 단일 출처가 된다. |
| ~~Docker / docker-compose (앱 + 로컬 PostgreSQL)~~ | **2026-07-25 반영** ([ADR 0015](ADR/0015-docker-and-compose.ko.md)): 멀티 스테이지 `Dockerfile`(빌드 `node:24.8.0` → `slim` 런타임, 부팅 시 마이그레이션) + `docker-compose.yml`(`db` postgres:16 + `api`). 수동 `upload-board-pg`를 대체하고 e2e의 수동 DB 의존을 제거한다. AWS 단계의 선행 조건 충족. |
| ~~CI — GitHub Actions (lint + test)~~ | **2026-07-25 반영** ([ADR 0016](ADR/0016-github-actions-ci.ko.md)): main/dev의 push·PR에서 도는 `.github/workflows/ci.yml` — `lint-and-unit` 잡(`--fix` 없는 `lint:ci` + 단위 테스트)과 `postgres:16` 서비스 대상 `e2e` 잡. 툴체인은 ADR 0014 고정값(Corepack + `.nvmrc`)에서. 0-오류 베이스라인이 이제 기계로 검증된다. |
| ~~로깅 규약 (Nest Logger부터)~~ | **2026-07-25 반영** ([ADR 0017](ADR/0017-logging-conventions.ko.md)): `AllExceptionsFilter`에 Nest 내장 `Logger` — 5xx는 빼낸 스택과 함께 `error`, 4xx는 `debug`; 레벨 규약과 PII 금지 규칙 문서화. 구조적/JSON 출력과 외부 에러 추적(Sentry)은 Stage 4로 유예. |
| ~~E2E 재작성~~ | **2026-07-25 반영**: 실제 HTTP+DB 위에서 도는 18개 케이스 스위트(`test/app.e2e-spec.ts` + 신규 `test/e2e-utils.ts` 하네스) — 인증 흐름, refresh 회전/재사용, 소유권 403, 페이지네이션, `temp_` → `granted_` 승격. 격리는 실제 마이그레이션으로 생성한 일회용 `upload_board_e2e` DB를 테스트마다 truncate하는 방식. Docker-compose 작업이 이 의존을 없앨 때까지는 로컬 Postgres(5435) 수동 기동이 여전히 필요하다. |

### Stage 2 — 메커니즘 보강

| 작업 | 근거 / 의존성 |
|---|---|
| ~~고아 temp 파일 정리~~ — ✅ 2026-07-26 반영 ([ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)) | `POST /file`이 끝내 호출되지 않으면 `temp_` 파일이 영구 누적됐다 — 유일한 무관리 리소스 누수. 스케줄 `@nestjs/schedule` 스윕(신규 `TempCleanupModule`)이 TTL(기본 24시간, 매시간)을 넘은 `file/temp`의 `temp_` 파일을 삭제한다. |
| ~~삭제 정책 설계 (soft delete + FK)~~ — ✅ 2026-07-30 반영 ([ADR 0020](ADR/0020-account-deletion-cascade.ko.md)) | soft delete는 **채택하지 않고** 삭제는 hard delete로 유지한다. `DELETE /user/:id?deleteFiles=true`는 계정의 파일 행과 물리 파일까지 연쇄 삭제하고, 확인 없는 요청이 파일 보유 계정에 들어오면 기존 FK 위반 500 대신 409 `USER_HAS_FILES`(메시지에 개수 포함)로 거절한다. 이번 과제에서 발견한 누수를 닫아 `DELETE /file/:id`도 이제 저장된 `granted_` 파일을 unlink한다. unlink는 커밋 이후에 수행하며(비가역 단계를 마지막에), 스키마 변경은 없다. |
| ~~업로드 멱등성/중복 정책 명문화~~ — ✅ 2026-07-27 반영 ([ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)) | attach가 발급한 `temp_{uuid}_{ts}` 파일명이 1회용 청구 토큰이다. 재제출 시 청구자 본인에게는 기존 파일을 replay(200)하고, 타인에게는 409 `FILE_ALREADY_CLAIMED`를 내며, 동시 제출 경합은 500이 아니라 unique 제약으로 정리된다. `filePath`를 DTO 경계에서 발급 형식으로 고정해 경로 탈출 공백도 함께 닫았다. 스키마 변경 없음. |

### Stage 3 — 도메인 확장

| 작업 | 근거 / 의존성 |
|---|---|
| ~~목록 검색/필터/정렬~~ — ✅ 2026-07-30 반영 ([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)) | `GET /file`에 `search`(제목에 이스케이프된 `ILIKE '%term%'`), `creatorId`, 그리고 완전한 `Record` 화이트리스트로 해석되는 `sortBy`/`order`가 추가됐다. 이 엔드포인트에 없던 `ORDER BY`도 함께 들어가 offset 페이징이 결정적이 됐다. 스키마 변경은 없고, 후보 인덱스 세 개는 도입 계기를 기록한 채 유보했다. post 목록이 확장해 쓸 조회 계층 패턴이다. |
| ~~게시판 도메인 — 스키마 설계 게이트~~ — ✅ 2026-07-30 반영 ([ADR 0023](ADR/0023-board-domain-schema.ko.md)) | 마이그레이션에 앞서 Scope Discipline이 요구하는 평문 스키마 기술이며, comment 작업이 post 스키마를 되돌리게 만들 수 없도록 두 엔티티를 한 번에 다뤘다. post ↔ file은 1:1·선택적·동일 작성자이고(unique FK가 `POST /post`의 idempotency 키를 겸한다), 댓글은 평면 구조로 FK에서 글과 함께 연쇄 삭제된다. 첨부된 파일에 대한 `DELETE /file/:id`는 409 `FILE_IN_USE`가 된다. ADR 0020 계정 연쇄 삭제는 글과 댓글을 확인 없이 가져가되 플래그는 여전히 파일만 지킨다. `canManage`와 ADR 0021 조회 계층은 그대로 재사용한다. 설계 전용 — 코드도 마이그레이션도 없다. |
| ~~게시판 도메인 — post 모듈~~ — ✅ 2026-07-31 완료 ([ADR 0023](ADR/0023-board-domain-schema.ko.md) > 구현 노트) | ADR 0023의 전반부. comment가 post에 의존하지 그 반대가 아니어서 분리했다: `PostModule`(`JwtAuthGuard` 뒤 5개 라우트), FK 2개와 `UQ_post_entity_fileId`를 가진 `post_entity`(검토된 마이그레이션 — generate가 뱉은 제약 이름 변경 4문장은 걷어냄), 신규 에러 코드 3개, `DELETE /file/:id`의 `23503` → 409 `FILE_IN_USE` 번역, 그리고 ADR 0020 계정 연쇄에 게시글 합류(감사 detail의 `posts=N`). ADR 0021 조회 계층과 `canManage`는 다시 만들지 않고 재사용했다. |
| ~~게시판 도메인 — comment 모듈~~ — ✅ 2026-07-31 완료 ([ADR 0023](ADR/0023-board-domain-schema.ko.md) > 구현 노트) | ADR 0023의 후반부이며, 이로써 **Stage 3이 완결됐다**. `CommentModule`이 ADR의 네 라우트를 `JwtAuthGuard` 뒤에 컨트롤러 두 개로 나눠 제공한다(스레드는 글에 매달리고, 이미 존재하는 댓글은 자기 id로 지목된다). 그 아래 `comment_entity`는 이 스키마의 유일한 `ON DELETE CASCADE` FK와 `IDX_comment_entity_postId_createdAt`을 갖는다(검토된 마이그레이션 — generate가 뱉은 제약 이름 변경 6문장은 걷어냄). `COMMENT_NOT_FOUND`와 `COMMENT_DELETE` 감사 액션은 소비자와 함께 들어왔다. 댓글은 계정 연쇄에서 **게시글보다 먼저** 삭제된다 — 그 계정이 *남의* 글에 단 댓글은 게시글 FK 연쇄로 닿지 않기 때문이다. 완화하지 않고 그대로 지킨 결정 둘: 감사 detail에 `comments=N` 없음(연쇄분을 셀 수 없어 반쪽 집계는 총계처럼 읽힌다), 멱등 키 없음(재제출은 `fileId` 없는 글과 마찬가지로 두 번째 댓글이 된다). 게이트는 [ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)가 먼저 풀었다. |

### Stage 4 — 실서비스 전환 — 마지막 작업 (의도적으로 번호 없음)

배포는 전체 계획의 종착 행위다 — 나머지가 모두 만들어지고 운영 가능해진 뒤 수행하므로
**실행 번호를 붙이지 않는다**; 여기에 번호를 붙이면 이 계획이 이미 정리한 Stage 4/Stage 5
순서 혼동을 다시 부를 뿐이다. 배포 **직전** 작업은 프로덕션 DevOps 스택 도입
(AWS · Docker · Kubernetes · Helm · GitHub Actions · Prometheus · Grafana · Terraform ·
Istio[Terraform 이후 예정])이다. 아래 행들은 각자의 내부 의존 순서를 유지하며, 배포 행은
의도적으로 맨 마지막이다.

| 작업 | 근거 / 의존성 |
|---|---|
| **프로덕션 DevOps 스택 도입 — 배포 직전 작업** | **이 스택을 도입하는 이유:** 업계에서 널리 쓰이는 표준 DevOps 툴체인으로, 이를 기반으로 실무와 유사한 개발·배포·운영 환경을 경험하고 향후 서비스 확장에도 대응하기 위함이다. 구성요소와 역할: **AWS**(클라우드 플랫폼 / 배포 대상), **Docker**(컨테이너화 — *이미 반영됨*, Stage 1, [ADR 0015](ADR/0015-docker-and-compose.ko.md)), **Kubernetes**(컨테이너 오케스트레이션), **Helm**(릴리스 패키징/템플릿), **GitHub Actions**(CI/CD — *이미 반영됨*, Stage 1, [ADR 0016](ADR/0016-github-actions-ci.ko.md)), **Prometheus**(메트릭 수집), **Grafana**(메트릭 대시보드), **Terraform**(코드형 인프라, IaC). **S3**(오브젝트 스토리지)는 이 작업이 실제로 전환하는 구체적 백엔드다 — 호스트 디스크에서 물리 파일 조작을 분리하는 `FileStorage` 포트-어댑터(4절) 자체는 이미 2026-08-07에 랜딩했으므로([ADR 0029](ADR/0029-storage-port-adapter.ko.md), `S3Storage` 구현 포함, 단위 테스트만 거침), 이 행에 남은 스토리지 작업은 추상화를 만드는 것이 아니라 실제 버킷을 대상으로 `STORAGE_DRIVER=s3`를 켜는 것이다. 이 작업은 또한 Stage 1 이미지가 미룬 컨테이너·배포 하드닝을 담는다([ADR 0015](ADR/0015-docker-and-compose.ko.md)에서 드러남) — ~~비루트 `USER`, 헬스/레디니스 엔드포인트, 별도 배포 단계로 분리한 마이그레이션~~ **2026-08-08 반영**([ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md)–[ADR 0034](ADR/0034-https-termination-stance.ko.md)): 이미지는 이제 전용 non-root 사용자로 실행되며 새 `GET /health/live`/`GET /health/ready`를 호출하는 `HEALTHCHECK`를 갖는다(ADR 0030/0031); `docker-compose.yml`의 one-shot `migrate` 서비스가 향후 Kubernetes Job을 모델링해 스케일된 `api`가 `migration:run`을 경합하는 일이 구조적으로 없어졌다(ADR 0032); 시크릿 전달 목표(네이티브 Kubernetes `Secret`, AWS Secrets Manager는 Terraform으로 보류)와 HTTPS 종단 방침(ingress/ALB, 앱 안에서는 하지 않음)은 코드 없이 설계만 담은 ADR로 기록됐다(ADR 0033/0034). distroless 런타임 베이스와 타깃 아키텍처(ARM/Graviton) 빌드는 검토했지만 명시적으로 보류했다(ADR 0030) — 이유는 아래 새 미일정 항목 두 개 참고. 반영된 각 구성요소는 계획대로 자체 ADR을 갖는다; Stage 1의 Docker + CI에 의존. |
| ~~파일 가시성·접근 제어 서빙~~ **(2026-08-01 구현, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md) D1/D2/D3/D6 + [ADR 0026](ADR/0026-file-visibility-implementation.ko.md); 기존 "VOD 재생 접근 제어" 행을 일반화)** | 업로드된 파일은 예전엔 단순 공개 URL이었다 — 링크만 알면 누구나 봤다. `FileEntity`는 이제 3-상태 `visibility`(공개/비공개/**링크공유**, 회전 가능한 공유 토큰 + 선택적 TTL)를 가지며, `GET /file/:id/content`가 유일한 접근 제어 읽기 경로(Range 지원)이고, `ServeStaticModule`은 더 이상 `file/upload`를 노출하지 않는다. [ADR 0005](ADR/0005-local-disk-storage.ko.md)(서빙)를 부분 개정한다. 새 `fileUrl`/`visibility` 형태에 대한 프론트엔드 반영은 2026-08-03에 착지했다 — 아래 미배정 참고. |
| ~~미디어 타입 확장 (이미지/오디오, 타입별 업로드 필드)~~ **(2026-08-01 구현, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md) D4/D5 + [ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md) — 2026-08-01에 위 행에서 분리)** | `POST /upload/attach`는 이제 `image`(jpg/jpeg/png/webp), `audio`(mp3), `video`(mp4/mov/webm, 변경 없음) 세 타입별 필드를 받으며 각각 자신만의 허용 목록을 가진다 — 단일 `video` 필드를 대체했다. [ADR 0003](ADR/0003-two-phase-upload-contract.ko.md)/[ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)(업로드 필드, 살아 있는 프론트엔드에 대한 breaking 변경)을 개정한다. 스키마 변경은 없다. 새 업로드 필드에 대한 프론트엔드 반영은 2026-08-03에 착지했다 — 아래 미배정 참고. |
| 성능/용량 기준 적용 | 인덱스 정책, 응답시간 목표, 디스크 상한 — 최적화 전에 측정부터. |
| **배포 — 마지막 작업** (의도적으로 실행 번호 없음) | AWS, 컨테이너 기반, 위에서 도입한 DevOps 스택(Kubernetes · Helm · Terraform · Prometheus/Grafana · S3) 위에. "N번째 단계"가 아니라 위의 모든 것이 만들어지고 운영 가능해진 뒤 수행하는 전체 계획의 종착 행위이므로 번호를 붙이지 않는다. 신규 배포 ADR; DevOps 스택 도입 행 + Stage 1의 Docker + CI에 의존. (기존 독립 "스토리지 포트-어댑터" 행은 이 행보다 먼저, 2026-08-07에 별도로 랜딩했다 — [ADR 0029](ADR/0029-storage-port-adapter.ko.md) — 그래서 이 행이 물려받는 것은 추상화 자체가 아니라 S3 전환뿐이다.) |

#### 프로덕션 DevOps 스택 — 구성요소 상태

위 "프로덕션 DevOps 스택 도입" 단일 행을 여기서 구성요소별로 펼쳐, 각 상태를 산문에 묻지
않고 한눈에 볼 수 있게 한다(2026-08-18 기준). 범례: ✅ 완료 · 🔶 부분 완료 · 📝 설계만(ADR) ·
🆕 미착수.

| 구성요소 | 역할 | 상태 | 완료/잔여 | ADR / 출처 |
|---|---|---|---|---|
| **Docker** | 컨테이너화 | ✅ + 하드닝 | 멀티스테이지 이미지(Stage 1); 이제 전용 **비루트** 사용자로 실행 + `HEALTHCHECK`. **distroless** 베이스와 **멀티아치(ARM/Graviton)** 빌드는 검토 후 **유예**(감수). | [0015](ADR/0015-docker-and-compose.ko.md), [0030](ADR/0030-container-non-root-and-arch-stance.ko.md) |
| **GitHub Actions** | CI(/CD) | 🔶 CI + 이미지 게시 | push/PR에서 `lint`+unit+e2e 워크플로 — 이제 `frontend-e2e`/`admin-e2e`와 `frontend/`/`admin/`의 lint/unit 잡도 포함(둘 다 이전엔 CI에서 검증되지 않았다). **AWS로의 배포 파이프라인(CD)은 여전히 없음** — AWS가 대상이 될 때 추가. **예외, 2026-08-13 기록**: 명시적 요청으로 `docker-publish` 잡이 추가됐다 — main 푸시마다 `linux/amd64,linux/arm64`를 buildx로 빌드해 `bluecode1775/sharenpo`를 Docker Hub에 푸시한다. 이것은 이미지 게시 CD이지 앱 배포가 아니며, 해당 커밋(`1b72ec9`) 자체가 이 행이 정한 계획(AWS가 대상이 될 때만 CD)을 대체하는 게 아니라 그보다 앞서 진행하는 것이라고 명시하고 있다. | [0016](ADR/0016-github-actions-ci.ko.md) |
| **S3** | 오브젝트 스토리지 | 🔶 어댑터 ✅ / 리다이렉트 ✅ / 버킷 적용 ✅ / 전환 🔶 라이브, 엔드투엔드 미검증 | `FileStorage` 포트 + `S3Storage` 구현 랜딩(단위테스트만). 프록시 스트리밍 경로가 앱 계층에 대역폭 부담을 지우고 있어, `STORAGE_DRIVER=s3`에서는 `GET /file/:id/content`가 이제 수명이 짧은 presigned S3 URL로 `302` 리다이렉트한다(세 가시성 등급 전부, 기존 `resolveContentAccess` 검사로 게이트) — `local`은 기존 스트리밍 그대로. Terraform([0043](ADR/0043-terraform-project-adaptation.ko.md) D8, 2026-08-18)이 private 버킷 + 앱 전용 IRSA 역할을 프로비저닝하며 — **적용됨**, 계획만이 아니다(§7의 2026-08-25 정정) — 실제 버킷은 `upload-board-project-074416822640`이다. 실제 Helm 릴리스가 이제 `STORAGE_DRIVER=s3`와 앱의 IRSA 역할이 연결된 채로 동작 중이다(2026-08-27, §9) — 전환 자체는 켜져 있지만, 실제 버킷을 상대로 한 업로드/읽기 왕복과 `frontend`/`admin` 미디어 플레이어의 리다이렉트-경유 Range 요청 동작은 둘 다 아직 미검증. | [0029](ADR/0029-storage-port-adapter.ko.md), [0036](ADR/0036-s3-presigned-content-redirect.ko.md), [0043](ADR/0043-terraform-project-adaptation.ko.md) |
| **헬스/레디니스** | 프로브 | ✅ | LB·오케스트레이터 프로브용 `GET /health/live` + `GET /health/ready`. | [0031](ADR/0031-health-and-readiness-endpoints.ko.md) |
| **마이그레이션 분리 단계** | 배포 안전 | 🔶 compose ✅ / K8s Job 🆕 | `docker-compose.yml`의 원샷 `migrate` 서비스가 향후 **Kubernetes Job**을 모델링 — 스케일된 `api`가 `migration:run`을 경합하지 않도록. K8s Job 자체는 예정. | [0032](ADR/0032-migration-as-separate-deploy-step.ko.md) |
| **Kubernetes** | 오케스트레이션 | ✅ AWS에서 라이브 | 예전 `k8s/pod/`, `k8s/deployment/`, `k8s/cluster/` 아래 있던 독립 정적 매니페스트는 2026-08-17 삭제됐다([0042](ADR/0042-k8s-helm-directory-consolidation.ko.md)) — 아래 Helm 차트가 이미 렌더링하는 것의 엄격한 부분집합을 중복했을 뿐, 소비하는 곳도 없었다(CI 잡도, compose 참조도 없음). Kubernetes 매니페스트는 이제 Helm 차트의 `templates/`(`k8s/helm/`)로만 존재한다. **실제 클러스터 배포(AWS)가 2026-08-27 반영됨**(§9) — `helm upgrade`가 `STATUS: deployed`에 도달했고, 마이그레이션 Job이 완료됐으며, 앱 파드는 `Running`/ready 상태다. | 커밋 `48a89f2`, [0041](ADR/0041-helm-chart-project-adaptation.ko.md), [0042](ADR/0042-k8s-helm-directory-consolidation.ko.md) |
| **시크릿 전달** | 시크릿 | ✅ 라이브 | 대상 결정: 네이티브 **Kubernetes `Secret`**, External Secrets Operator가 IRSA를 통해 **AWS Secrets Manager**에서 동기화. Helm 차트는 소비 측을 구현한다(`existingSecret` 참조 + `envFrom.secretRef`, 2026-08-17); Terraform 측([0043](ADR/0043-terraform-project-adaptation.ko.md) D7, 2026-08-18)은 Secrets Manager 항목과 ESO 설치+IRSA 역할(`eks_blueprints_addons`의 `enable_external_secrets`)을 프로비저닝한다. **2026-08-27 라이브 확인**: `secretstore.external-secrets.io/upload-board-project-secretsmanager`가 `Valid`/`Ready`이고, `externalsecret/upload-board-project-app-secrets`가 `SecretSynced`/`True`다 — 실행 중인 앱 파드가 바로 이 동기화된 Secret으로 RDS 인증과 토큰 서명을 수행한다. | [0033](ADR/0033-secrets-delivery-target.ko.md), [0041](ADR/0041-helm-chart-project-adaptation.ko.md), [0043](ADR/0043-terraform-project-adaptation.ko.md) |
| **HTTPS 종단** | TLS | 🔶 준비됨, 의도적으로 비활성 | **ingress / ALB**에서 종단, 인프로세스 금지(`ENV=prod`에서 `Secure` refresh 쿠키에 필요하며, 실제 릴리스는 이미 `ENV=prod`로 동작 중이다 — `values.yaml` 기본값). Helm 차트의 `Ingress` 템플릿은 존재하지만 기본값은 여전히 비활성(`ingress.enabled: false`); 클러스터·등록된 도메인·인증서가 모두 이제 실제로 존재하므로(다음 문장 참고), 남은 공백은 누락된 의존성이 아니라 개발자의 의도적 선택이다 — 개발자는 2026-08-27(§9) 외부 테스터가 실제로 필요해지기 전까지 `Ingress`를 켜지 않기로 확정했다. 인증서 메커니즘은 결정되고 코드로도 있다: **ACM**, Terraform이 프로비저닝한 Route53 영역을 대상으로 DNS 검증([0043](ADR/0043-terraform-project-adaptation.ko.md) D4/D5, 2026-08-18), `sharenpo.cloud` 대상 `ISSUED` 상태 — 그 ARN은 활성화 시 Ingress의 `certificate-arn` 주석에 바로 쓸 수 있는 Terraform output이다. | [0034](ADR/0034-https-termination-stance.ko.md), [0041](ADR/0041-helm-chart-project-adaptation.ko.md), [0043](ADR/0043-terraform-project-adaptation.ko.md) |
| **Helm** | 릴리스 패키징 | ✅ AWS에서 라이브 | `k8s/helm/`에 위치(2026-08-17 형제 디렉터리였던 `helm/upload-board-project/`에서 이동 후 한 단계 더 평탄화, [0042](ADR/0042-k8s-helm-directory-consolidation.ko.md) — Kubernetes 관련 콘텐츠가 최상위에 하나만, 불필요한 중첩 없이 남도록). 2026-08-17 프로젝트 전용으로 적응([0041](ADR/0041-helm-chart-project-adaptation.ko.md), [0037](ADR/0037-helm-chart-scaffold.ko.md)의 유예 해제): 실제 이미지/포트, `/health/live`+`/health/ready` probe, non-root `securityContext`, `ConfigMap`, `existingSecret` 전용 `Secret` 소비, `docker-compose.yml`의 `migrate` 서비스를 본뜬 migration `Job`, 기본 비활성 `Ingress`. `replicaCount` 기본값은 1(`STORAGE_DRIVER=local`에서 1보다 크면 replica 간 업로드 파일이 사라짐 — 다만 실제 릴리스는 이제 `s3`로 동작 중). 임시 로컬 `kind` 클러스터에 대해 `helm install --wait` 검증 완료(2026-08-17, [0041](ADR/0041-helm-chart-project-adaptation.ko.md)의 추가 기록) — 실제 버그 2개(hook 순서, 빈 문자열 env var) 발견해 수정. **2026-08-27 실제 대상 클러스터(AWS/EKS)에 설치 완료**(§9) — `values-prod.yaml`이 이번 설치의 `--set` 플래그를 정리해 담았다. | [0037](ADR/0037-helm-chart-scaffold.ko.md), [0041](ADR/0041-helm-chart-project-adaptation.ko.md), [0042](ADR/0042-k8s-helm-directory-consolidation.ko.md) |
| **Prometheus** | 메트릭 수집 | 🆕 | Nest `Logger` 관측성 스탠스 위에 메트릭 익스포트. | 자체 ADR(예정); [0017](ADR/0017-logging-conventions.ko.md) 위 |
| **Grafana** | 대시보드 | 🆕 | Prometheus 데이터소스 기반 대시보드/알림. | 자체 ADR(예정) |
| **Terraform** | 코드형 인프라 | ✅ 적용됨 | 프로젝트 전용 설계 확정([0043](ADR/0043-terraform-project-adaptation.ko.md), [0038](ADR/0038-terraform-iac-scaffold.ko.md)의 유예 해제) 및 2026-08-18 구현: 이 프로젝트 고유의 EKS(이기종 노드 그룹 2개), RDS PostgreSQL, S3 버킷 + 앱 IRSA 역할, Secrets Manager + External Secrets Operator, Route53/ACM 기반 ALB ingress 경로를 프로비저닝한다 — Istio 예제는 주석 처리가 아니라 완전히 사라졌다. 2026-08-20에 그 단일 루트 모듈을 독립적으로 apply 가능한 세 state로 재구성([0044](ADR/0044-terraform-three-state-split.ko.md)): `cluster/`(`module.vpc`+`module.eks`), `app-infra/`(RDS/S3+IRSA/Secrets Manager/Route53+ACM, `terraform_remote_state`로 `cluster/`를 읽음), `addons/`(`module.eks_blueprints_addons` — ALB Controller+ESO, 다른 둘을 모두 읽는 유일한 state) — 퇴역한 단일 `main.tf`는 더 이상 존재하지 않는다. 세 디렉터리 모두 `terraform validate`/`fmt -check` 통과. **실제 AWS 계정에 적용됨** — 여기서는 2026-08-27에 정정(§7에서 2026-08-25에 이미 정정됐고, `CLAUDE.md`도 마찬가지): `cluster/`+`app-infra/`는 약 108개 리소스 인스턴스를 담은 로컬 state를 갖고 있으며, 앱도 이제 그 클러스터 위에 배포돼 있다(§9, 2026-08-27). 여기 있는 모든 리소스는 실제이며 과금된다 — 어떤 `apply` 전에도 `terraform plan`을 먼저 읽고, `destroy`는 절대 가볍게 하지 않는다. | [0038](ADR/0038-terraform-iac-scaffold.ko.md), [0043](ADR/0043-terraform-project-adaptation.ko.md), [0044](ADR/0044-terraform-three-state-split.ko.md) |
| **Istio** | 서비스 메시 | 🆕 | **Terraform 이후 예정** — Kubernetes 클러스터 위의 서비스 메시(트래픽 관리, 워크로드 간 mTLS, 메시 레벨 텔레메트리를 Prometheus/Grafana로). IaC로 프로비저닝된 클러스터가 생긴 뒤 도입; 향후 다중 서비스 확장을 내다본 것. | 자체 ADR(예정); Terraform 이후 |
| **AWS** | 클라우드 / 배포 대상 | ✅ 라이브 | 위 행들이 향하는 컨테이너 배포 대상 — **이제 실제 배포 대상이다**: 계정 `074416822640`(`sharenpo-user`, 2026-08-27부로 Paid Plan), 리전 `ap-northeast-2`, 실제 EKS + RDS + S3 + Route53/ACM, 그리고 앱 자체가 배포되어 동작 중(§9, 2026-08-27). | 배포 ADR(예정) |

### Stage 5 — 운영 화면 (admin 콘솔) — 2026-07-30 추가

**기존 단계의 한 행이 아니라 새 단계로 만든 이유.** admin 콘솔은 게시판 도메인(Stage 3)도,
인프라(Stage 4)도 아니다. 그리고 지금까지 **어느 단계도 이것을 맡지 않았다** —
[ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)이 2026-07-23에 admin의
*배치*는 결정했지만 작업을 스케줄한 적은 없어서, 다른 모든 결정 항목이 행을 가진 동안 이것만
계획 밖에 있었다. 단계를 추가해 그 공백을 닫는다. 계기가 된 이식은
[ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)다.

**여기서 번호는 의존 순서가 아니다** — 이 절의 규칙에 대한 유일한 예외다. Stage 5는 Stage 4에
의존하지 **않는다**. 확실한 선행 조건은 Stage 0(RBAC, 2026-07-25 완결)과 아래 첫 행의 역할 전달
결정뿐이다. Stage 4보다 먼저, 나중에, 또는 병행해서 진행할 수 있다. 마지막 번호인 것은 마지막에
추가됐기 때문이며, 마지막에 해야 하기 때문이 아니다. 오히려 Stage 4보다 **앞으로 당길** 근거도
있다: 권한 계층을 Swagger로만 운영할 수 있는 시스템은 배포된 뒤에 운영하기가 어렵다.

**2026-07-31 확정 — Stage 5를 Stage 4보다 먼저 진행한다**(위 실행 순번 참조). 그 "앞으로
당길 근거"가 채택됐다: 운영 화면을 배포보다 앞세운다. Stage 5 내부 순서는 역할 전달 →
콘솔 적응 → 모더레이션 결정 → 중복 화면 정리이며, `GET /user` 페이지네이션 행은 조기
빠른수정으로 실행 #2에 빼냈다 — **2026-08-05 완료**, 아래 행 참조. **Stage 5는 이제
2026-08-06에 완료됐다** — 아래 네 행 모두 끝났고, 남은 작업은 Stage 4(인프라 도입 후 배포)다.

| 작업 | 근거 / 의존성 |
|---|---|
| ~~**클라이언트가 사용자 역할을 어떻게 아는가**~~ (백엔드 결정 — **2026-08-05 완료**, [ADR 0028](ADR/0028-access-token-role-claim.ko.md)) | 요청 기반 조회(`GET /user/:id` 또는 신규 `GET /auth/me`) 대신 액세스 토큰 `role` 클레임을 선택 — 프론트엔드가 이미 쓰는 클라이언트 측 JWT 디코드 패턴과 일치하고(추가 왕복 없음), 유일한 실질 비용 — 강등된 사용자의 *디코드된* role이 액세스 토큰 TTL만큼 지연될 수 있다는 점 — 은 실제 권한으로 이어지지 않는다. `RolesGuard`/`AuthUser`는 여전히 `JwtStrategy.validate`의 매 요청 DB 조회에서 role을 얻지, 토큰에서 얻지 않기 때문이다. `Payload`는 `role?: UserRole`을 얻고(액세스 토큰만); `issueToken`/`issueTokenPair`는 `Pick<UserEntity, 'id' \| 'role'>`로 넓어졌다. [ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)를 개정한다. **아래 행의 걸림돌을 해소한다.** |
| ~~이식된 `admin/` 콘솔 적응~~ (**2026-08-06 완료**) | [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)의 이식본을 Chat Project API에서 이 API로 다시 썼다. 그 ADR의 검증된 백로그를 작업 지시서로 삼았다. 역할 관리 조각을 착륙시켰다: 문자열 `UserRole`(기존 숫자였음), 액세스 토큰 클레임에서 역할을 읽음(ADR 0028), 3단계 역할 `<select>`(기존 이진 토글이었음 — 토글을 유지하는 대신 이 선택을 한 이유는 ADR 0022 자체가 명시한 목적대로 콘솔이 3단계를 모두 조작할 수 있게 하기 위해서다), `{ code, message }` 분기로 처리되는 `AUTH_LAST_SUPERADMIN`/`USER_HAS_FILES`/`FORBIDDEN`(ADR 0011), `GetUsersDto`/`AuditLogQueryDto`와 정확히 일치하는 `take`/`skip` + `[data, total]` 튜플 읽기(당시엔 검색/정렬/상태/userId/내보내기가 서버 쪽에 없어서 전부 없앴다). 채팅 도메인 페이지(`rooms-page`, 접속/닉네임 위젯)와 Apollo/`/graphql` 계층 전체는 재작성이 아니라 삭제했다. 사용자별 감사 로그 패널은 근사하지 않고 제거했다(`GET /audit-log`에 `userId` 필터가 없다 — 7절 후속 항목 참조). 백엔드 파일은 건드리지 않았다. 결함별 전체 대응표: `admin/README.md` > "무엇을 적응시켰는가". **2026-08-12 확장**: 7절의 두 후속 항목이 해소되면서 검색창, 정렬 가능한 헤더, 복원된 사용자별 "Recent activity" 패널, `logs-page.tsx`의 `?userId=` 필터링, 클라이언트 합성 CSV 내보내기가 추가됐다. `status` 필터와 실제 `/audit-log/export` 엔드포인트는 여전히 서버에 없어 범위 밖이다. **2026-08-25 확장**(커밋 `d38d9dc`): [ADR 0045](ADR/0045-audit-log-target-type.ko.md)가 모든 감사 기록에 `targetType` 판별자를 실어 보내게 되면서, `src/lib/audit.ts`는 클라이언트 쪽 action → 대상 종류 매핑을 버리고 서버 필드를 읽는다. "Recent activity" 패널도 대상을 이름으로 표시하기 시작했고, CSV 내보내기에 `targetType` 열이 추가됐다 — ADR 0045가 선택적 정리로 남겨 둔 항목이 닫혔다 |
| ~~`GET /user` 페이지네이션~~ **(실행 #2 — Stage 5에서 앞당김, 2026-08-05 완료)** | 상시 위반 상태였던 Never Do Group 2 문제를 해소했다(`findAll()`이 `@Query()` 없이 전체 사용자 `findAndCount()`를 반환하던 상태). 새 `GetUsersDto`(`take`/`skip`, `GetFilesDto` 미러); `UserService.findAll`은 `createdAt DESC, id DESC`로 정렬해 페이지 경계를 결정적으로 만든다; 응답은 기존 `[rows, total]` 튜플 형태 유지(`GET /file`과 일치, 별도 ADR 불필요). 검색/정렬은 이번 범위에서 제외했고, 위 콘솔 적응에서도 필요하지 않았다 — 7절 후속 항목은 2026-08-12에 해소될 때까지 열린 채로 남아 있었다(7절 참고). |
| ~~중복된 admin 화면 정리~~ (**2026-08-06 완료**) | 위 적응 작업이 어느 쪽이 살아남을지 답했다: 이식본은 "대부분 삭제 가능"한 게 아니었다(삭제 가능했던 건 채팅 도메인 잔재뿐) — 그래서 `admin/`이 유일한 admin 화면이다. `frontend/src/features/admin/AdminPage.tsx`(ADR 0010의 라우트 구역, 여전히 17줄짜리 no-op)와 `frontend/src/App.tsx`의 `/admin` 라우트+import를 삭제했다. [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)을 한 번 더 개정한다 — admin은 이제 `frontend/` 안의 라우트 구역조차 아니다. [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)의 2026-08-06 추가 기록에 남겼다; 7절의 미결 사항도 닫혔다. |
| ~~모더레이션 기능을 둘 것인지 결정~~ (**"두지 않는다"로 결론, 2026-08-06, 위 콘솔 적응의 일부**) | 이식본은 `POST /user/:id/ban`, `/unban`, `/force-logout`을 호출했고, 이 프로젝트가 **절대 기록하지 않는** 감사 액션(`USER_BANNED`, `USER_MUTED`, `USER_UNBAN`, `FORCE_LOGOUT`)에 색을 지정했다 — `AUDIT_ACTIONS`는 정확히 `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE`, `POST_DELETE`, `COMMENT_DELETE`다. 기본 답을 택했다: 영상 업로드 게시판에 명시된 모더레이션 요구사항이 없으므로(YAGNI) 세 액션과 존재하지 않는 감사 색 4개를 `admin/`에서 삭제했다. 그중 하나도 백엔드에 만들지 않았다 — 그것은 자체 ADR이 필요한 신규 범위이며, UI 적응의 부수 효과가 아니다. |

## 7. 미일정 / 미결 사항

- ~~**`cluster` → `app-infra` → `addons` → Helm 배포 순서 자동화**~~ — **2026-08-27 완료**
  ([ADR 0046](ADR/0046-deploy-sequence-automation.ko.md)). 도구: 순수 bash 스크립트
  (`k8s/infra/terraform/deploy.sh`) — 기존 `build-and-push.sh` 선례와 같은 형태이며
  "자동 배포 파이프라인(CD) 없음"을 그대로 유지한다. GitHub Actions 워크플로는 그 자체가
  이 상태를 뒤집는 결정이 될 것이라 기각했다. 범위: Terraform 3-state 순서화 +
  `helm upgrade --install`(`values-prod.yaml` 재사용, `--set` 나열 없음) — 도메인
  구매/NS 위임, ESO 시크릿 동기화, default ServiceAccount IRSA 어노테이션, `Ingress`
  활성화는 `k8s/infra/terraform/README.md`가 이미 1회성/인터랙티브라고 문서화한 그대로
  수동으로 남는다. 구현 내용: 서브커맨드로 강제되는 고정 apply 순서, `cluster/`의 실제
  `terraform output`과 대조하는 region/cluster_name 일치 검증, ACM `-target` 2단계
  apply, 그리고 모든 apply에 걸린 plan-then-confirm 게이트(`terraform plan
  -out=<tmpfile>` → 사람의 y/N → `terraform apply <tmpfile>` — `-auto-approve` 없음).
  실제 AWS 계정을 대상으로 실측 검증: `deploy.sh cluster`가 실제 plan을
  실행했고("No changes..."), 확인 입력이 없을 때는 실제로 아무것도 적용하지 않고
  중단했다; 세 state 디렉터리 모두에서 `terraform fmt -check`/`validate`가 변경 전과
  동일하게 통과한다. 원래 기록됐던 8가지 실패 양상은 그 역사적 기록으로 아래에 남긴다 —
  이 스택(ADR 0043/0044)을 처음으로 실제 AWS에 end-to-end로 apply해보니, 지금 README가
  개발자에게 머릿속으로 순서를 기억하며 손으로 하나하나 실행하게 하는 단계가 얼마나 많은지,
  그리고 그 각각이 이번 실행에서 실제로 겪은 고유한 실패 양상을 갖고 있다는 게 드러났다:
  EKS `cluster_version`이 이미 지원 종료(EOL)된 Kubernetes 마이너 버전으로 고정돼 있어 그
  버전용 새 노드그룹 AMI 자체가 없었던 문제; `graviton` 노드그룹에 `ami_type`을 명시하지
  않으면 모듈이 `instance_types`로부터 이를 추론해주지 않는 문제; AWS 계정의 Free Tier
  인스턴스 타입 제한이 `m6g.large`/`m5.large` 실행 자체를 거부한 문제; ACM의
  `domain_validation_options`에 대한 `for_each` 패턴이 2단계 apply(`-target` 후 전체)를
  강제하는 문제; Route53 NS 위임 전파가 스크립트로 "완료" 신호를 잡을 수 없는 외부
  대기라는 문제; 기존에 있던 S3 버킷이 새로 import하려는 리전과 다른 곳에 있던 문제;
  `aws-load-balancer-controller`의 admission webhook과 `external-secrets`의 `Service`
  생성 사이의 경합으로 Helm 릴리스가 `failed`로 남아 수동으로 `helm uninstall` 후
  재시도해야 했던 문제; 그리고 `eks-managed-node-group`의 `lifecycle { ignore_changes =
  [scaling_config[0].desired_size] }`가 생성 이후 `-var`를 통한 스케일 변경을 조용히
  무시해서 별도로 `aws eks update-nodegroup-config`를 써야 했던 문제. 이 중 어느 하나도
  단순히 고쳐야 할 버그 하나가 아니다 — 이것들을 합쳐보면, 매번 사람이 README 산문에서
  같은 순서와 같은 장애 복구 절차를 다시 떠올리게 하는 대신, 이 순서(와 그 안의
  순서 의존성·재시도·전파 대기 로직)를 스크립트나 CI 파이프라인으로 감싸야 한다는
  근거가 된다 — 그리고 그것이 바로 위 ADR 0046이 지금 한 일이다.
- **로그인 화면의 마크를 교체하거나 걷어내고, 쓰이지 않는 아이콘 스프라이트를 삭제** (2026-08-25
  기록) — Sharenpo 통일 작업(`0a14039`)이 로그인 카드에 워드마크와 나란히
  `<img src="/favicon.svg">` 락업을 넣었다. 그 작업 기준으로는 옳은 판단이었다. 이름 변경
  도중에 마크를 새로 만드는 대신 이미 있는 것을 재사용했기 때문이다. 그런데 **재사용한 그
  파일이 애초에 이 프로젝트 것이 아니다.** `frontend/public/favicon.svg`는 2026-07-24 Vite
  스캐폴드 커밋(`6950034`)에 스타터 템플릿 아트워크로 딸려 들어왔고(디자인 툴에서 export한
  보라색 번개 도형 — 9.5KB, 마스크, display-p3 색), 같은 커밋이 `frontend/public/icons.svg`도
  가져왔는데 그 심볼이 `bluesky`·`discord`·`github`·`x`·`documentation`·`social`이다. 즉
  사용자가 Sharenpo 로그인 화면에서 가장 먼저 보는 것이 템플릿의 로고다. 실측한 문제가 둘:
  마크는 `#863bff`인데 `--brand`는 `#8a2be2`(라이트)/`#c084fc`(다크)라 **세 번째 보라색**이
  자기가 대표해야 할 브랜드 옆에 놓인다. 그리고 `icons.svg`는 `frontend/src`와 `index.html`
  어디에서도 **참조가 0건**이다 — `admin/`에서 걷어낸 Chat Project 잔재와 같은 종류의 죽은
  템플릿 잔여물이다. 열린 결정은 방향이다: 진짜 Sharenpo 마크를 만들 것인가, 아니면 아이콘을
  걷어내고 워드마크 하나로 락업을 유지할 것인가(가장 저렴하고, 워드마크가 이미 있으므로
  방어 가능한 선택). 어느 쪽이든 `icons.svg`는 삭제 대상이며 이쪽은 결정이 필요 없다.
  **아래 디스플레이 서체 항목과 함께 묶어 진행할 것** — 워드마크의 서체와 마크는 하나의
  결정이지 둘이 아니며, 따로 하면 락업을 두 번 설계하게 된다.
- ~~전 화면 반응형 레이아웃~~ — **2026-08-24 완료**(커밋 `d746257`,
  [CHANGELOG.ko.md](CHANGELOG.ko.md) `[Unreleased] > 변경`). *측정이 계획을 반박했다는 점*
  때문에 기록해 둔다: 이 작업은 "`@media` 블록이 없는 `*.module.css`는 휴대폰에서 다 깨진다"는
  가정 위에 범위를 잡았지만, 390px 뷰포트에서 실제로 넘친 화면은 게시글 보드 하나뿐이었다
  (265px 초과). `#root`가 이미 `max-width: 100%`이고 모든 페이지가 `max-width` 기반이라
  나머지는 스스로 접혔다. 유일한 실제 붕괴는 `flex: none`이 걸린 작성자 이메일이었고, 그
  min-content가 페이지 전체를 591px로 고정하고 있었다. 모바일에서는 잘라내지 않고 줄바꿈하는
  쪽으로 고쳤다 — 휴대폰은 세로 공간이 넉넉해 제목과 이메일을 전문으로 보여줄 수 있다는
  가독성 판단이다 — 데스크톱 행은 한 줄 말줄임을 그대로 유지한다. breakpoint는 코드베이스에
  이미 있던 1024px와 640px을 재사용했고 세 번째 값은 만들지 않았다. 프레임은 모든 단계에서
  충분히 크다(346×196 / 368×208 / 589×332). 화면 5개 × 폭 5종에서 오버플로 0, e2e 22/22 통과를
  확인했다. 터치 타겟 크기는 명시적으로 제외했다 — 다음 행 참고.
- 모바일 터치 타겟 크기 (2026-08-24 기록) — **미착수 이유**: 위 반응형 작업에서 의도적으로
  범위 밖에 뒀다. 모든 버튼과 링크를 최소 44px로 키우는 일은 이 앱에 이미 필요한 접근성 작업과
  겹치는데, 폭 구간 작업 안에서 그 절반만 처리하면 나머지 절반이 이미 끝난 것처럼 보이게 된다.
  2026-08-24 실측: 프론트엔드에 `aria-*` 속성은 6개 있지만 그중 5개는 이모지 아이콘에 붙은
  장식용 `aria-hidden`이고, 실제로 정보를 전달하는 것은 `NavBar` 테마 토글의 `aria-label`
  하나뿐이다. `:focus-visible` 규칙 18개 중 4개를 뺀 나머지는 전부 input·select·textarea에
  붙어 있고, 버튼에 붙은 4개는 모두 새 파일 그리드(`FilePreviewTile`, `FileBoard`)에 있다.
  즉 그 외의 모든 버튼 — `PostBoard`의 clear/creator/페이저, `PostDetailPage`의 delete/primary,
  `CommentThread`의 delete/load-more, `FileDetailPage`의 copy/rotate/delete — 은 여전히 키보드
  포커스가 보이지 않는다. 단독으로 하지 말고 그 접근성 작업과 함께 진행한다.
- ~~파일 보드 프리뷰 그리드화 (`/files`)~~ — **2026-08-24 완료**(커밋 `e567277`,
  [CHANGELOG.ko.md](CHANGELOG.ko.md) `[Unreleased] > 변경`). 보드가 파일당 텍스트 한
  줄만 보여줬기 때문에, 상세 페이지를 열지 않고서는 어떤 파일인지 알 방법이 없었다.
  이제 3열 16:9 프리뷰 그리드가 되어 스크롤하면 3xN으로 펼쳐지고, 기존 ADR 0021 제목
  검색은 필터 행의 남는 폭을 갖게 됐다. 밝혀진 근거: 요즘 기기 성능이면 파일을 받아
  오는 것 자체는 무리가 없고 스크롤이 텍스트 목록보다 빠르게 읽히지만, 프리뷰가 쌓여
  성능 저하로 이어져서는 안 된다 — 그래서 그리드는 적극적으로 받아오면서도 한 세션이
  쌓을 수 있는 양에 상한을 둔다(이미지는 뷰포트 진입 시, 영상은 명시적 클릭 시에만,
  오디오는 아예 받지 않으며 자동 로드는 180개에서 멈춘다). ADR은 없다: `frontend/`는
  결정을 `docs/ADR/`가 아니라 CHANGELOG와 `frontend/docs/`에 남기는 관례다. 이 작업이
  드러낸 후속 과제 2건이 바로 다음 두 행이다.
- ~~**제품명을 `Sharenpo`로 통일**~~ — **2026-08-25 반영**
  ([CHANGELOG.ko.md](CHANGELOG.ko.md) `[Unreleased] > 변경`). 2026-08-25에 결정했고 범위는
  Helm을 포함한 전면 통일로 확정했다. 반영된 것: Helm 차트(`Chart.yaml`의 `name:`과
  `upload-board-project.*` 헬퍼 참조 **27곳** — 원래 이 행에 26곳으로 적혀 있던 파일별 집계는
  `NOTES.txt`(2)와 `values.yaml` 헤더 주석(1)을 빠뜨리고 있었다), 화면에 보이는 이름
  (`frontend/index.html`의 `<title>`, `admin/index.html`, `admin/public/favicon.svg`의 `UB` →
  `S`, 그리고 기존 favicon 마크를 재사용한 새 로그인 워드마크 락업), 문서(`README.md`(+ko)
  H1, `frontend/README`(+ko), `frontend/docs/API-CONTRACT`(+ko)), 기계적 식별자
  (`package.json` 3개 — `admin`도 `frontend`처럼 이름이 없었고 이건 원래 범위 밖이었다 —
  `docker-compose.yml` 이미지 태그, `backend/main.ts`의 Swagger 제목, e2e 데이터베이스 이름,
  모크 버킷명). 진짜로 새로 판단해야 했던 한 가지는 예상대로였다: `_helpers.tpl`의 `fullname`은
  차트 이름이 아니라 `.Release.Name`이라, 차트 이름만 바꿔서는 `helm install upload-board .`의
  결과가 달라지지 않는다 — 그래서 두 런북의 릴리스명을 별개의 판단으로 바꾸고 그 구분을 문서에
  적어 뒀다. 일부러 손대지 않은 것: ADR 본문, 기존 CHANGELOG 항목, `bluecode1775/sharenpo`,
  그리고 레거시 `upload-board-pg` 컨테이너 참조(실제로 존재하는 수동 생성 컨테이너를 가리키므로
  이름을 바꾸면 안내문이 거짓이 된다). **전제 하나가 틀린 것으로 드러났다** — 이 행은
  "Terraform 미적용"이라고 적고 있었지만 실제로는 적용되어 있다. 다음 행 참고.
- **Terraform/AWS 인프라 식별자를 `sharenpo`로 개명** (2026-08-25 기록, 의도적 보류) —
  **미착수이며, 급하지 않다.** 위 행을 작업하다 발견했다: `CLAUDE.md`와 ADR 0043·0044의 추가
  기록은 아직도 Terraform이 실제 AWS에 적용된 적 없다고 말하지만, `cluster/`와 `app-infra/`의
  상태 파일이 각각 serial 235·23이고 둘을 합쳐 리소스 인스턴스 108개를 담고 있다 — 살아 있는
  EKS 클러스터, RDS 인스턴스, S3 버킷, Route53 존, ACM 인증서. 기본값을 바꾼 뒤 돌린
  `terraform plan`이 비용을 측정해 줬다: `app-infra`는 **10 add / 2 change / 8 destroy**이고
  `aws_db_instance.db must be replaced`인데, `db_name`과 `username`이 둘 다 ForceNew이고
  인스턴스가 `skip_final_snapshot = true`, `deletion_protection = false`라 교체가 곧 최종
  스냅샷 없는 데이터 소멸을 뜻한다. `cluster`는 **34 add / 20 change / 34 destroy**이며
  `aws_eks_cluster.this[0] must be replaced`가 포함된다. 아무것도 apply하지 않았고 기본값은
  되돌렸다. **일정에 넣지 않고 보류한 이유**: AWS 리소스 이름은 브랜딩이 아니다. 사용자에게
  보이는 표면은 이미 전부 `Sharenpo`이고, 특히 도메인 계층은 이미 `sharenpo.com`(Route53 +
  ACM)에 IAM 사용자도 `sharenpo-user`라, 사용자가 만지는 것 중 이 항목에 걸리는 게 없다.
  미룬다고 비용이 커지지도 않는다 — 언제 하든 클러스터 재구축과 데이터베이스 마이그레이션이
  들고, 다른 이유로 인프라를 새로 세우는 시점(리전 이동, 환경 재구축, remote state 전환)에는
  **공짜**가 된다. 그때가 할 때다. **실제로 할 때**, 데이터베이스 쪽은 반드시 논리 마이그레이션
  이어야 한다 — 기존 인스턴스 안에 새 이름의 데이터베이스와 롤을 만들고 `pg_dump`/복원한 뒤
  Terraform이 그쪽을 가리키게 하는 방식이며, Terraform이 주도하는 교체는 안 된다. 참고로
  `Blueprint = upload-board-project` 태그는 upstream `terraform-aws-eks-blueprints` 모듈이
  붙이는 값이라 완전한 통일은 애초에 불가능하다. "적용된 적 없음"이라는 서술은 2026-08-25에
  `CLAUDE.md`(+ko)와 `k8s/infra/terraform/README.md`(+ko)에서 정정했다. **ADR 0043·0044의
  Addendum에는 아직 그대로 남아 있으며, 이는 의도적이다** — ADR은 작성 시점의 사실을 기록하므로
  고치지 않고, 정정의 기준은 이 행이다.
- **디스플레이 서체 탐구 후 구현** (2026-08-25 기록) — **의도적으로 열어 둔다.** 제약을 미리
  박지 않았다: 웹폰트, 셀프호스팅, 시스템 폰트 유지가 모두 후보이며 그 선택 자체가 탐구의
  결과물이다. 메우려는 공백은 구체적이다: `index.css`가 `--heading`과 `--sans`를 **바이트
  단위로 동일하게**(`system-ui, 'Segoe UI', Roboto, sans-serif`) 정의하고 있어 헤딩 토큰이
  존재하되 아무것도 표현하지 않으며, `frontend/docs/STYLE-PLAN.ko.md`가 확정한 "브랜드 전면"
  방향을 지금은 강조색 하나가 떠받치고 있다. 탐구 세션이 결정하는 게 아니라 물려받는 제약이
  둘 있다: `frontend/CLAUDE.md`는 의존성 추가 전 제안을 요구하며(호스팅 폰트도 여기 해당),
  팔레트는 이미 확정이다 — 이건 타이포그래피 문제이지 브랜드 색을 다시 여는 일이 아니다.
  별개지만 함께 묶기 충분히 저렴한 사항: 이 앱에는 **모션이 전무하고**
  (`transition`·`animation`·`@keyframes`가 전 스타일시트에 0회 등장) `--shadow`는 정확히 한
  곳에서만 쓰여, hover·focus가 즉시 점프하고 모든 표면이 평면으로 읽힌다.
- `admin/`의 작은 화면 전용 레이아웃 (2026-08-24 기록) — **미착수 이유**: 이 콘솔은 배포
  대상이 없고 데스크톱에서 운영되므로 현재 노출이 사실상 없다. 대신 접근을 되살리는 최소
  조치만 반영했다 — 세 테이블 래퍼를 `overflow-x-auto`로 바꿨다. 375px에서 users 테이블이
  역할 `<select>`와 Delete 버튼을 아예 손 닿지 않는 곳으로 밀어내고 있었기 때문이다(272px가
  가려졌는데 스크롤바도, 이를 알려줄 페이지 오버플로도 없었다). 휴대폰에서 여전히 넓은
  테이블이라는 사실은 그대로다. 그 폭에 맞춰 설계된 레이아웃(행 대신 카드, 또는 열 우선순위)이
  남은 작업이며, 생각보다 큰 건이다 — 콘솔 전체의 반응형 유틸리티가 통틀어 2개뿐이다.
- `admin/`과 `frontend/`의 디자인 체계 분리 (2026-08-24 기록) — **미착수 이유**:
  [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)가 의도적으로 선택한
  상태다. Chat Project 콘솔을 색과 레이아웃은 손대지 않은 채 가져오고 API·도메인 계층만
  적응시켰다. 따라서 이 분리는 결함이 아니라 유효한 결정이다: 다크 모드 지원이 전무하고
  (`dark:`가 0회 등장하는 반면 `frontend/`에는 명시적 라이트/다크 토글이 있다), 강조색이
  `frontend/`의 브랜드 보라와 달리 파랑이며, 로그인 필드에 라벨 없이 placeholder만 있다.
  되돌리려면 코드 변경 이전에 디자인 결정이 선행돼야 한다.
- 서버측 썸네일 엔드포인트 (2026-08-24 기록) — **미착수 이유**: 파일마다 파생 산출물을
  하나 더 만들고 그것을 어디에 저장할지·언제 생성할지까지 정해야 하는 백엔드 변경이며,
  위 그리드가 반드시 필요로 하는 것은 아니다. 다만 그 그리드가 감수한 가장 큰 타협의
  근본 원인이기도 하다: 썸네일이 없으면 `private` 파일의 프리뷰는 곧 객체 전체를
  — 업로드 상한인 100MB까지([ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md))
  — 내려받는 일이 된다. `<img>`/`<video src>`는 Bearer 헤더를 실을 수 없어 그 바이트를
  읽을 수 있는 경로가 인증된 blob뿐이기 때문이다(ADR 0025/0026). 영상 타일의 클릭
  게이트는 오로지 이 비용을 묶어두기 위해 존재한다. 썸네일 엔드포인트가 생기면 게이트를
  없애고 모든 타일을 즉시 미리 보여줄 수 있다. 썸네일을 어디에 둘지는 스토리지 결정이므로
  (ADR 0029의 `FileStorage` 포트에 새 연산이 필요하다) Stage 4의 S3 전환과 함께 재검토한다.
- 저장 바이트가 사라진 개발 DB 행 (2026-08-24 기록) — **미착수 이유**: 제품 결함이 아니라
  로컬 테스트 데이터 위생 문제다. 위 그리드를 검증하며 2026-08-24에 실측한 내용: 당시 공유
  개발 DB에 보이던 공개 파일 **25건 중 23건**이 `GET /file/:id/content`에서
  `404 FILE_NOT_FOUND`를 돌려줬다 — 이미지와 오디오 행 전부, 그리고 영상 22건 중 20건이다.
  실물 파일은 이미 사라졌는데 메타데이터 행만 남은, e2e 실행이 남긴 잔여물이다. 예외 2건은
  바로 그날의 e2e 실행이 몇 분 전에 만든 것이었고, 이 숫자가 실행할 때마다 늘어나는 이유도
  같다 — 그대로 믿기보다 다시 측정해야 한다. 이제 이들은 `⚠ Preview unavailable`
  타일로 렌더되는데, 동작 자체는 올바르지만 수동 QA 때 보드가 고장 난 것처럼 보인다. 이
  행들을 정리할지, 아니면 e2e 스위트가 스스로 뒤처리를 하게 할지 결정해야 한다(스위트는
  개발 DB를 의도적으로 truncate하지 않는다 — `test/e2e-utils.ts` 참고). 이는 *개발* DB에
  한정된 이야기이며, 운영 데이터 경로와는 무관하다.
- Terraform 원격 state backend (2026-08-19 기록,
  [ADR 0044](ADR/0044-terraform-three-state-split.ko.md) D3) — **미착수
  이유**: 3-state 분할의 `terraform_remote_state`는 의도적으로 `backend =
  "local"`을 쓰며, 개발자 1인의 `apply`/`destroy` 사이클에만 범위를 한정한
  선택이다. 아직 실제 AWS에 한 번도 `apply`하지 않은 설정(ADR 0043 D1)에
  S3+DynamoDB 락(또는 Terraform Cloud) 원격 backend를 지금 도입하는 건
  요청받지 않은 추가 범위 확장이다. 두 번째 개발자나 CI 파이프라인이 이
  설정을 apply해야 할 때 재검토한다.
- Distroless 런타임 베이스 (2026-08-08 기록, [ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md))
  — **미착수 이유**: Node 24용 distroless 태그(`gcr.io/distroless/nodejs24-debian12`
  등)가 실제로 존재하는지 실물 레지스트리로 검증하지 않았고, distroless는 이
  프로젝트가 지금 가진 유일한 디버깅 경로(`docker exec`)를 없애는데 이를 대체할
  K8s 네이티브 수단(`kubectl debug`, ephemeral debug container)이 아직 없다.
  태그가 확인되고 Kubernetes 단계(아래)가 ephemeral-debug 도구를 갖춘 뒤
  재검토한다 — 이미 반영된 non-root 하드닝과는 별개다. 그쪽은 이런 미검증
  의존성이 없었기 때문이다.
- ARM/Graviton(멀티아치) 컨테이너 빌드 (2026-08-08 기록,
  [ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md)) — **미착수
  이유**: `bcrypt`의 프리빌드 바이너리가 x64 전용이고, 아직 어떤 배포 타깃도
  인스턴스 아키텍처를 선택하지 않았다 — 아무것도 돌지 않을 아키텍처를 위해
  미리 빌드하는 것은 Scope Discipline이 배제하는 추측성 작업이다. 위 Terraform
  노드 그룹 결정(프로덕션 DevOps 스택 도입)의 일부로 재검토한다 — 실제로 이
  작업이 대상 인스턴스 패밀리를 고른다.
- AWS Secrets Manager + External Secrets Operator(ESO) 연동 (2026-08-08 기록,
  [ADR 0033](ADR/0033-secrets-delivery-target.ko.md)) — **미착수 이유**: 실제
  AWS 계정, IRSA용 IAM 롤, ESO가 설치된 동작 중인 Kubernetes 클러스터가
  필요한데 지금은 그중 아무것도 존재하지 않는다. 목표 형태(K8s `Secret`을 앱의
  직접 인터페이스로, 그 안으로 Secrets Manager가 동기화)는 확정됐다 —
  프로비저닝은 Terraform/IaC 작업이며, 위 Terraform 도입 행과 함께 착수하도록
  스케줄링한다.
- Kubernetes `Ingress`/ALB + TLS 인증서 프로비저닝 (2026-08-08 기록,
  [ADR 0034](ADR/0034-https-termination-stance.ko.md)) — **미착수 이유**: 동작
  중인 Kubernetes 클러스터와 확정된 인증서 소스(ACM vs. cert-manager +
  Let's Encrypt)가 필요한데 둘 다 아직 정해지지 않았다. 방침(ingress에서 종단,
  앱 안에서는 하지 않음)은 확정됐다 — 위 Helm/K8s 작업과 함께 착수하도록
  스케줄링한다.
- ADR 0026 콘텐츠 엔드포인트 후속 (2026-08-01 기록, `GET /file/:id/content`
  [file-content.controller.ts](../backend/file/file-content.controller.ts) 구현 후 검토), 심각도 순:
  1. **[중간] 스트림 에러 미처리** — 200·206 경로의 `createReadStream(...).pipe(res)`에
     `'error'` 리스너가 없어, 헤더가 나간 뒤 읽기 실패(스트리밍 중 `DELETE /file/:id` 경합,
     디스크 오류)가 미처리 `'error'` 이벤트로 프로세스를 크래시시킨다(Never Do Group 1). 수정:
     응답을 destroy하고 `warn`으로 로그하는 `stream.on('error', …)` 부착.
  2. **[낮음] Suffix `Range: bytes=-N` 오처리** — 마지막 N바이트 요청을 앞 N+1바이트로 서빙한다.
     플레이어는 `bytes=N-`를 써서 영향 낮음. 여유 될 때 suffix 분기 추가.
  코드 불요 관찰(수정 없음): `416` 응답에 `ErrorBody` code 없음(프로토콜 레벨); 다중 필드 첨부
  거부 시 남는 temp orphan은 ADR 0018 스윕이 회수; `file/temp`는 여전히 정적 서빙(기존 동작,
  가시성 범위 밖). 전체 서술은 [ADR 0026](ADR/0026-file-visibility-implementation.ko.md) > 알려진 한계.
- e2e용 Testcontainers (2026-07-26 기록): e2e 스위트는 throwaway DB와 jest
  `setupFiles` env 오버라이드([ADR 0016](ADR/0016-github-actions-ci.ko.md),
  `test/e2e-env.ts`)를 쓴다 — 유효하지만 env-before-import 타이밍과 사전 프로비저닝된
  Postgres에 의존한다. Testcontainers(실행마다 격리 컨테이너를 Nest provider
  override로 주입)는 둘 다 제거한다. 유예: 새 dev 의존성과 CI 변경을 수반하므로 배포
  환경(Stage 4) 확정 시 재검토.
- 라이선스: `package.json`은 `UNLICENSED`인데 재작성 전 README는 MIT로 표기 —
  저장소 공개 전 결정 필요.
- Chat 프로젝트 잔재 처리 ([계획서](CHAT-REMNANT-REMOVAL-PLAN.ko.md)): git
  히스토리 결정 + 신규/붙여넣기 문서 재검증 트리거.
- dev 전이 의존성 `pnpm audit` 지적(handlebars — ts-jest 경유;
  glob/minimatch/webpack — jest·@nestjs/cli 경유) — 빌드/테스트 시점 전용;
  업스트림 릴리스 대기. (`pnpm audit --prod`는 2026-07-24 기준 클린.)
- API 버저닝 시점 — 소비자는 이제 결정되었다; 버저닝은 동결 이후 실제 breaking
  변경이 필요해질 때 활성화한다(설계 기준 참조).
- 프론트엔드 스택 — **2026-07-24 결정: React + Vite** (이 REST API를 소비하는
  SPA; Next.js는 SSR/API 라우트가 이 백엔드와 역할 중복이라 기각, Vue는 차순위).
  저장소 내 `frontend/` 하위 폴더(ADR 0010, 구조 2026-07-24 개정)로 존재하며
  2026-07-24 생성·E2E 검증 완료; 호스팅은 이후 배포 결정.
- 공식 로그인 경로 — **2026-07-24 결정: `POST /auth/signin` (Basic)**. 리스크·
  유지보수 최소 기준으로 선택(`register`가 어차피 쓰는 `parseBasicToken`을
  재사용; RFC 7617 프로토콜 표준; ADR 0001로 뒷받침). 따라서
  `POST /auth/signin/local`(+ `LocalStrategy` + `LocalAuthGuard`)은 **제거
  후보** — 제거는 Scope Discipline상 별도 전용 작업이며 부수 작업이 아니다;
  그때까지는 존치한다.
- 업로드 청구 계약의 프론트엔드 반영 (2026-07-27 기록,
  [ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)) — **백엔드 작업이 아니라
  프론트엔드 전용 과제가 담당한다.** `POST /file`은 이제 201뿐 아니라 200(멱등
  replay)도 응답하고, 409 `FILE_ALREADY_CLAIMED`는 이 API가 처음 내보내는 상태
  코드다. `frontend/docs/API-CONTRACT.md`와 클라이언트 업로드 흐름을 함께 갱신해야
  하며, 그전까지 프론트엔드는 replay를 새 생성으로 취급하고 409 분기도 갖고 있지
  않다. 백엔드 변경은 저장소 경계에서 의도적으로 멈췄다([CLAUDE.md](../CLAUDE.md) >
  Project Overview: `frontend/`는 자체 CLAUDE.md와 툴체인을 가지며, 백엔드 작업에서
  프론트엔드 파일을 편집하지 않는다).
- 삭제 계약의 프론트엔드 반영 (2026-07-30 기록,
  [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)) — 위의 청구 계약 항목과 마찬가지로
  **백엔드 작업이 아니라 프론트엔드 전용 과제가 담당한다.** `DELETE /user/:id`는 파일을
  보유한 계정에 대해 `?deleteFiles=true`를 요구하고, 없으면 409 `USER_HAS_FILES`(메시지에
  개수 포함)를 낸다. 경고 다이얼로그, 확인 후 재요청, 409 분기는 모두 `frontend/`의 몫이다.
  `frontend/docs/API-CONTRACT.md`와 계정 삭제 흐름을 함께 갱신해야 하며, 그전까지 프론트엔드
  에는 확인을 통과시킬 경로가 없다. 백엔드 변경은 저장소 경계에서 멈췄다
  ([CLAUDE.md](../CLAUDE.md) > Project Overview).
- 고아 `granted_` 파일 회수 (2026-07-30 기록,
  [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)) — 삭제는 이제 커밋 이후 best-effort로
  물리 파일을 unlink하므로, 행 없이 `file/upload`에 바이트만 남는 경우가 두 가지 남는다:
  `unlink` 실패(`warn` 로그), 그리고 경로 조회와 연쇄 삭제 사이에 삽입된 파일. 그 폴더를 훑는
  장치는 없다. ADR 0018의 스윕을 복사해 해결하지 **않은** 것은 의도적이다 — "행 없이 디스크에
  있다"는 판정을 파일명만으로 내릴 수 없어 DB 조인 기반 정합 작업과 자체 ADR이 필요하다.
  일정 미배정 — 감수하는 잔여 위험은 디스크 낭비이며, 깨진 레코드는 발생하지 않는다.
- ~~파일 소유권 이전이 post↔file 같은-작성자 불변식을 깰 수 있음~~ — ✅ **2026-07-31 확정**
  ([ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)). comment 모듈이 기다리던 게이트였다.
  세 후보 중 *`23503`을 타입 있는 거절로 번역*을 택했다 — `FileService.deleteFilesOfCreator`가
  409 `USER_FILES_IN_USE`로 답하며, 이는 형제 메서드 `deleteFile`이 `FILE_IN_USE`에 대해 이미
  하던 것과 같다. 나머지 둘을 기각한 이유도 선택만큼 중요하다. 연쇄 확대는 제3자의 게시글을
  파괴하는 데다 comment 과제가 확장할 삭제 순서까지 다시 쓰게 만들고, 규칙을 DB에서 강제하는
  복합 FK는 이 성질이 "처리"가 아니라 *보장*으로 필요해질 때 채택할 형태로 그 ADR에 기록해 두었다.
  남은 것은 잔여물이 아니라 의도된 결과다: 같은-작성자 규칙은 이제 **생성 시점 규칙**이므로,
  자기 파일이 남의 게시글에 걸린 계정은 그 게시글이 사라질 때까지 삭제되지 않는다(409이며 admin이
  치울 수 있다). **그 아래에 깔린 기능 자체는 여전히 미결정이다** — 다음 항목 참조.
- **`PATCH /file/:id { userId }`가 애초에 존재해야 하는가** (2026-07-31 기록,
  [ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)) — `UpdateFileDto`의 이 필드는
  `file_entity.creatorId`를 갈아끼워 파일을 다른 계정으로 통째로 넘긴다. 원 소유자는 모든 쓰기
  권한을 잃고, 받는 쪽은 동의한 적이 없다. 이 기능을 언급하는 ADR은
  [ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md)뿐이고 그마저 *가드*가 생성자 전용이라는
  말만 한다 — **사용자가 왜 파일을 남에게 넘길 수 있어야 하는지를 논증한 결정이 어디에도 없다.**
  최초 CRUD DTO에 딸려 온 필드가 그대로 살아남았고 이후의 모든 결정이 그것을 기정사실로 놓았으며,
  그래서 ADR 0024가 떠안아야 했던 불변식 파손의 유일한 원인이 됐다. 후보 세 가지이며 각각 패치가
  아니라 결정이다: 근거를 명시하고 유지하거나, 수령자 동의 절차를 붙이거나(이전 대기 행 — 스키마
  변경), 필드를 제거하거나. 제거하면 전역 파이프의 `forbidNonWhitelisted` 덕분에 여전히 `userId`를
  보내는 클라이언트는 조용한 무시가 아니라 400 `VALIDATION_FAILED`를 받는다. **다만 제거가 공짜는
  아니다**: 소유권 이전이 사라지면 같은-작성자 규칙이 다시 참인 불변식이 되므로, ADR 0024의
  `23503` 분기와 `PostService.resolveAttachment`의 작성자 동일성 확인이 **둘 다 도달 불가능한
  가드**가 된다. 같은 변경에서 함께 걷어내야 하며, 따라서 이 선택지는 ADR 0024와 나란히 서는 게
  아니라 그것을 대체한다. 자체 ADR이 필요하다.
- 유보한 목록 조회 인덱스 (2026-07-30 기록,
  [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)) — 검색/필터/정렬 과제는
  의도적으로 **인덱스를 하나도 추가하지 않고** 마무리했다. 이 테이블 규모에서 후보 셋 다
  측정 없는 추측이기 때문이다. 각각은 측정을 기다리는 평문 기술 상태이며, 도입할 때는 승인과
  `migration:generate` 출력의 라인단위 검토를 거쳐야 한다. `("createdAt" DESC, "id" DESC)`는
  기본 정렬과 페이지 경계용(대략 10⁴행 이상에서 정당화된다), `pg_trgm` GIN on `lower(title)`은
  `ILIKE '%term%'`가 인덱스를 쓸 수 있게 되는 *전제 조건*이라 확장 + 인덱스의 2단계
  마이그레이션이 되고, `("creatorId")`는 Postgres가 자동 생성하지 않는 인덱스로 새 필터와 계정
  연쇄 삭제([ADR 0020](ADR/0020-account-deletion-cascade.ko.md)) 양쪽에 쓰인다. 그때까지
  `search`/`creatorId`는 순차 스캔이고 정렬은 전체 정렬이다 — 이 규모에서 감수하는 트레이드다.
  뒤집는 근거는 직관이 아니라 측정이어야 한다.
- 목록 조회 파라미터의 프론트엔드 반영 (2026-07-30 기록,
  [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)) — 위의 청구 계약·삭제 계약 항목과
  마찬가지로 **백엔드 작업이 아니라 프론트엔드 전용 과제가 담당한다.** `GET /file`이 이제
  `search`, `sortBy`, `order`, `creatorId`를 받고, 이전에는 임의였던 순서를 기본 최신순으로
  돌려준다. `frontend/docs/API-CONTRACT.md`와 목록 화면(검색창, 정렬 컨트롤, 작성자 필터)을
  함께 갱신해야 하며, 그전까지 프론트엔드는 기존처럼 `take`/`skip`만 보내면서 결정적 정렬만
  그대로 얻는다. 백엔드 변경은 저장소 경계에서 멈췄다([CLAUDE.md](../CLAUDE.md) > Project Overview).
- ~~게시글/댓글 API의 프론트엔드 반영~~ — ✅ **2026-08-11 해소** (2026-08-11 기록,
  [ADR 0023](ADR/0023-board-domain-schema.ko.md)) — 위 항목과 마찬가지로 **백엔드 작업이
  아니라 프론트엔드 전용 과제가 담당한다.** 라우팅 기반 작업이 먼저 착지했다: `/`가
  이제 앱의 홈(`PostBoard`)이고, 파일 보드는 `/files`로 옮겼으며, `/posts/:id`를
  예약해 뒀다(`PostDetailPage`). `PostResponse`/`CommentResponse`는 `src/api/types.ts`에서
  백엔드 DTO를 미러링하고 있고, `frontend/docs/API-CONTRACT.md`가 해당 라우트를 문서화한다.
  **게시글 목록/작성은 같은 날 착지했다**: `PostBoard`가 `PostForm`(title/body + 선택적으로
  `FilePicker`가 고른 파일, `POST /post` — 200 재생(replay)과 201 신규 생성을 동일하게
  처리)과 게시글 목록 자체(`FileBoard`를 그대로 본뜬 검색/정렬/작성자 필터/페이지네이션,
  행마다 첨부파일 아이콘, ADR 0021)를 함께 호스팅하며, 새 `posts.spec.ts` e2e 스펙이
  이를 검증한다. **게시글 상세 + 댓글 스레드가 마지막으로 착지하며 이 항목을 마무리했다**:
  `PostDetailPage`는 게시글과 첨부파일을 불러오고(`FileDetailPage`와 동일한 visibility
  기반 재생 패턴), 작성자/admin에게 인라인 수정/삭제를 제공한다. `CommentThread`는 순서가
  고정된(`createdAt ASC`) 스레드를 "더 보기" 페이저와 함께 표시하고, 각 댓글은 그 댓글의
  작성자 본인/admin만 인라인 수정/삭제할 수 있다. `CommentForm`은 새 댓글을 작성하고
  재fetch를 트리거한다 — 이 앱에는 실시간/폴링 인프라가 없기 때문이다. 전체 Playwright
  스위트: 22/22 통과.
- ~~파일 가시성 + 미디어 확장의 프론트엔드 반영~~ — ✅ **2026-08-03 해소**
  (2026-07-31 기록, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md); 두 절반
  모두 2026-08-01 백엔드에서 착지 — 가시성은
  [ADR 0026](ADR/0026-file-visibility-implementation.ko.md), 미디어 타입 확장은
  [ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md)). 이 항목이 요구하던 네
  가지가 모두 `frontend/`에 반영됐다: 파일 보드(검색/정렬/필터/페이지네이션/visibility
  배지, `FileBoard.tsx`), 파일 상세 페이지(visibility별 재생 — public/unlisted은
  `<video src>` 직접 재생, private은 인증된 blob+objectURL 페치), 파일 관리 액션(visibility
  토글, 공유 링크 회전, 삭제 — 모두 `PATCH`/`DELETE /file/:id`로 처리), 그리고 업로드
  폼(ADR 0027의 필드별 허용목록을 미러링하는 `image`/`audio`/`video` 필드, 그리고 같은
  과제에서 함께 추가된 XHR 기반 업로드 진행률 표시 — `fetch`는 업로드 진행률 이벤트를
  제공하지 않기 때문). `frontend/docs/API-CONTRACT.md`는 콘텐츠 엔드포인트
  `fileUrl`/`visibility`/`shareUrl` 형태와 3필드 업로드 계약을 이미 문서화하고 있다.
- `ARCHITECTURE.md`(+ko)의 문서 부패 (2026-07-30 기록) — Stage 1 착지 내용이 이 문서에
  전혀 반영되지 않았다. "Non-Existent Infrastructure"는 여전히 CI 워크플로·Dockerfile·Nest
  `Logger` 사용이 없다고 서술하지만 셋 다 존재하고
  ([ADR 0015](ADR/0015-docker-and-compose.ko.md)/[0016](ADR/0016-github-actions-ci.ko.md)/[0017](ADR/0017-logging-conventions.ko.md)),
  Jest `roots`는 `["src"]`로 적혀 있으며(실제는 `["backend"]`), Testing 섹션에 e2e 서술이
  없고, `PATCH /user/:id`·`PATCH /file/:id`는 RBAC 이전의 "본인만"·"작성자만"로 남아 있다
  ([ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)). 부수 작업이 아니라 전용 문서 감사 과제로
  다룬다 — 기능 커밋에 섞으면 그 커밋이 무엇을 결정했는지가 흐려진다. **같은 과제에 2026-07-30
  추가**: `CLAUDE.md`의 Never Do Group 2 페이지네이션 예시가 현재 시그니처를
  `getFiles(take, skip)`로 적고 있는데, [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)
  이후로는 `GetFilesDto`를 받는다. *규칙*(목록 엔드포인트는 페이지네이션 필수)은 그대로
  유효하고 예시 문구만 낡았으며, `CLAUDE.md`는 그 과제의 문서 범위 밖이었다.
- ~~이식된 `admin/` 콘솔의 적응~~ — **2026-07-30에
  [Stage 5](#stage-5--운영-화면-admin-콘솔--2026-07-30-추가)로 스케줄됐으므로** 더 이상 미예정이
  아니다. 이 항목이 원래 이 절에서 시작했기에 한 번만 남겨 둔다: Chat Project의 콘솔을
  수정하지 않은 선언된 수정 기반으로 `admin/`에 가져왔고
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)), 목적은 둘이었다 —
  [ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)이 만들지 않고 남긴 **권한 계층 운영 화면**을
  공급하는 것, 그리고 같은 3단계 계층용으로 이미 만들어진 콘솔을 다시 생성하는 LLM 토큰의 극히
  일부로 그것을 해내는 것. 검증된 수정 백로그는 ADR 0022에 있고, 작업 행과 순서, 그것이 의존하는
  백엔드 결정은 이제 Stage 5의 것이다.
- ~~어느 admin 화면이 살아남는가~~ (2026-07-30 기록,
  [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)) — **2026-08-06 해소**.
  콘솔 적응([Stage 5](#stage-5--운영-화면-admin-콘솔--2026-07-30-추가)의 세 번째 행)이 이식본이
  "대부분 삭제 가능"하지 않았음을 보여줬다 — 삭제 가능했던 건 채팅 도메인 잔재뿐이었다 — 그래서
  `admin/`이 유일한 admin 화면이다. `frontend/src/features/admin/AdminPage.tsx`
  ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)이 명세했던 `/admin` 라우트
  구역)을 `frontend/src/App.tsx`의 라우트와 함께 삭제했다. ADR 0010의 admin 배치 조항을 한 번
  더 개정한다 — admin은 이제 `frontend/` 안의 라우트 구역조차 아니다. ADR 0022의 2026-08-06
  추가 기록에 남겼다.
- 문서 문구 동기화 (2026-07-23 유예 결정; 2026-07-29 완료): 계획 수립 이전의
  "후보(candidate)" 표현을 이 계획에 맞춰 정리. ADR 0003("candidate roadmap
  item")은 이제 반영된 [ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)을 가리키고,
  ADR 0006 Consequences("top roadmap item")에는 날짜 병기 완료 주석이 붙었으며,
  `CHAT-REMNANT-REMOVAL-PLAN`("ROADMAP's CI candidate")은 이제 착지된 Stage 1
  CI([ADR 0016](ADR/0016-github-actions-ci.ko.md))를 가리킴. **완료.**
- 사전-의무화 서비스의 코드 내 트레이드오프 문서화 공백 (2026-08-02 기록) — 코드베이스
  전수 조사 결과, 트레이드오프 서술은 촘촘하되 **계층화**되어 있다: ADR은 결정 수준
  트레이드오프를 빠짐없이 담고(`## Consequences` 절 + 기각안, ADR당 마커 5~39개), 호출
  지점 수준 — 의무 목적/이유/방법 블록의 `이유` 라인([CLAUDE.md](../CLAUDE.md) > File Creation
  Convention) — 은 게시판/가시성 세대 서비스에서는 촘촘하지만(`file.service` 17블록,
  `post.service` 12, `comment.service` 8), **가장 오래된 `auth.service.ts`에는 0블록으로
  부재**하며 그 트레이드오프는 [ADR 0001](ADR/0001-basic-token-authentication.ko.md) /
  [0002](ADR/0002-dual-secret-token-pair.ko.md) /
  [0012](ADR/0012-refresh-cookie-rotation.ko.md)에만 있다. 이는 **규칙 위반이 아니다** —
  블록 의무화(커밋 `995df5e`)는 *새로 만들거나 수정한* 함수에만 적용되는데, auth.service는
  그보다 앞서 만들어졌고 이후 수정되지 않았다 — 따라서 결함이 아니라 결정 계층(촘촘)과
  호출 지점 계층(희박) 사이의 문서화 밀도 공백이다. **전 Stage 완료 후 진행할 후속 작업으로
  일정 배정**하며, 지금 하지 않는 것은 의도다: 동작 변경이 없는 문서 전용 패스이고, 단계가
  끝나기 전에 하면 이후 단계(auth를 건드리는 작업)가 어차피 수정할 함수를 헛되이 흔드는
  꼴이 된다 — 그 수정이 블록을 부수 효과로 추가해 공백을 공짜로 줄여 줄 수 있다. 전용
  작업은 사전-의무화 서비스(auth.service가 가장 명확한 사례)에 목적/이유/방법 블록을
  소급 추가하고, 각 `이유` 라인이 자기 지배 ADR을 가리키게 한다. 드라이브바이가 아니다:
  저장소 전역 주석 스윕이야말로 Scope Discipline이 기능 커밋에서 배제하는 종류의 변경이므로,
  단계별 작업이 끝난 뒤 자체 작업으로 착지한다.
- ~~`GET /user` 검색/정렬~~ (2026-08-05 기록, 실행 #2 `GET /user` 페이지네이션 작업의 후속으로
  [Stage 5](#stage-5--운영-화면-admin-콘솔--2026-07-30-추가)로 미룸) — 페이지네이션 작업은
  의도적으로 **take/skip만** 배포했다: ROADMAP 항목명이 페이지네이션만 지칭했고,
  `GetFilesDto`의 `search`/`sortBy`/`order` 표면([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md))을
  `GetUsersDto`에 미러링하지 않았다. **재검토 트리거**: Stage 5의 "이식된 `admin/` 콘솔 적응"
  행 — 이식된 사용자 목록 화면(`ADR 0022` 백로그: `GET /user?page&take&sort&sortBy&search&status`)이
  email이나 역할로 필터/정렬하길 원할 텐데, 오늘의 `GetUsersDto`에는 그 필드가 없다. 그 필요가
  실제로 드러나면 두 번째 조회 계층 패턴을 새로 만들지 말고 `GetFilesDto`가 이미 쓰는
  `search`/`sortBy`/`order` 형태(email `ILIKE`, `FILE_SORT_FIELDS`와 같은 방식으로 키를 둔
  `USER_SORT_FIELDS` 튜플)로 `GetUsersDto`를 확장한다 — 페이지네이션 작업과 마찬가지로 별도
  ADR 불필요. 자체 작업으로 일정 배정하지 않는다: 페이지네이션처럼 독립된 부채가 아니라
  Stage 5의 콘솔-적응 행에서 나올 법한 확장 항목이다. 트리거는 도달했지만 필요는
  2026-08-06 시점엔 드러나지 않았다 — 콘솔 적응이 이것 없이 착지했고, `GetUsersDto`와
  정확히 일치시켰다. **2026-08-12 해소**: 결국 필요가 드러났다 — `GetUsersDto`가
  `search`(email `ILIKE`)와 `sortBy`/`order`(`id`/`email`/`createdAt`, `role`은 제외)를
  얻었고, 같은 변경에서 `users-page.tsx`도 검색창과 정렬 가능한 ID/Email/Created 헤더를
  얻었다(`admin/README.md` > "무엇을 적응시켰는가"). `status` 필터는 서버에 여전히 없어서
  이식본 원래 화면의 그 부분은 여전히 범위 밖이다
- ~~`GET /audit-log`에 `userId` 필터가 없다~~ (2026-08-06 발견, 위 Stage 5 콘솔 적응 행 도중) —
  이식된 사용자 페이지 상세 패널이 사용자별 "최근 활동" 조각을 위해
  `GET /audit-log?userId=…`를 호출했지만, `AuditLogQueryDto`는 `action`만 필터한다.
  그 시점 콘솔 자체에 대한 해결책: 패널 절을 **근사하지 않고 제거했다** — 필터 없는
  페이지를 가져와 클라이언트에서 걸러내면 사용자의 오래된 항목이 그 페이지 밖으로 밀려날
  때 조용히 빠지는데, 이는 조각을 아예 보여주지 않는 것보다 나쁘다
  (`admin/README.md` > "이번 적응에서 내린 두 가지 결정"). **2026-08-12 해소**:
  `AuditLogQueryDto`가 계획대로 기존 `action` 필터 형태를 그대로 따라 `userId`를
  얻었다(별도 ADR 불필요). 같은 변경이 제거됐던 패널을 정확한
  `GET /audit-log?userId={id}&take=5` 호출로 복원했고, `logs-page.tsx`도 "View all" 링크를
  위해 자신의 URL에서 `?userId=`를 읽도록 연결했다(`admin/README.md` > "이번 적응에서 내린
  두 가지 결정" 및 "열린 사항").
  **2026-08-24 정정**([ADR 0045](ADR/0045-audit-log-target-type.ko.md)): "actor 또는 target과
  일치"는 지나치게 넓은 서술이었다 — `targetId`는 다형이라 판별자 없이 매칭하면 id가 유저
  id와 충돌하는 파일·게시글·댓글 기록까지 반환됐다(개발 DB 114행 중 62행). 이제 이 필터의
  의미는 "행위자이거나, 유저를 대상으로 하는 action의 대상"이며, 새 `targetType` 컬럼이
  이를 강제한다
- ~~게시글 상세/댓글 UI가 한국어로 하드코딩됨~~(2026-08-13, 게시글/댓글 보드를
  브라우저로 직접 조작하는 QA 도중 발견 — 전체 기록은 CHANGELOG > 알려진 문제/수정) —
  **2026-08-15 해소**: `PostDetailPage.tsx`, `CommentThread.tsx`, `CommentForm.tsx`,
  그리고 수정 도중 같은 결함 종류로 추가 발견한 `PostForm.tsx`의 한국어 사용자 노출
  문구를 전부 영어로 교체 — `UploadForm.tsx`/`FileDetailPage.tsx`가 이미 쓰던 표현을
  따랐다. 옛 한국어 문구를 assertion으로 쓰던 `frontend/e2e/*` 두 곳도 갱신. 순수
  문자열 교체 — 설계 판단도, ADR도, 백엔드 변경도 없음.
- 프론트엔드 스타일 전면 개편(CSS Modules + 브랜드 팔레트 + 명시적 다크/라이트 토글) —
  **2026-08-14 결정과 동시에 전부 랜딩**. 헤드리스 Playwright 스크린샷 + 헤드풀 점검으로
  구성된 라이브 UI/UX 점검에서 모든 화면이 디자인 시스템 없이 인라인 `style={{}}`로만
  스타일링돼 있다는 사실이 드러났다. 비교표 기반 Q&A 패스로 CSS Modules(신규 의존성
  없음 — Vite가 `*.module.css`를 기본 내장 지원해 frontend/CLAUDE.md의 "CSS 프레임워크
  도입 전 제안 필요" 조건에 걸리지 않음), 브랜드 지향 방향 + 명시적 토글(기존
  `prefers-color-scheme` OS 전용 방식을 넘어섬), 전체 5개 라우트 페이지 + `NavBar`
  적용 범위를 확정했다. 결정 전체 기록, 확정된 브랜드 퍼플 토큰 표, 페이지별 작업
  목록은 `frontend/docs/STYLE-PLAN.md`(+ `.ko.md`)에 있다. 7개 항목 전부 같은 날
  랜딩: 토큰 기반 + `ThemeProvider`/토글 + `NavBar`; `LoginPage`; 파일 게시판
  (`DashboardPage`+`FileBoard`+`UploadForm`); `FileDetailPage`+`VisibilityBadge`(오래된
  파일 상세 제목 겹침 버그 수정과 함께 처리 — 근본 원인은 전역 `h1` 규칙에
  `line-height`가 없던 것); 게시글 게시판(`PostBoard`+`PostForm`+`FilePicker`); 마지막으로
  `PostDetailPage`+`CommentThread`+`CommentForm`(제목 버그 수정으로 불필요해진 스코프
  인라인 `lineHeight` 임시 조치도 이때 함께 제거). 같은 점검에서 드러났지만 의도적으로
  포함하지 않아 여전히 열려 있는 항목 2건: 영상 재생을 막는 S3 CORS 문제(AWS 버킷 설정,
  소스 코드 문제 아님)와 위의 한글/영어 UI 문구 혼용 — 이번 스타일 작업은 전환한 세 파일
  전부에서 한글이든 영어든 하드코딩된 문자열을 발견한 그대로 두었다. 모든 전환은
  마크업/스타일 변경만 — API·DB·로직 변경 없음. 7개 항목 전체의 페이지별 상세는
  `CHANGELOG.md`의 `[Unreleased] > Added` 항목 참고.
- **S3 리다이렉트 private 파일 재생 실패, 원인 규명 (2026-08-15 발견)** — 위의 "S3
  CORS 문제" 항목과 ADR 0036 자체의 "`pnpm test:e2e`로 미검증" 잔여 사항은 별개가
  아니라 같은 결함이었다: 로컬 `STORAGE_DRIVER=s3` 환경에서 `pnpm test:e2e`를
  돌려보니(22개 중 21개 통과) 정확히 `frontend/e2e/detail.spec.ts:73` 한 건이
  실패했다 — `FileDetailPage.tsx`의 **private** 티어 재생 경로가 `fetch()`+Blob으로
  콘텐츠를 직접 가져오는데(`<video>` 태그는 `Bearer` 헤더를 실을 수 없음), 이 fetch가
  ADR 0036의 `302`를 따라 교차 출처 S3 URL로 리다이렉트되면 응답 본문을 읽는 데
  버킷에 없는 CORS 헤더가 필요하기 때문이다. `public`/`unlisted` 재생(평범한
  `<video src>`, JS가 본문을 읽지 않음)은 영향받지 않고 통과한다. 전체 추적 내용은
  ADR 0036 > "추가 기록 (2026-08-15)" 참고. 후보 해결책 두 가지를 기록만 해두고
  이 문서에서 확정하지 않는다 — 버킷 CORS 설정, 그리고/또는
  `detail.spec.ts:73`의 단언 갱신(CORS 여부와 무관하게 리다이렉트 체인의 잘못된
  구간을 검사하고 있음).
  **두 후보 해결책 모두 2026-08-16에 처리됐다.** 해결책 1: 버킷에는 CORS 규칙이
  하나도 설정돼 있지 않았다. 규칙 하나를 적용했고(`GET`만 허용, 이 백엔드 자체
  `CORS_ORIGIN`의 로컬 개발 origin 두 개로 한정) Playwright로 실제 재검증한
  결과 private 영상이 이제 소유자에게 진짜로 재생된다(`readyState: 4`, 실제
  크기, CORS 콘솔 에러 없음) — 단순 HTTP 상태 확인이 아니다. 해결책 2는 같은 날:
  `detail.spec.ts:73`의 단언이 리다이렉트 체인의 잘못된 구간(최종 응답이 아니라
  첫 번째 `302` 홉)을 검사하고 있어서, `STORAGE_DRIVER=s3`에서는 재생이 실제로
  되는지와 무관하게 절대 통과할 수 없었다 — `200`(local) 또는 `302`(s3) 둘 다
  허용하도록 완화하고, 실제 성공의 진짜 증거는 이미 있던
  `video[src^="blob:"]` 단언이 맡도록 했다. 두 드라이버 모두에서 5/5 통과를
  확인했다. 전체 기록: ADR 0036 > "추가 기록 (2026-08-16)". 이 항목에서 남은 것은
  없다.

## 8. Advisory 노트

작업 일정에는 반영하지 않되 판단에 참고할 기준: 개인정보/컴플라이언스(삭제 정책,
보관 기간), 릴리스/변경 관리(semver + 마이그레이션 순서), 문서 최신성 강제
(README/엔드포인트 일치의 자동 검증 — CI 작업 아래의 후보).

## 9. 완료

### 2026-08-27

| 항목 | 비고 |
|---|---|
| AWS 첫 실제 배포가 안정 상태에 도달함 | Helm 릴리스 `upload-board`(`k8s/helm/`)가 `cluster/`의 Terraform 상태로 프로비저닝된 실제 EKS 클러스터에서 `STATUS: deployed`(revision 5)에 도달했다(§7의 "적용 안 됨" 주장은 이미 2026-08-25에 정정됨 — 이번 건은 그 인프라 *위에* 앱이 올라간 것이지, 인프라 자체가 아니다). revision 1–4는 모두 실패했다: rev 1–3은 계정이 아직 Free Plan이던 동안의 파드 슬롯/아키텍처 불일치(Paid Plan 업그레이드와, `docker-publish` CI가 `dev`가 아닌 `main` push에만 반응하므로 수동으로 진행한 멀티아치 `docker buildx build --platform linux/amd64,linux/arm64` 푸시로 해결); rev 4는 실제 RDS 인스턴스를 상대로 마이그레이션 Job이 `no pg_hba.conf entry ... no encryption`로 실패했다(`rds.force_ssl`이 TLS를 요구하는데 앱이 요청하지 않고 있었음). `helm upgrade upload-board . --reuse-values --set env.DB_SSL=true`(rev 5)가 바로 이 문제를 위해 추가해둔 `DB_SSL` env var(커밋 `cf0cbfe`, Joi 스키마 + `.env.example` + `data-source.ts`)로 이를 해결했다 — 이제 마이그레이션 Job이 완료되고 앱 파드가 `Running`/ready 상태에 도달한다. 이어서 S3 접근을 연결했다: `default` ServiceAccount에 `app-infra`의 Terraform 출력 IAM 역할 ARN(`eks.amazonaws.com/role-arn=arn:aws:iam::074416822640:role/upload-board-project-app`)을 주석 처리하고 Deployment를 재시작해 반영했으며, 실행 중인 파드에 주입된 `AWS_ROLE_ARN`/`AWS_WEB_IDENTITY_TOKEN_FILE` env var와 projected `aws-iam-token` 볼륨으로 확인했다 — 릴리스의 `STORAGE_DRIVER=s3` 값이 이제 실제로 인증할 수 있지만, 실제 버킷을 상대로 한 엔드투엔드 업로드는 아직 검증되지 않았다. 아직은 클러스터 내부에서만 접근 가능하다(`ingress.enabled: false`, 차트 기본값) — 개발자는 외부 테스터가 실제로 필요해지기 전까지는 미리 `Ingress`를 켜지 않고 이 상태를 유지하기로 확정했다. 그 외 열려 있던 두 항목은 같은 날 해결됐다: `cluster/main.tf`의 graviton `t4g.medium` 노드 타입은 원래 계정이 업그레이드되기 전 파드 슬롯 제약을 우회하기 위한 임시값이었으나, 이제 개발자가 비용 효율(`m6g.large`의 더 넉넉한 파드 슬롯보다 우선)을 이유로 **영구 선택값**으로 확정했다(값 자체는 안 바뀌므로 `terraform apply` 불필요 — 주석만 현행화); `k8s/helm/values-prod.yaml`을 추가해 이번 배포의 `--set env.DB_SSL/STORAGE_DRIVER/S3_BUCKET/...` 플래그를 하나의 오버레이로 정리했다(`helm upgrade upload-board . -f values-prod.yaml`), `helm template`으로 실제 릴리스와 동일한 `ConfigMap`을 렌더링하는지 검증함. |

### 2026-08-06

| 항목 | 비고 |
|---|---|
| admin 콘솔 적응 (역할 관리 조각) | `admin/`의 이식된 Chat Project UI를 이 백엔드의 실제 라우트에 맞게 다시 썼다: 문자열 `UserRole`(기존 숫자였음), 액세스 토큰 클레임에서 역할을 읽음([ADR 0028](ADR/0028-access-token-role-claim.ko.md)), 이진 승격/강등 토글을 대체하는 3단계 역할 `<select>`, `{ code, message }`로 분기되는 `AUTH_LAST_SUPERADMIN`/`USER_HAS_FILES`/`USER_FILES_IN_USE`/`FORBIDDEN`([ADR 0011](ADR/0011-error-code-contract.ko.md)), `GetUsersDto`/`AuditLogQueryDto`와 정확히 일치하는 `take`/`skip` + `[data, total]` 튜플 읽기. 채팅 도메인 페이지(`rooms-page`, Apollo/`/graphql` 계층, ban/unban/force-logout)를 삭제하며 같은 변경에서 Stage 5의 모더레이션 존재 여부 행도 "아니오"로 결론지었다. 사용자별 감사 로그 패널은 당시엔 근사하지 않고 제거했다 — `GET /audit-log`에 `userId` 필터가 없다, 7절에 후속 항목으로 추적. 백엔드 파일은 건드리지 않았다 — Stage 5 네 번째 작업(전체 결함 목록: `admin/README.md` > "무엇을 적응시켰는가"). **2026-08-12 확장**: 7절 후속 항목이 착륙하면서 검색창, 정렬 가능한 헤더, 복원된 사용자별 "Recent activity" 패널, `logs-page.tsx`의 `?userId=` 필터링, 클라이언트 합성 CSV 내보내기가 추가됐다 — 전체 목록은 위 Stage 5 표의 해당 행 참고 |
| 중복 admin 화면 정리 — **Stage 5 완료** | 위 적응 작업이 ADR 0022가 미뤄뒀던 질문에 답했다: 이식본은 "대부분 삭제 가능"하지 않았다(삭제 가능했던 건 채팅 도메인 잔재뿐, 역할 관리 본체는 깔끔하게 적응됐다) — 그래서 `admin/`이 유일한 admin 화면이다. `frontend/src/features/admin/AdminPage.tsx`(백엔드 호출이 전혀 없는 17줄짜리 stub, ADR 0010이 예약해 둘 때와 동일한 상태)와 `frontend/src/App.tsx`의 `/admin` 라우트+import를 삭제했다. [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)의 admin 배치 조항을 한 번 더 개정한다 — admin은 이제 `frontend/` 안의 라우트 구역조차 아니다. [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)의 2026-08-06 추가 기록에 남겼다. **Stage 5의 네 행이 모두 끝났다 — 남은 작업은 Stage 4(인프라 도입 후 배포)다.** |

### 2026-07-30

| 항목 | 비고 |
|---|---|
| 목록 검색/필터/정렬 | `GET /file`에 선택적 파라미터 네 개가 추가됐다 — `search`(제목 `ILIKE '%term%'`, LIKE 메타문자 이스케이프, 100자 이하), `creatorId`(이미 있는 creator join 활용), 그리고 완전한 `Record<FileSortField, string>`로 컬럼에 매핑되는 `sortBy`/`order` — 덕분에 클라이언트 문자열이 컬럼명이 되는 일이 없다. 기본 정렬은 `createdAt DESC` + `file.id` tiebreaker다. 이 엔드포인트에는 **`ORDER BY`가 아예 없어** offset 페이징이 비결정적이었다. 응답 형태 불변, 신규 에러 코드 없음(잘못된 값은 경계 파이프가 `VALIDATION_FAILED`로 거절), 스키마 변경 없음. `createdAt`/`pg_trgm`/`creatorId` 인덱스는 도입 계기를 기록한 채 유보 — **Stage 3 첫 작업** ([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)) |
| 게시판 도메인 스키마 설계 | 설계 게이트 전용 — 게시판 엔티티 **둘**을 한 번에 평문으로 기술했고, 코드도 마이그레이션도 없다. post ↔ file은 1:1·선택적·동일 작성자이며 unique·nullable FK가 `POST /post`의 idempotency 키를 겸한다(동일 재전송은 200 replay, 내용이 다르면 409 `POST_FILE_TAKEN`). 댓글은 평면 구조이고 대댓글은 가산적 마이그레이션으로 유보했다. `comment.postId`가 이 스키마의 **유일한** `ON DELETE CASCADE`이며, ADR 0020의 서비스 연쇄 규칙에 대해 당연시하지 않고 근거를 밝혔다. 첨부된 파일에 대한 `DELETE /file/:id`는 `23503`을 번역해 409 `FILE_IN_USE`가 된다(사전 검사는 `File ↔ Post` 모듈 순환을 만들고 경합도 남긴다). ADR 0020 계정 연쇄 삭제는 글과 댓글을 흡수하되 `deleteFiles=true`는 계속 파일만 지킨다. 소유권은 세 번째 축 없이 `canManage` 그대로이고, post 목록은 ADR 0021 조회 계층을 물려받는다 — **Stage 3 두 번째 작업** ([ADR 0023](ADR/0023-board-domain-schema.ko.md)) |
| 삭제 정책 설계 | soft delete는 근거를 남기고 기각했으며 삭제는 hard delete로 유지한다. `DELETE /user/:id?deleteFiles=true`는 파일 행 → 계정 행 → 물리 파일 순으로 연쇄 삭제하고(unlink는 커밋 이후), 확인 없이 파일 보유 계정을 지우려 하면 개수를 담은 신규 409 `USER_HAS_FILES`로 거절한다. `deleteFiles`를 boolean이 아닌 검증된 문자열 리터럴로 받은 이유는 암묵 Boolean 변환이 `"false"`를 `true`로 바꾸는 것이 실측으로 확인됐기 때문이다. 이번 과제에서 발견한 누수를 닫아 `DELETE /file/:id`도 저장된 `granted_` 파일을 unlink한다. 스키마 변경 없음 — **Stage 2 세 번째 작업이자 Stage 2 완결** ([ADR 0020](ADR/0020-account-deletion-cascade.ko.md)) |

### 2026-07-27

| 항목 | 비고 |
|---|---|
| 업로드 중복 제출 정책 | attach가 발급한 파일명이 1회용 청구 토큰이다. 재제출 시 청구자 본인에게는 기존 파일을 replay(200)하고, 타인에게는 409 `FILE_ALREADY_CLAIMED`, 뒤를 받쳐 줄 temp 파일이 없으면 400 `FILE_INVALID_PATH`를 낸다. 동시 제출 경합은 500이 아니라 unique 제약으로 정리된다. `UploadFileDto.filePath`를 발급 형식으로 고정해 경로 탈출 공백도 닫았고, 스키마 변경은 없다 — **Stage 2 두 번째 작업** ([ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)) |

### 2026-07-26

| 항목 | 비고 |
|---|---|
| 고아 temp 파일 정리 | 신규 운영 모듈 `TempCleanupModule`의 스케줄 `@nestjs/schedule` 스윕이 TTL(`TEMP_SWEEP_TTL_HOURS`, 기본 24시간; 매시간 cron)을 넘어 `file/temp`에 남은 `temp_` 파일을 삭제한다. `granted_`/`file/upload`는 건드리지 않으며, dry-run·활성 토글 제공, `cron`은 direct 의존성으로 승격 — **Stage 2 첫 작업** ([ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)) |

### 2026-07-25

| 항목 | 비고 |
|---|---|
| RBAC + 감사 로그 | `user`/`admin`/`superadmin` 역할, RolesGuard/@Roles, 소유권 "본인 또는 admin", superadmin 전용 `PATCH /user/:id/role`(마지막 superadmin 방지 + 세션 무효화), append-only 감사 로그와 `GET /audit-log`, `SUPERADMIN_EMAIL` 시드 — **Stage 0 완결** ([ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)) |

### 2026-07-23

| 항목 | 비고 |
|---|---|
| 전체 로드맵 계획 수립 | 11축 결정 검토; 이 문서가 그 기록 |
| 프론트엔드 분리 결정 + Stage F 파이프라인 | 저장소 내 `frontend/` 하위 폴더(구조 2026-07-24 개정), admin은 `/admin` 라우트, 계약 동결; RBAC은 Stage F 뒤로 재배치 ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)) |
| 라우트 정리 및 API 계약 동결 | `POST /file`, `PATCH /file/:id`, `DELETE /file/:id`, `POST /auth/token/refresh` — 소비자 0명 상태에서 표면 동결 (Stage F 작업 1) |
| 에러 코드 계약 | 동결된 `ErrorBody` 형태 + 18개 코드 카탈로그 + `APP_FILTER`로 등록한 전역 `AllExceptionsFilter` (Stage F 작업 2, [ADR 0011](ADR/0011-error-code-contract.ko.md)) |

### 2026-07-24

| 항목 | 비고 |
|---|---|
| Refresh 토큰 httpOnly 쿠키 + 회전/재사용 감지 | `refreshTokenHash` 앵커 컬럼, `SameSite=Strict` 쿠키, `POST /auth/signout` 신설; Stage F 작업 3 — **Stage F 완결** ([ADR 0012](ADR/0012-refresh-cookie-rotation.ko.md)) |

### 2026-07-22

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
| TypeORM 마이그레이션 도입 | `migration:*` 스크립트, `backend/data-source.ts`, 베이스라인 `InitialSchema`; 기존 DB는 `pnpm migration:run -- --fake` 1회 ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)) |
