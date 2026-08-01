# ADR 0026: 파일 가시성 구현 — 서빙 방식, 메타데이터 필터링, 콘텐츠/메타데이터 노출 정책 분리

- 상태: Accepted
- 날짜: 2026-08-01
- English: [0026-file-visibility-implementation.md](0026-file-visibility-implementation.md)

## 배경

[ADR 0025](0025-file-visibility-and-media-expansion.ko.md)는 코드 없이 결정 다섯 개(D1~D6)만
확정한 설계 게이트였다. D1(가시성 3단계), D3(공유 토큰), D6의 `FILE_SHARE_INVALID` 코드는 그
문서에 적힌 그대로 구현됐다. 이번 구현 과제에 남겨진 것은 두 가지다.

1. **D2의 열린 하위 결정** — 진짜 public 파일을 별도 정적 디렉터리에서도 서빙할지, 아니면 모든
   granted 읽기를 `GET /file/:id/content` 하나로 라우팅할지. ADR 0025는 권고("더 단순하고
   경로가 하나뿐인 옵션")를 남겼을 뿐 확정하지는 않았다.
2. **ADR 0025 본문이 아예 다루지 않은 공백** — 그 설계 게이트는 오직 *콘텐츠* 바이트만 논한다
   ("모든 저장 파일이 공개로 서빙된다", D2의 접근 검사). `GET /file`(목록)과 `GET /file/:id`
   (메타데이터)도 가시성을 따라야 하는지는 한마디도 없다. 코드를 쓰기 전에 이것이 중요하다는
   점이 분명해졌다 — 두 엔드포인트는 지금 가시성과 무관하게 모든 파일의 제목과 작성자
   이메일을 로그인한 아무에게나 돌려준다. 이대로 두면 'private'는 실질이 없는 이름이
   된다 — 타인이 private 파일의 *바이트*는 읽지 못해도, 그 제목과 누가 만들었는지는 여전히
   볼 수 있기 때문이다.

이 ADR은 이 두 가지를 구현 시점에 확정한 기록이다. 미디어 타입 확장(ADR 0025 D4/D5 —
image/audio 필드 타입)은 아직 일정이 잡히지 않은 별도 과제다. 이 문서의 어떤 결정도 업로드
허용 목록이나 필드 이름을 건드리지 않는다.

## 결정

### D2 확정: 단일 접근 제어 엔드포인트, 별도 public 정적 디렉터리 없음

`GET /file/:id/content`가 granted 바이트를 서빙하는 유일한 경로다. `ServeStaticModule`은 이제
`file/temp`만 루트로 삼고(`backend/app.module.ts`), `file/upload`는 어디에도 마운트되지 않는다.
public 파일의 바이트도 여전히 `FileService.resolveContentAccess`를 거친다 — `visibility:
'public'`이면 검사만 건너뛸 뿐, 행이 존재하는지 확인하고 private/unlisted와 동일한 Range 지원
스트리밍 경로로 나간다.

ADR 0025가 이미 이 옵션의 근거로 남긴 이유 그대로 선택했다. 코드 경로가 하나면 둘일 때보다
추론하고 테스트하기 쉽고, 병행 정적 디렉터리를 두면 가시성 전환 시 동기화 로직(공개 전환 시
복사, 비공개 전환 시 삭제)이 별도로 필요한데 단일 엔드포인트 설계는 이것이 아예 필요 없다.
성능 비용(모든 public 읽기가 이제 정적 파일 서버가 아니라 Nest/Express를 거친다)은 측정 없이
감수한다 — 이 프로젝트는 포트폴리오 규모이고 그 복잡도 추가를 정당화할 트래픽이 없으며, 나중에
필요해지면 private/unlisted 경로를 전혀 건드리지 않고 재검토할 수 있다.

### D7(신규): 메타데이터 엔드포인트도 가시성을 필터링한다

`GET /file`과 `GET /file/:id`는 이제 작성자·admin 외에게는 `private`와 `unlisted` 행을
숨긴다. 비소유자의 `GET /file` 목록은 그 행들을 그냥 빼고 반환하고, `GET /file/:id`가 숨겨진
행을 만나면 404 `FILE_NOT_FOUND`로 답한다(아래 D8 참고).

`unlisted`도 여기서는 `private`와 동일하게 필터링한다 — "메타데이터는 보이고 콘텐츠만
잠근다"로 다루지 않는다. 이름 자체가 "목록에 없음(un-*listed*)"이고, 로그인한 아무에게나
일반 목록에 나타나게 두면 그 단어의 의미를 무력화하면서 아무 이점도 더하지 않는다 — 실제
공유 링크를 가진 쪽은애초에 목록으로 파일을 찾을 필요가 없었다.

기각한 대안: 메타데이터 엔드포인트는 그대로 두고 콘텐츠만 잠근다 — ADR 0025의 문면 그대로다.
기각한 이유: 토글의 유일한 관찰 가능한 효과가 "바이트만 403"이고 제목과 작성자 이메일은 여전히
누구나 읽을 수 있다면, 이는 소유자가 파일을 private로 바꿀 때 합리적으로 기대하는 바와 맞지
않는다. ADR 0025가 명시한 목표 3("private와 public 사이를 토글")의 어디에도 메타데이터를
예외로 두라는 암시는 없다 — 그 ADR은 이 질문 자체를 고려한 적이 없을 뿐이다.

### D8(신규): 콘텐츠와 메타데이터는 의도적으로 서로 다른 방식으로 접근 거부를 알린다

- **메타데이터** (`GET /file/:id`)는 요청자가 볼 수 없는 파일에 **404 `FILE_NOT_FOUND`**로
  답한다. 이것이 ADR 0025 D6이 미결로 남긴 존재-노출 선택이며, 여기서는 숨기는 쪽으로
  확정한다. 메타데이터 엔드포인트는 타인이 카탈로그를 열람할 수 있는 통로이므로, 권한 없는
  호출자에게 "42번은 존재하지만 읽을 수만 없다"를 확인해 주는 것은 ADR 0025가 원래 상정한
  바이트 접근 문제보다 더 많은 것을 흘린다.
- **콘텐츠** (`GET /file/:id/content`)는 비소유자·비admin이 요청한 private 파일에 **403
  `FORBIDDEN_NOT_OWNER`**로, 누락·오류·만료된 unlisted 토큰에는 **403 `FILE_SHARE_INVALID`**로
  답한다. 콘텐츠는 존재는 확인해 주되 바이트만 거부한다. 이는 같은 소유권 질문에 대해
  `updateFile`/`deleteFile`이 이미 쓰고 있는 기존 403 패턴과 일치시킨 것이지, 콘텐츠
  엔드포인트만의 별도 존재-은닉 동작을 새로 만든 것이 아니다. unlisted 파일은 잘못된 토큰에도
  결코 404로 답하지 않는다 — "unlisted"는 "토큰 소지자만 도달 가능"으로 정의되지 "추측하면
  도달 불가능"이 아니기 때문이다. 거기서 404를 쓰면 토큰이 아니라 id 자체가 틀렸다는 잘못된
  인상을 준다.

두 엔드포인트가 서로 다르게 답해도 되는 이유는 애초에 다른 질문에 답하기 때문이다.
메타데이터 엔드포인트는 발견 통로(타인이 이 파일의 존재를 알아도 되는가)를 결정하고, 콘텐츠
엔드포인트는 id를 어떻게 알게 됐든(게시글 참조, 오래된 북마크, 누군가 전달한 공유 링크) D1의
3단계 접근 규칙이 반드시 강제돼야 하는 유일한 지점이다. 두 곳에 하나의 노출 정책을
강제한다면 메타데이터가 새거나, 근거 없이 콘텐츠 엔드포인트의 동작을 바꾸는 결과 중 하나를
낳는다.

### 익명 콘텐츠 접근을 위한 가드 구조

`GET /file/:id/content`는 `Authorization` 헤더가 전혀 없어도(public, 토큰을 가진 unlisted)
동작해야 하는데, `FileController`의 클래스 레벨 `JwtAuthGuard`는 그 컨트롤러의 다른 모든
라우트에 그것을 금지한다. 그 가드 배치를 재구성하는 대신, 콘텐츠 접근은 별도의
`FileContentController`(`backend/file/file-content.controller.ts`)에 두고, 토큰이 있으면
검증하되 없어도 던지지 않는 새 `OptionalJwtAuthGuard`
(`backend/auth/guard/optional-jwt-auth.guard.ts`)로 가드하며, 기존 `@AuthUser` 데코레이터가
`request.user`를 읽는 방식을 그대로 본뜬 `OptionalAuthUser` 파라미터 데코레이터
(`backend/auth/decorator/optional-auth-user.decorator.ts`)를 짝지었다. 기존
`FileController`의 다섯 라우트는 손대지 않았다.

## 검토 후 기각한 대안

- **엔드포인트에 더해 별도 public 정적 디렉터리를 병행** (D2의 다른 옵션) — 위 이유로
  기각했다. public 파일의 읽기 성능이 실측으로 문제가 되면 나중에 되돌릴 수 있는 선택으로
  기록해 둔다.
- **메타데이터 엔드포인트는 필터링하지 않음** (D7의 대안) — 위에서 기각했다.
- **메타데이터와 콘텐츠에 걸쳐 노출 정책을 하나로(전부 404 또는 전부 403)** (D8의 대안) —
  위에서 기각했다. 두 엔드포인트는 다른 질문에 답하므로 정책을 공유하면 둘 중 하나가
  아무 이득 없이 훼손된다.
- **두 번째 컨트롤러 대신 `FileController` 하나에서 메서드별 가드 오버라이드** — 잘 동작하는
  다섯 라우트 대비 더 큰 diff가 되므로 기각했다. Nest의 가드는 오버라이드가 아니라
  합성(클래스+메서드)되므로, 같은 클래스에서 한 라우트만 인증 선택제로 만들고 나머지 다섯은
  인증 필수로 유지하려면 `@UseGuards(JwtAuthGuard)`를 다섯 메서드 각각에 개별적으로
  옮기거나, 라우트별 메타데이터를 읽어 던질지 말지 판단하는 가드를 새로 만들어야 한다. 두 번째
  컨트롤러가 더 작고 더 읽기 쉬운 변경이며, `CommentModule`이 이미 한 모듈의 라우트를 두
  컨트롤러로 나누는 전례를 세웠다 — 거기서는 경로 프리픽스 때문이었고 여기서는 인증 요구사항
  때문이라는 차이만 있을 뿐이다.

## 결과

- **마이그레이션** `1785571437643-AddFileVisibility`가 `FileEntity.visibility`(varchar, 기본값
  `'private'`), `shareToken`(nullable varchar), `shareExpiresAt`(nullable timestamptz)를
  추가한다. `migration:generate`의 원본 출력과 라인 단위로 대조해 검토했다 — 읽기 쉬운 이름을
  쓰는 베이스라인 마이그레이션에서는 항상 나타나는, 제약/인덱스 이름을 해시로 바꾸려는 가짜
  변경 문장(CLAUDE.md > Architecture Decisions > Database에 문서화됨)을 걷어내고 `ADD COLUMN`
  세 문장만 남겼다.
- **`test/e2e-utils.ts`**의 `MIGRATIONS` 목록에 새 마이그레이션을 추가했다(새 테이블이 없으므로
  `TABLES`는 그대로다). `test/app.e2e-spec.ts`에는 가시성 접근 매트릭스, 공유 토큰 회전, TTL
  만료, Range 요청을 다루는 새 `describe` 블록을 추가했다.
- **`FileResponseDto.fileUrl`**은 이제 정적 `file/upload/...` 경로 대신
  `{BASE_URL}/file/:id/content`를 가리킨다. `visibility` 필드는 항상 존재하고, `shareUrl`은
  응답자가 그 파일을 관리할 수 있고 현재 unlisted일 때만 존재한다. 기존 정적 경로 형태를
  검사하던 e2e 단언 두 곳(`file.service.spec.ts`의 업로드 테스트, `app.e2e-spec.ts`의 게시글
  첨부 테스트)을 갱신했다.
- **`frontend/`에 대한 breaking change다** — ADR 0025가 D5의 필드 이름 변경으로 이미 예고한 것
  위에 하나 더 얹힌다. `fileUrl`의 형태가 바뀌었고 `visibility` 필드가 새로 생겼다. ADR 0025의
  결과 섹션과 CLAUDE.md > Project Overview에 따라 프론트엔드 반영은 별도의, 프론트엔드
  범위의 과제다. 이 과제는 저장소 경계에서 멈춘다.
- **새 에러 코드** `FILE_SHARE_INVALID`(403)를 그것을 던지는 곳
  (`FileService.resolveContentAccess`)에 함께 추가했다 — ADR 0011 카탈로그 관례를 따른다.
- **CLAUDE.md의 File Storage 섹션**은 이 ADR과 같은 변경에서 "결정됐지만 아직 구현되지 않은"
  게이트 서술 대신 실제로 반영된 동작(콘텐츠 엔드포인트 서빙, `file/upload` 정적 서빙 중단)을
  기술하도록 갱신한다 — D1/D2/D3/D6에 대해서는 게이트를 통과했기 때문이다. D4/D5 미디어 타입
  확장 서술은 여전히 미착수 상태로 남긴다.

## 알려진 한계 (후속 작업, 2026-08-01 기록)

구현 후 검토에서 콘텐츠 엔드포인트
([file-content.controller.ts](../backend/file/file-content.controller.ts))의 미결 항목을
심각도 순으로 짚었다. 코드 항목은 [ROADMAP.ko.md](../ROADMAP.ko.md) > 미일정에서 추적한다:

1. **[중간] 스트림 에러 미처리.** 200·206 두 경로의 `createReadStream(...).pipe(res)`에
   `'error'` 리스너가 없어, 헤더가 나간 *뒤* 읽기 실패(스트리밍 중 `DELETE /file/:id` 경합,
   디스크 오류)가 미처리 `'error'` 이벤트로 프로세스를 크래시시킨다(Never Do Group 1). 수정:
   응답을 destroy하고 `warn`으로 로그하는 `stream.on('error', …)` 부착.
2. **[낮음] Suffix `Range: bytes=-N` 오처리.** 마지막 N바이트 요청을 `start=0, end=N`(앞
   N+1바이트)으로 파싱한다. 대부분 플레이어가 `bytes=N-`를 써서 실사용 영향은 낮음 — 여유 될 때
   suffix 분기 추가.

코드 불요 관찰(기록만): `416` 응답에 `ErrorBody` `code`가 없음(도메인 에러가 아닌 프로토콜
레벨 응답); 다중 필드 첨부 거부 시 남는 temp orphan은 [ADR 0018](0018-orphan-temp-file-cleanup.ko.md)
스윕이 회수; `file/temp`는 여전히 정적 서빙(기존 동작·추측 불가 uuid — 가시성 범위 밖).
