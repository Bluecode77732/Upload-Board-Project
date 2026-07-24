# ADR 0011: 기계 판독 가능한 에러 코드 계약

- 상태: 승인됨
- 날짜: 2026-07-23
- English: [0011-error-code-contract.md](0011-error-code-contract.md)

## 배경

API 표면은 동결되었고([ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md))
브라우저 프론트엔드 도입이 임박했다. 지금까지 에러 응답은 Nest 기본값 그대로 —
상태 코드와 자유 텍스트 `message`뿐이었다. 이 상태로 프론트엔드를 만들면 선택지는
둘 다 나쁘다: 메시지 문자열을 하드코딩하거나(문장은 계약이 아니다), 상태 코드만으로
분기하거나(둘 다 400인 "제목 중복"과 "잘못된 파일 경로"를 구분할 수 없다). 라우트를
동결한 것과 같은 이유로, 에러 계약도 첫 소비자가 생기기 전에 확정해야 한다.

## 결정

- **동결된 응답 형태** — 모든 에러 응답은 `ErrorBody`(`backend/common/error-code.ts`)를
  따른다:

  ```json
  {
    "statusCode": 400,
    "code": "FILE_TITLE_TAKEN",
    "message": "Title already in use.",
    "timestamp": "2026-07-23T09:00:00.000Z",
    "path": "/file/1"
  }
  ```

  계약의 핵심은 `code`다: 안정적이고 기계 판독 가능하며, 클라이언트가 분기해도
  되는 유일한 필드다. `message`는 사람을 위한 것으로 언제든 바뀔 수 있다.
  `stack`은 `ENV=dev`일 때만 붙는다. `timestamp`와 `path`를 포함한 것은 아직
  로깅 인프라가 없기 때문이다(ROADMAP Stage 1) — 로깅이 자리 잡기 전까지는
  응답 본문이 에러 발생 지점을 사후에 특정할 수 있는 유일한 단서이며, 두 필드
  모두 내부 구조를 노출하지 않는다.
- **문자열 enum 카탈로그** — `ErrorCode`는 현재 18개 코드를 정의한다:
  도메인 코드(`AUTH_BAD_TOKEN_FORMAT`, `AUTH_INVALID_CREDENTIALS`,
  `AUTH_EMAIL_TAKEN`, `AUTH_TOKEN_INVALID`, `AUTH_UNAUTHORIZED`,
  `FORBIDDEN_NOT_OWNER`, `USER_NOT_FOUND`, `FILE_NOT_FOUND`, `FILE_TITLE_TAKEN`,
  `FILE_INVALID_PATH`, `UPLOAD_FILE_REQUIRED`, `UPLOAD_INVALID_TYPE`,
  `VALIDATION_FAILED`)와 상태 기반 폴백(`BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`,
  `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`).
- **스로우 지점에서 부여, 새 예외 클래스 없음** — 코드는 표준 Nest 예외에 실어
  던진다:

  ```typescript
  throw new BadRequestException({ code: ErrorCode.FILE_TITLE_TAKEN, message: 'Title already in use.' });
  ```

  커스텀 예외 계층은 기각했다 — `HttpException`이 이미 객체 본문을 보존하고,
  프레임워크 관용구로 충분한 곳에 새 추상화를 만들지 않는 것이 이 저장소의
  규약이다.
- **전역 필터 하나** — `AllExceptionsFilter`
  (`backend/common/filter/all-exceptions.filter.ts`)를 `app.module.ts`의
  `APP_FILTER`로 등록해 DI 관리 하에 둔다(dev 전용 stack은 ConfigService가
  결정). 필터는 예외 본문에서 `code`를 추출하고, 코드 없이 던져진 예외
  (프레임워크 404, passport 401, Multer 413)는 상태 기반 폴백으로 처리한다.
  `message`가 배열인 400은 전역 ValidationPipe의 시그니처이므로 파이프를 건드리지
  않고 `VALIDATION_FAILED`로 분류한다.
- **호환성 규칙** — 코드의 이름 변경·삭제는 breaking change다(ROADMAP이 유예한
  버저닝 결정이 필요); 코드 추가는 자유다. `HttpException`이 아닌 오류는 바깥으로
  `"Internal server error"`만 내보낸다 — 내부 정보는 절대 새지 않는다(Never Do
  Group 3).

## 기각한 대안

- **커스텀 예외 클래스 계층** (`AppException extends HttpException`) — 객체
  리터럴로 이미 표현되는 것을 위해 새 추상화와 상속 트리를 만들고, 모든 스로우
  지점을 전용 API로 옮겨야 한다.
- **필터 내부의 메시지 문자열 → 코드 매핑** — 계약을 문장에 결합시켜, 메시지
  문구를 다듬을 때마다 클라이언트 분기가 조용히 깨진다.
- **숫자 코드 체계** (예: `40001`) — 읽으려면 대조표가 필요하다; 문자열 코드는
  로그와 네트워크 탭에서 그 자체로 설명된다.
- **최소형** (`statusCode`/`code`/`message`만) — 로깅 인프라가 없는 동안은
  기각: `timestamp`/`path`를 빼면 신고된 에러를 사후에 특정할 방법이 없다.
  Stage 1 로깅이 자리 잡은 뒤 두 필드가 불필요해지면 재검토한다.

## 결과

- 새 스로우 지점은 `{ code, message }`를 붙여야 한다 — 상태 폴백은 프레임워크발
  예외를 위한 것이지 코드 생략의 면허가 아니다(CLAUDE.md 규약).
- `all-exceptions.filter.spec.ts`가 계약을 고정한다(코드 전달, 폴백, validation
  배열, dev 전용 stack); `filter.ts`는 커버리지 측정 대상이다.
- README가 API 소비자를 위해 응답 형태를 문서화하고, Swagger는 엔드포인트별 상태
  코드를 계속 문서화한다.
- Stage F 파이프라인은 다음으로 넘어간다: refresh 토큰 httpOnly 쿠키 이동 + 회전
  (ROADMAP Stage F 작업 3).
