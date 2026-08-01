# 로드맵

> English version: [ROADMAP.md](ROADMAP.md)

Upload Board Project의 전체 계획서. 2026-07-23에 11개 축(본질 → 방법론 → 설계
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
전용 작업으로 진행한다 ([CLAUDE.md](CLAUDE.md) > Scope Discipline).

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
  ~~#1 게시판 comment 모듈~~(✅ 2026-07-31 완료) → **#2 `GET /user` 페이지네이션 — 이제 다음
  차례**(Stage 5에서 앞당김) →
  #3 Stage 5 admin 화면 → #4 Stage 4 배포(마지막). 이로써 Stage 5의 부동 위치가
  Stage 4 앞으로 확정되고, 독립적인 페이지네이션 부채가 둘보다 앞으로 당겨진다.
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
  받으며, 각각 자신만의 클래스 허용 목록을 가진다. 스키마 변경은 없다. **새
  `fileUrl`/`visibility` 응답 형태와 분리된 업로드 필드 모두에 대한 프론트엔드 반영은 여전히
  별도로 추적되는 과제다
  (아래 미배정 참고).

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
  작업이다 — [CLAUDE.md](CLAUDE.md) > Scope Discipline의 로드맵 차원 재서술이다.
  묶음 처리도, 부수 작업도 없다.
- 6절의 단계(Stage)는 **의존 순서에 따른 묶음일 뿐 마일스톤이 아니다**: 진행은
  항목 단위로 이뤄지며, 단계 경계를 넘는 데 별도의 의식은 없다.

## 3. 설계 기준

**동결 (변경 없음)** — 기존 3축, [CLAUDE.md](CLAUDE.md)의 Never Do 그룹 1–3:
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
- **향후 목표 (2026-07-23 결정)**: **스토리지 포트-어댑터** — 물리 파일 조작을
  `FileStorage` 인터페이스로 분리해, Stage 4에서 필요해질 때 로컬 디스크
  구현([ADR 0005](ADR/0005-local-disk-storage.ko.md))을 클라우드 스토리지(S3)로
  교체할 수 있게 한다. 착수 시 ADR 0005 재검토와, ISP 규약("실제 두 번째 구현체가
  생기기 전에는 서비스 인터페이스 계층 금지")을 Principle Conflict Protocol로
  통과시키는 절차가 필요하다.
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
  Range 지원)가 강제한다. 프론트엔드는 아직 이를 반영하지 않았다 — 여전히 옛 정적
  `fileUrl` 형태를 읽는다 — 그래서 *프론트엔드*가 우회해야 하는 제약은 그 과제가 랜딩할
  때까지 그대로다(아래 미배정 참고).
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
  ([CLAUDE.md](CLAUDE.md) > Scope Discipline의 스키마 변경 규약에 따라) 먼저 평문으로
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

### 남은 작업의 실행 순번 (2026-07-31 결정)

아래 단계들은 의존 관계로 묶여 있지만, 준비된 항목 몇 개가 단계를 가로질러 있어
실제 착수 순서를 여기서 고정한다(완결된 단계는 생략). 각 미완 항목은 자기 행에
실행 번호를 함께 표기한다.

1. ~~**게시판 도메인 — comment 모듈** (Stage 3)~~ — ✅ 2026-07-31 완료, **Stage 3 완결**.
   게이트였던 post↔file 불변식 gap을 [ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)로
   먼저 정리했고 계정 연쇄의 삭제 순서를 건드리지 않았으므로, 댓글 삭제가 게시글 앞에
   그대로 끼워 넣어졌다. **이제 실행 #2가 다음 전용 작업이다.**
2. **`GET /user` 페이지네이션** (Stage 5에서 앞당김) — 콘솔과 무관하게 갚아야 할
   독립적인 Never Do Group 2 부채이며, admin 사용자 목록이 필요로 할 조회 계층의
   선행이기도 해서 조기 빠른수정으로 당긴다.
3. **Stage 5 — 운영 화면 (admin 콘솔)**, **Stage 4보다 앞에** 배치: 역할 전달 결정
   (나머지를 막음) → 이식 콘솔 적응 → 모더레이션 존재 여부 결정 → 중복 admin 화면
   정리. 근거(Stage 5 노트에 이미 기록): 권한 계층을 Swagger로만 운영할 수 있는 배포
   시스템은 운영이 어려우므로, 운영 화면을 배포보다 앞세운다.
4. **Stage 4 — 실서비스 전환 (배포)**, **마지막**으로 배치: AWS 배포 → 컨테이너·배포
   하드닝 → VOD 접근 제어 → 스토리지 포트-어댑터(조건부) → 성능/용량 기준.

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

### Stage 4 — 실서비스 전환 — 실행 순번상 **마지막** (2026-07-31)

배포는 게시판 도메인, 페이지네이션 부채, Stage 5 admin 화면 이후에 온다(위 실행 순번
참조). 아래 행들은 각자의 내부 의존 순서를 그대로 유지한다.

| 작업 | 근거 / 의존성 |
|---|---|
| AWS 컨테이너 배포 | 로컬: Docker(compose), 배포: AWS — 컨테이너 기반. 신규 배포 ADR 필요; Stage 1의 Docker + CI에 의존. |
| 컨테이너·배포 하드닝 | [ADR 0015](ADR/0015-docker-and-compose.ko.md)에서 드러난 항목: Stage 1 이미지는 배포 *가능*하지만 프로덕션 급은 아니다. 비루트 `USER`(현재 root 실행), distroless 런타임 베이스(셸/apt 공격 표면 제거), 헬스/레디니스 엔드포인트(LB·오케스트레이터 프로브용), 컨테이너 부팅이 아니라 **별도 배포 단계로 분리한 마이그레이션**(다중 인스턴스 마이그레이션 경합 회피), `.env`/`env_file` 대신 시크릿 매니저, HTTPS 종단(`ENV=prod`에서 `Secure` refresh 쿠키에 필요), 타깃 아키텍처 빌드(현재 x64 프리빌드 `bcrypt`; ARM/Graviton은 맞는 프리빌드나 `pnpm.onlyBuiltDependencies` 필요). AWS 배포 작업에 의존. |
| ~~파일 가시성·접근 제어 서빙~~ **(2026-08-01 구현, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md) D1/D2/D3/D6 + [ADR 0026](ADR/0026-file-visibility-implementation.ko.md); 기존 "VOD 재생 접근 제어" 행을 일반화)** | 업로드된 파일은 예전엔 단순 공개 URL이었다 — 링크만 알면 누구나 봤다. `FileEntity`는 이제 3-상태 `visibility`(공개/비공개/**링크공유**, 회전 가능한 공유 토큰 + 선택적 TTL)를 가지며, `GET /file/:id/content`가 유일한 접근 제어 읽기 경로(Range 지원)이고, `ServeStaticModule`은 더 이상 `file/upload`를 노출하지 않는다. [ADR 0005](ADR/0005-local-disk-storage.ko.md)(서빙)를 부분 개정한다. **새 `fileUrl`/`visibility` 형태에 대한 프론트엔드 반영은 여전히 미착수** — 아래 미배정 참고. |
| ~~미디어 타입 확장 (이미지/오디오, 타입별 업로드 필드)~~ **(2026-08-01 구현, [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md) D4/D5 + [ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md) — 2026-08-01에 위 행에서 분리)** | `POST /upload/attach`는 이제 `image`(jpg/jpeg/png/webp), `audio`(mp3), `video`(mp4/mov/webm, 변경 없음) 세 타입별 필드를 받으며 각각 자신만의 허용 목록을 가진다 — 단일 `video` 필드를 대체했다. [ADR 0003](ADR/0003-two-phase-upload-contract.ko.md)/[ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)(업로드 필드, 살아 있는 프론트엔드에 대한 breaking 변경)을 개정한다. 스키마 변경은 없다. **새 업로드 필드에 대한 프론트엔드 반영은 여전히 미착수** — 아래 미배정 참고. |
| 스토리지 포트-어댑터 | S3 필요가 확정될 때만 — 아키텍처 방향(4절) 참조. |
| 성능/용량 기준 적용 | 인덱스 정책, 응답시간 목표, 디스크 상한 — 최적화 전에 측정부터. |

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
빠른수정으로 실행 #2에 빼냈다.

| 작업 | 근거 / 의존성 |
|---|---|
| **클라이언트가 사용자 역할을 어떻게 아는가** (백엔드 결정 — **이 단계의 나머지를 막는다**) | 액세스 토큰 페이로드는 `{ sub, type }`이며 `role` 클레임이 의도적으로 **없다**([ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)). 그래서 클라이언트는 지금 자기 역할을 알 수 없는데, admin UI는 라우트 게이팅에 그것이 필요하다. 결정할 두 형태: 액세스 토큰에 `role` 클레임 추가(빠르지만 강등보다 오래 사는 토큰에 인가 사실을 싣는 셈 — 다만 `updateRole`이 이미 `refreshTokenHash`를 null로 만들어 그 창을 제한한다), 또는 요청 기반 조회(`GET /user/:id`, 혹은 신규 `GET /auth/me`). ADR 0002를 개정하는 자체 ADR이 필요하다. 이식된 콘솔은 현재 그 클레임이 있다고 가정하므로 모든 admin을 거부한다. |
| 이식된 `admin/` 콘솔 적응 | [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)의 이식본을 Chat Project API에서 이 API로 다시 쓴다. 그 ADR의 검증된 백로그가 작업 지시서다. **역할 관리 조각부터 시작한다** — `PATCH /user/:id/role`, `GET /user`, `GET /user/:id`, `DELETE /user/:id`, `GET /audit-log`, `POST /auth/signin`은 이미 맞는 라우트이고 등급 값 `0/1/2`도 이미 `ROLE_RANK`와 일치하므로, 그 부분은 재설계가 아니라 라우트 수준 교정이다. 채팅 도메인 페이지(`rooms-page`, 접속/닉네임 위젯)와 Apollo/`/graphql` 계층 전체는 삭제다. 위 행에 의존. |
| `GET /user` 페이지네이션 **(실행 #2 — Stage 5에서 앞당김, 2026-07-31)** | admin 사용자 목록에 필요하고, 이 엔드포인트는 현재 `@Query()`를 **전혀 바인딩하지 않는다** — `findAll()`이 전체 사용자에 대한 `findAndCount()`를 반환한다. 이는 이 프로젝트 자체 페이지네이션 규칙([CLAUDE.md](CLAUDE.md) > Never Do Group 2)을 상시 위반하는 상태이므로, 콘솔과 무관하게도 갚아야 할 빚이다 — 그래서 Stage 5 나머지보다 앞으로 당겨 조기 빠른수정으로 처리한다. 두 번째 패턴을 만들지 말고 `GetFilesDto` / [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)의 조회 계층 패턴을 확장한다. |
| 중복된 admin 화면 정리 | 둘 중 지는 쪽을 삭제한다: `frontend/src/features/admin/AdminPage.tsx`(ADR 0010의 라우트 구역) 또는 독립 `admin/` 앱(ADR 0022). 이 단계 **이전이 아니라 진행 중에** 결정하도록 의도했다 — 이식본이 적응 후 얼마나 살아남는지가 그 선택의 입력값이다. 7절에 미결 사항으로 추적한다. |
| 모더레이션 기능을 둘 것인지 결정 | 이식본은 `POST /user/:id/ban`, `/unban`, `/force-logout`을 호출하고, 이 프로젝트가 **절대 기록하지 않는** 감사 액션(`USER_BANNED`, `USER_MUTED`, `USER_UNBAN`, `FORCE_LOGOUT`)에 색을 지정한다 — `AUDIT_ACTIONS`는 정확히 `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE`다. 기본 답은 "두지 않는다": 영상 업로드 게시판에 명시된 모더레이션 요구사항이 없으므로 삭제한다(YAGNI). 그중 하나라도 만드는 것은 자체 ADR이 필요한 신규 백엔드 표면이며, UI 적응의 부수 효과로 끼워 넣을 일이 아니다. |

## 7. 미일정 / 미결 사항

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
  않다. 백엔드 변경은 저장소 경계에서 의도적으로 멈췄다([CLAUDE.md](CLAUDE.md) >
  Project Overview: `frontend/`는 자체 CLAUDE.md와 툴체인을 가지며, 백엔드 작업에서
  프론트엔드 파일을 편집하지 않는다).
- 삭제 계약의 프론트엔드 반영 (2026-07-30 기록,
  [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)) — 위의 청구 계약 항목과 마찬가지로
  **백엔드 작업이 아니라 프론트엔드 전용 과제가 담당한다.** `DELETE /user/:id`는 파일을
  보유한 계정에 대해 `?deleteFiles=true`를 요구하고, 없으면 409 `USER_HAS_FILES`(메시지에
  개수 포함)를 낸다. 경고 다이얼로그, 확인 후 재요청, 409 분기는 모두 `frontend/`의 몫이다.
  `frontend/docs/API-CONTRACT.md`와 계정 삭제 흐름을 함께 갱신해야 하며, 그전까지 프론트엔드
  에는 확인을 통과시킬 경로가 없다. 백엔드 변경은 저장소 경계에서 멈췄다
  ([CLAUDE.md](CLAUDE.md) > Project Overview).
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
  그대로 얻는다. 백엔드 변경은 저장소 경계에서 멈췄다([CLAUDE.md](CLAUDE.md) > Project Overview).
- 파일 가시성 + 미디어 확장의 프론트엔드 반영 (2026-07-31 기록,
  [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md); 두 절반 모두
  **2026-08-01 백엔드에서 착지** — 가시성은 [ADR 0026](ADR/0026-file-visibility-implementation.ko.md),
  미디어 타입 확장은 [ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md)) —
  위 청구·삭제·목록 조회 계약 항목과 마찬가지로 **백엔드 작업이 아니라 프론트엔드 전용
  과제가 담당한다.** 단 이건 additive가 아니라 **살아 있는 프론트엔드에 대한 breaking
  변경**이라 더 크다. 2026-08-01 기준으로 파일 접근은 이미 `GET /file/:id/content`로
  옮겨갔고 `FileResponseDto`에 `visibility` + (소유자에게만) `shareUrl`이 추가됐다 —
  프론트엔드는 아직 옛 정적 `fileUrl` 형태를 읽고 있고 가시성을 전혀 토글할 수 없으므로,
  이는 이제 미래가 아니라 현재의 공백이다. 업로드 필드 분리(단일 `video` →
  `image`/`audio`/`video`)도 2026-08-01에 백엔드에서 착지해서(ADR 0025 D4/D5), 이제
  breaking 변경의 두 절반 모두 프론트엔드가 아직 반영하지 않은 API 위에 살아 있다.
  `frontend/docs/API-CONTRACT.md`, 업로드 폼, 파일 목록, 재생/열람 화면이 모두 이를
  받아들여야 한다(가시성 토글, 공유 링크 복사, 세 업로드 필드). 백엔드 변경은
  저장소 경계에서 멈춘다([CLAUDE.md](CLAUDE.md) > Project Overview).
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
- 어느 admin 화면이 살아남는가 (2026-07-30 기록,
  [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)) — **미결 사항**이며, 작업이
  스케줄된 뒤에도 그대로 미결이다:
  [Stage 5](#stage-5--운영-화면-admin-콘솔--2026-07-30-추가)의 네 번째 행으로, 그 단계 이전이
  아니라 **진행 중에** 정한다. 지금 admin 화면이 두 개 공존한다:
  `frontend/src/features/admin/AdminPage.tsx`(ADR 0022가 개정한 admin 배치 조항에 따라
  [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)이 명세했던 `/admin` 라우트
  구역)과 이식된 독립 `admin/` 앱. 지금 정하는 것은 추측이다 — 이식본이 적응 후 얼마나
  살아남는지가 그 선택의 입력값이다. 대부분 버려야 한다는 결론이 나오면 ADR 0010의 원래 라우트
  구역 계획이 더 나은 길이고, 이 항목은 그쪽으로 되돌아간다.
- 문서 문구 동기화 (2026-07-23 유예 결정; 2026-07-29 완료): 계획 수립 이전의
  "후보(candidate)" 표현을 이 계획에 맞춰 정리. ADR 0003("candidate roadmap
  item")은 이제 반영된 [ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)을 가리키고,
  ADR 0006 Consequences("top roadmap item")에는 날짜 병기 완료 주석이 붙었으며,
  `CHAT-REMNANT-REMOVAL-PLAN`("ROADMAP's CI candidate")은 이제 착지된 Stage 1
  CI([ADR 0016](ADR/0016-github-actions-ci.ko.md))를 가리킴. **완료.**

## 8. Advisory 노트

작업 일정에는 반영하지 않되 판단에 참고할 기준: 개인정보/컴플라이언스(삭제 정책,
보관 기간), 릴리스/변경 관리(semver + 마이그레이션 순서), 문서 최신성 강제
(README/엔드포인트 일치의 자동 검증 — CI 작업 아래의 후보).

## 9. 완료

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
