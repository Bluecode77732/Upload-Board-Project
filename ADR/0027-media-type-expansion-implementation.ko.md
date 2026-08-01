# ADR 0027: 미디어 타입 확장 구현 — 타입별 업로드 필드

- 상태: Accepted
- 날짜: 2026-08-01
- English: [0027-media-type-expansion-implementation.md](0027-media-type-expansion-implementation.md)

## 배경

[ADR 0025](0025-file-visibility-and-media-expansion.ko.md)는 코드 없이 결정 여섯 개(D1~D6)만
확정한 설계 게이트였다. [ADR 0026](0026-file-visibility-implementation.ko.md)이 D1/D2/D3/D6
(가시성, 접근 제어 서빙, 공유 토큰)을 구현했다. D4(허용 목록 확장)와 D5(타입별 업로드 필드)는
이번 별도 과제로 명시적으로 남겨졌다 — ADR 0026의 배경 절에 직접 그렇게 적혀 있고, CLAUDE.md의
알려진 미해결 지점도 그 커밋 이후 계속 미착수로 추적해 왔다.

이 변경 전에는 `POST /upload/attach`가 `video`라는 멀티파트 필드 하나만 받았고 허용 목록은
mp4/mov/webm뿐이었다(`backend/upload/upload.controller.ts`). 이미지와 오디오는 무조건
거부됐고, 창립 목표 4("이미지, 비디오, mp3, mp4를 100MB 이내로")는 부분적으로만 충족된
상태였다.

## 결정

### 세 개의 명명된 필드를 한 라우트에 — 라우트 세 개도, 범용 필드 하나도 아니다

`POST /upload/attach`는 이제 `image`, `audio`, `video` 세 멀티파트 필드 중 하나를 받는다.
각 필드는 ADR 0025 D5가 정한 대로 자신만의 클래스 허용 목록을 가진다. 라우트와 응답 형태
(`{ filename }`)는 그대로다.

구현 형태: `FileFieldsInterceptor`를 썼다(필드별 `FileInterceptor`를 세 개 겹쳐 쓰는 방식이
아니다 — 멀티파트 본문은 한 번만 파싱할 수 있으므로, 한 라우트에 필드별 인터셉터 세 개를
두는 것은 Nest/Multer가 지원하는 선택지가 아니다). 세 필드 이름 모두를
(`[{name:'image',maxCount:1}, {name:'audio',maxCount:1}, {name:'video',maxCount:1}]`) 하나의
공유 `fileFilter`와 함께 등록한다. 이 필터는 `file.fieldname`으로 분기하는데 — 클라이언트가
보낸 값이므로 타입 캐스팅으로 신뢰하지 않고 작은 `Map<string, allowlist>`에서 조회한다 — 그
필드 고유의 확장자/마임타입을 적용한다.

| 필드 | 확장자 | 마임타입 |
|---|---|---|
| `image` | jpg, jpeg, png, webp | image/jpeg, image/png, image/webp |
| `audio` | mp3 | audio/mpeg |
| `video` | mp4, mov, webm | video/mp4, video/quicktime, video/webm |

세 필드 모두 기존 100MB 상한([ADR 0005](0005-local-disk-storage.ko.md))을 그대로 따른다 — D4는
용량 제한이 아니라 타입 허용 목록만 바꿨다.

### "정확히 하나의 필드"는 컨트롤러가 강제한다 — Multer 혼자서는 못 한다

`FileFieldsInterceptor`는 등록된 세 필드의 어떤 조합이든 받아들인다 — Multer에는 "N개 필드 중
정확히 하나"라는 내장 제약이 없다. 핸들러는 세 필드 중 몇 개가 실제로 채워져 돌아왔는지
(`@UploadedFile()` 대신 `@UploadedFiles()`로) 센 뒤 두 경우 모두 타입이 붙은 400을 던진다 —
0개면 기존 `UPLOAD_FILE_REQUIRED`를 그대로 재사용하고(단일 필드였을 때와 "뭔가 첨부하라"는
결과는 달라지지 않았다), 2개 이상이면 신규 `UPLOAD_MULTIPLE_FIELDS`다. [ADR
0011](0011-error-code-contract.ko.md)의 카탈로그 관례에 따라 코드는 미리 예약해 두지 않고
그것을 던지는 지점에 함께 추가했다.

두 번째 필드도 그 필드에 맞지 않는 타입인 채로 두 필드를 함께 보낸 클라이언트는
`UPLOAD_MULTIPLE_FIELDS` 대신 `UPLOAD_INVALID_TYPE`을 보게 된다 — Multer의 `fileFilter`는
멀티파트 본문이 스트리밍되는 동안 파일 단위로 실행되며 첫 실패에서 바로 거부하므로, 그
경우엔 다중 필드 검사가 실행될 기회조차 없다. 어느 쪽이든 타입 코드가 붙은 400이므로, 이
순서를 맞추자고 버퍼링/재정렬 로직을 추가할 가치는 없다(YAGNI).

### `upload.module.ts`의 Multer `diskStorage`는 손대지 않았다

`temp_{uuid}_{timestamp}.{ext}` 파일명 생성기(`upload.module.ts`)는 확장자를
`file.originalname`에서 읽을 뿐 필드 이름은 전혀 보지 않는다 — 그래서 네 번째 업로드 클래스가
내일 추가되더라도 이 파일은 건드릴 필요가 없다. 이번 과제는 `upload.controller.ts`의
인터셉터 설정과 Swagger 본문 스키마만 바꿨다. CLAUDE.md(범위 준수)가 고영향 파일로 분류한
스토리지 설정 파일은 읽기만 했고 편집하지 않았다.

### 다른 두 곳의 확장자 허용 목록도 함께 넓혀야 했다

"어떤 확장자가 유효한가"를 인코딩하는 곳이 두 군데 더 있는데, 둘 다 필드 이름이 아니라
확장자로 판단한다(그래서 D5의 필드 분리에는 영향받지 않지만, D4의 확장된 클래스 목록에는
직접 영향받는다).

- `TEMP_FILENAME_PATTERN`(`backend/file/dto/create-uploadFile.dto.ts`) — 클라이언트가
  `POST /file`에 그대로 돌려보내는 `filePath`를 검증하며, 동시에 일회성 청구 토큰 역할도
  한다([ADR 0019](0019-upload-claim-idempotency.ko.md)). 확장자 그룹을 `(mp4|mov|webm)`에서
  `(jpg|jpeg|png|webp|mp3|mp4|mov|webm)`로 넓혔다. 이렇게 하지 않으면 `POST /upload/attach`가
  방금 받아들인 것과 같은 파일인데도 `POST /file`이 모든 이미지/오디오 승격을 400
  `VALIDATION_FAILED`로 거부하게 된다 — 두 엔드포인트가 무엇이 성공한 업로드인지에 대해
  서로 어긋나는 셈이다.
- `CONTENT_TYPE_BY_EXTENSION`(`backend/file/file-content.controller.ts`) —
  `GET /file/:id/content`([ADR 0026](0026-file-visibility-implementation.ko.md))가 바이트를
  스트리밍할 때 쓰는 `Content-Type` 조회표다. 그 파일의 헤더 주석이 이미 이것을
  `upload.controller.ts` 허용 목록의 video 전용 거울상이며 이번 과제를 기다리고 있다고
  표시해 두었다. 새 확장자→마임타입 행 다섯 개를 추가했을 뿐, 그 컨트롤러의 서빙 로직 자체는
  달라지지 않았다.

두 파일 모두 *동작 방식*은 바뀌지 않았다 — 둘 다 이미 확장자로 조회하는 범용 로직이었다.
데이터만 넓어졌을 뿐이며, 필드 분리와 같은 변경에서 함께 넓힌 이유는 이 둘을 빼고 D5만
내보내면 1단계에서는 이미지/오디오 업로드를 받아 놓고 2·3단계에서 거부하거나 잘못
서빙하게 되기 때문이다.

## 검토 후 기각한 대안

[ADR 0025](0025-file-visibility-and-media-expansion.ko.md)의 "기각한 대안"에 이미 기록돼
있다(범용 필드 하나, 클래스별 라우트) — 여기서 다시 다루지 않는다. D5가 이미 타입별 필드
형태를 선택했다. ADR 0025가 열어 둔 구현 수준의 유일한 선택은 "정확히 하나의 필드"를
서버에서 *어떻게* 강제할지였고, 위에서 확정했다.

## 결과

- **스키마 변경 없음.** 이번 과제는 업로드 검증만 건드린다 — `FileEntity`는 영향받지 않고
  마이그레이션도 없다.
- **새 에러 코드** `UPLOAD_MULTIPLE_FIELDS`(400)를 그것을 던지는 곳
  (`UploadController.uploadMedia`)에 함께 추가했다 — ADR 0011 카탈로그 관례를 따른다.
- **`@ApiBody`는 이제 필수 `video` 필드 하나 대신 선택적 바이너리 속성 세 개**
  (`image`/`audio`/`video`)를 문서화하며, 정확히 하나만 기대한다는 설명을 덧붙였다. 400
  `@ApiResponse` 설명도 새로 생긴 세 가지 실패 형태를 모두 나열한다.
- **살아 있는 소비자에 대한 breaking change다** — ADR 0025 D5가 이미 예고한 그대로다.
  `video` 전용 필드는 사라졌다. `frontend/docs/API-CONTRACT.md`와 업로드 화면은 여전히 옛
  단일 필드 형태를 겨냥하고 있으며, 별도의 프론트엔드 범위 과제가 필요하다(CLAUDE.md >
  프로젝트 개요) — 이번 과제는 저장소 경계에서 멈춘다.
- **테스트 커버리지**: `test/app.e2e-spec.ts`의 2단계 업로드 describe 블록에 케이스 네 개를
  추가했다 — 이미지 왕복(첨부 → 승격 → 콘텐츠 `Content-Type: image/jpeg`), 오디오 왕복(동일,
  `audio/mpeg`), 필드에 맞지 않는 타입 거부, 필드 두 개 동시 첨부 거부. 기존 video 경로
  테스트는 손대지 않았고 그대로 통과한다 — `video`는 mp4/mov/webm에 대해 여전히 유효한 필드
  이름이기 때문이다. 유닛 테스트 변경은 없다 — `upload.controller.ts`는 컨트롤러라서 기존
  Jest 설정(테스트 규약)에서 커버리지 대상이 아니다.
- **CLAUDE.md의 File Storage 섹션**은 이 변경과 같은 커밋에서 "결정됐지만 아직 구현되지
  않은(D4/D5)" 게이트 서술 대신 실제로 반영된 세 필드 허용 목록을 기술하도록 갱신한다 —
  D4/D5가 이제 모두 구현됐기 때문이다.
