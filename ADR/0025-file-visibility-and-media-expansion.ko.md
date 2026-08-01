# ADR 0025: 파일 가시성, 접근 제어 서빙, 미디어 타입 확장

- Status: Accepted — 구현 완료 ([ADR 0026](0026-file-visibility-implementation.ko.md)가
  D1/D2/D3/D6을, [ADR 0027](0027-media-type-expansion-implementation.ko.md)이 D4/D5를 구현)
- Date: 2026-07-31 (설계 게이트); 구현은 2026-08-01에 착지
- English: [0025-file-visibility-and-media-expansion.md](0025-file-visibility-and-media-expansion.md)

## Context

2026-07-31에 이 프로젝트의 네 가지 창립 목표를 다시 정리하면서, 의도와 실제
코드 사이의 공백 두 개가 드러났다:

1. **파일 업로드** — 구현됨.
2. **가입·로그인한 유저는 누구나 업로드 / 삭제 / 링크 공유 가능** — 구현됨
   (삭제는 [ADR 0013](0013-rbac-and-audit-log.ko.md)에 따라 작성자 또는 admin+;
   오늘의 공유 "링크"는 공개 URL이다).
3. **유저가 업로드한 파일을 비공개/공개로 전환** — **없음.** `FileEntity`에
   가시성 컬럼이 없고, 저장된 모든 파일은 공개로 서빙된다.
4. **업로드 허용 타입은 사진·영상·mp3·mp4, 100 MB 이내** — **부분적으로
   없음.** 허용 목록이 영상 전용(`mp4`/`mov`/`webm`)이라 이미지·오디오는 거부되고,
   단일 multipart 필드명은 `video`다.

어려운 지점은 목표 3이다. 지금은 `ServeStaticModule`이 `file/` 디렉터리 전체를
`/file`로 서빙하고([ADR 0005](0005-local-disk-storage.ko.md)), 공개 URL은
`{BASE_URL}/{filePath}`로 조합된다. 이 모델에는 **파일별 인가가 없다** — `granted_`
경로를 알거나 추측하는 누구나 바이트를 읽는다. 따라서 파일을 비공개로 만드는 것은
컬럼 하나로 끝나지 않고, 서빙 방식 자체를 바꿔야 한다. 이는 [ROADMAP.ko.md](../ROADMAP.ko.md)
Stage 4가 "VOD 재생 접근 제어"로 미뤄 둔 바로 그 사안이며, 영상에서 전체 미디어로
일반화해 전용 과제로 앞당긴 것이다.

Stage F 이후 바뀐 제약이 하나 더 있다: API 표면은 **소비자 0명** 상태에서
동결됐지만([ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md)), 이제
`frontend/` 하위 폴더가 이 API를 소비한다. 따라서 아래 업로드 필드 변경은 Stage F의
리네임과 달리 **살아 있는 소비자에 대한 breaking 변경**이며, 그 프론트엔드 반영은
저장소 간 미결 결정으로 추적한다.

이 ADR은 마이그레이션이나 코드에 앞서 Scope Discipline이 요구하는 평문 설계
게이트다 — *무엇을·왜*를 정하고, 줄 단위 *어떻게*는 정하지 않는다. 구현은 검토된
마이그레이션과 함께 별도 후속 과제로 진행한다.

## Decision

### D1 — 3-상태 가시성, 기본은 비공개

`FileEntity`에 `visibility` 컬럼을 추가한다: enum `'public' | 'private' | 'unlisted'`,
**기본값 `'private'`**(secure by default). 의미:

- **public** — 누구나, 인증 불필요.
- **private** — 파일 작성자(또는 `canManage` 기준 admin+)만.
- **unlisted** — 그 파일의 현재 공유 토큰을 가진 누구나, **미인증·미가입 방문자
  포함.** 목표 2의 "링크 공유"가 이것이다.

기본 비공개란 새 업로드가 소유자가 `public` 또는 `unlisted`로 전환하기 전까지 닿을
수 없다는 뜻이다. 가시성은 새 인가 축이 아니라 기존 소유자 가드가 걸린 쓰기 경로
(`PATCH /file/:id`)로 전환한다.

### D2 — 모든 업로드 바이트는 접근 제어 엔드포인트로 서빙한다

신규 `GET /file/:id/content`가 `visibility` 기준 접근 검사 **후에** 저장 파일을
스트리밍한다:

- public → 누구에게나 서빙;
- private → subject가 작성자(또는 admin+)인 JWT 요구;
- unlisted → 일치하는 공유 토큰 요구, `GET /file/:id/content?share=<token>`,
  **로그인 불필요.**

**`ServeStaticModule`은 `file/upload` 노출을 중단해야 한다.** 유지하면 D1이
무력화된다 — 비공개 파일의 바이트가 여전히 `granted_` 경로에 있고 정적 서빙이 그것을
URL로 내주기 때문이다. 따라서 granted 파일 읽기는 엔드포인트로 보내 `visibility`를
강제하며, "public"은 그저 엔드포인트가 검사를 건너뛰는 상태다.

**미결 하위 결정 — 여기서 정하지 않으며, 구현 시 작성자가 정한다.** 진짜 공개 파일을
성능을 위해 별도의 진짜 공개 정적 디렉터리로 *추가* 서빙할지, 아니면 **모든** granted
읽기를 엔드포인트로 보낼지는 구현 과제가 정하도록 의도적으로 열어 둔다 — Scope Discipline과
Clarification Protocol에 따른다(새 서빙 메커니즘은 착수 전 질의 대상이다). 아래 권고는
논의의 출발점이지 **확정된 결정이 아니다**: 전 파일을 단일 엔드포인트로 보내는 쪽이 더
단순하고 접근 제어 경로가 하나뿐이며 공개 파일 사본을 두 곳에 동기화할 필요도 없다 — 다만
과제 착수 시 작성자가 정한다. 여기서 *확정된* 것은 계약 수준 불변식뿐이다: `file/upload`는
더 이상 정적으로 노출되지 않고, 접근은 엔드포인트가 강제한다.

이는 [ADR 0005](0005-local-disk-storage.ko.md)의 **부분 개정**이다: 로컬 디스크 저장과
`temp_`/`granted_` 2단계 승격([ADR 0003](0003-two-phase-upload-contract.ko.md))은
유지하고, `file/upload`의 *서빙* 방식만 바꾼다.

### D3 — 공유 토큰: 무작위, 회전 가능, 선택적 TTL

`FileEntity`에 nullable `shareToken`(서버 생성 무작위 불투명 문자열, 추측 가능한 id가
아님)과 nullable `shareExpiresAt` 타임스탬프를 추가한다.

- 토큰은 파일을 `unlisted`로 설정할 때 생성된다; `public`/`private` 파일에는 없다.
- **회전이 기본 폐기 수단이다**: 토큰을 재생성하면 이전에 공유한 모든 링크가 즉시
  무효화된다. 서명 URL이 못 하는 일이며, 목표 2의 공유 링크가 본질적으로 새어나가기
  때문에 필요하다.
- **TTL은 선택이며 기본은 "만료 없음"**(`shareExpiresAt` null → 영구 링크, 받는
  사람에게 편한 형태)이다. 임시 공유를 원하는 소유자가 만료를 설정하면 엔드포인트가
  만료된 토큰을 거절한다. TTL은 위생·편의 계층이지 **유출 방어가 아니다** — 이미
  새어나간 링크를 만료 전에 끊는 것은 회전뿐이다.

### D4 — 허용 미디어 타입을 이미지·오디오·영상으로 확장

업로드 허용 목록을 다음으로 확장하며, 전부 ≤ 100 MB
([ADR 0005](0005-local-disk-storage.ko.md)의 상한은 그대로):

| 분류 | 확장자 | mimetype |
|---|---|---|
| 이미지 | jpg/jpeg, png, webp | image/jpeg, image/png, image/webp |
| 오디오 | mp3 | audio/mpeg |
| 영상 | mp4, mov, webm | video/mp4, video/quicktime, video/webm |

클라이언트가 보낸 mimetype·확장자는 콘텐츠 보장이 아니라 우발적/노골적 오용에 대한
허용 목록이라는 기존 스탠스(Never Do Group 3)를 유지한다.

### D5 — 단일 `video` 필드를 타입별 다중 필드로 교체

`POST /upload/attach`는 union을 받는 단일 `video` 필드 대신, 각자 분류 허용 목록을 가진
세 개의 명명 필드 — `image`, `audio`, `video` — 중 하나를 받는다. 필드명이 기대 분류를
자기 설명하고, 각 허용 목록을 필드에 국소화한다. 이는 동결된 표면
([ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md))과
[ADR 0003](0003-two-phase-upload-contract.ko.md) 업로드 계약의 **개정**이다. 이제 살아
있는 프론트엔드 소비자가 있으므로 그 반영은 추적되는 저장소 간 과제다(Consequences
참조). `temp_{uuid}_{ts}.{ext}` 명명과 일회성 클레임 토큰
([ADR 0019](0019-upload-claim-idempotency.ko.md))은 영향받지 않는다 — 필드명이 아니라
확장자를 기준으로 하기 때문이다.

### D6 — 신규 에러 코드 (소비자와 함께 확정)

- `FILE_SHARE_INVALID` (403) — `unlisted` 파일을 없거나 틀리거나 만료된 공유 토큰으로
  요청.
- 비공개 파일을 비소유자가 요청하면 기존 403 `FORBIDDEN_NOT_OWNER`를 재사용할지, 파일
  존재를 확인해 주지 않기 위해 404 `FILE_NOT_FOUND`로 답할지 — 존재 노출 트레이드는
  구현 시 결정한다. 타입 거부는 `UPLOAD_INVALID_TYPE`를 유지한다. 카탈로그 관례상
  코드는 그것을 던지는 코드와 함께 추가하며, 미리 만들지 않는다
  ([ADR 0011](0011-error-code-contract.ko.md)).

## Alternatives rejected

- **비공개/unlisted용 서명 만료 URL (서빙 옵션 B)** — 공유 URL이 자체 서명 만료를
  싣고 `ServeStaticModule`은 서명 검증 미들웨어 뒤에 남는다. 기각: 서명 링크는 만료
  전에 **개별 폐기가 불가능**하며, 이것이 목표 2가 함의하는 유출 대응 목표다. D3의
  저장 토큰은 회전 *과* 선택적 TTL을 모두 준다 — 상위 집합.
- **정적 서빙 없이 전부 앱 경유 (서빙 옵션 C)를 규칙으로** — `file/upload`에는 사실상
  채택했지만(D2) 일괄 규칙으로는 기각: 진짜 공개 파일을 별도 정적 디렉터리로도 서빙할지는
  미리 금지하지 않고 측정에 맡긴다.
- **단일 일반 필드 리네임(`video` → `file` 또는 `media`)** — 전체 union을 받는 한
  필드. 표면은 단순하지만 하나의 허용 목록이 내부에서 분류를 분기해야 하고 필드명이
  무엇을 담는지 알려 주지 못한다. D5의 타입별 필드를 자기 설명적·필드별 허용 목록을
  위해 택했다; 세 필드가 프론트엔드에 불편하면 리네임이 대체안으로 남는다.
- **분류별 `POST /upload/attach/image` 등 분리** — 가장 명시적이나, 한 엔드포인트의 세
  필드로 표현되는 것을 위해 라우트 표면을 3배로 늘리고 Swagger/에러 표면을 이득 없이
  배가한다.
- **가시성을 boolean `isPublic`으로** — 목표 2가 필요로 하는 세 번째 "unlisted" 상태를
  표현하지 못한다; 두 값 플래그는 링크 공유를 "완전 공개"로 강제해 "링크 가진 사람만"
  성질을 잃는다.

## Consequences

- **스키마 변경(구현 시 검토된 마이그레이션)**: `FileEntity`에 `visibility`(enum, 기본
  `private`), `shareToken`(nullable), `shareExpiresAt`(nullable) 추가. CLAUDE.md에 따라
  엔티티 세 곳 모두에 등록; `migration:generate` 출력은 줄 단위 검토, 가짜 제약 리네임은
  제거([ADR 0006](0006-schema-policy-and-migration-adoption.ko.md)).
- **`ServeStaticModule`이 더는 `file/upload`를 서빙하지 않는다**(D2). 잔여 구현 하위
  결정 — 정적 서빙 성능을 위해 공개 파일을 별도의 진짜 공개 디렉터리로 서빙할지, 아니면
  granted 읽기 *전부*를 엔드포인트로 보내고 "public"을 인증 생략 경로로 둘지 — 는 **구현
  과제에서 작성자가 정하도록 열어 두며**(D2 참조), 여기서 확정하지 않는다; D2에 적은 권고는
  출발점이지 확정된 결정이 아니다. `file/temp` 정적 노출은 고아 정리
  스윕([ADR 0018](0018-orphan-temp-file-cleanup.ko.md))이 이미 다루는 별개 사안이다.
- **`FileResponseDto`에 `visibility`와, 소유자에게는 공유 URL이 추가된다**; 공개
  `fileUrl`은 raw 정적 경로가 아니라 콘텐츠 엔드포인트 URL이 된다. 응답 셰이핑은
  `FileService.toResponse`에 유지(Boundary Validation & Response Shaping).
- **살아 있는 소비자에 대한 breaking 변경.** Stage F 동결(소비자 0)과 달리 `frontend/`
  하위 폴더가 이 API를 소비한다. `video`→`image`/`audio`/`video` 필드 변경, 신규 콘텐츠
  엔드포인트, 가시성 필드 전부 프론트엔드 반영이 필요하다: `frontend/docs/API-CONTRACT.md`
  와 업로드/목록/재생 화면이 이를 받아들여야 한다. [CLAUDE.md](../CLAUDE.md) > Project
  Overview에 따라 그 작업은 **프론트엔드 스코프 과제**이며, 백엔드 변경은 저장소 경계에서
  멈춘다. ROADMAP > 미배정에서 추적.
- **Range 요청(영상·오디오 탐색)**은 `ServeStaticModule`에서 공짜였다(Express가 처리);
  콘텐츠 엔드포인트는 `Range`를 명시적으로 처리해야(`StreamableFile` + 부분 응답) 재생
  탐색이 계속 동작한다.
- **Stage 4 "VOD 재생 접근 제어" 행을 일반화하며 대체한다** — 여기의 접근 제어 서빙은
  영상뿐 아니라 전체 미디어를 다루므로, 로드맵은 그 행을 이 과제로 교체하고 배포보다 앞에
  둘 수 있다(접근 제어는 배포 대상과 독립적이다).
- **소유권은 `canManage`(작성자 또는 admin+) 유지** — 새 인가 축 없음. 가시성 설정과
  공유 토큰 회전은 호출자가 이미 통제하는 파일에 대한 소유자 쓰기다.
- **구현 시 테스트 커버리지**: 가시성 접근 매트릭스(public/private/unlisted ×
  소유자/타인/익명), 옛 링크를 무효화하는 공유 토큰 회전, TTL 만료, 필드별 타입 거부 —
  단위(`file.service.spec.ts`) + 실제 HTTP+DB e2e.
