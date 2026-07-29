# ADR 0019: 업로드 중복 제출 정책 — attach 파일명을 1회용 청구 토큰으로

- 상태: Accepted
- 날짜: 2026-07-27
- English: [0019-upload-claim-idempotency.md](0019-upload-claim-idempotency.md)

## 배경

CLAUDE.md는 모든 write 엔드포인트가 중복 제출 거동을 명시하도록 요구하며(Engineering
Principles > Maintainability > Idempotence), Stage 3에서 write 엔드포인트가 늘어나므로 그
전에 프레임을 확정해야 한다(ROADMAP Stage 2). 두 단계 업로드
([ADR 0003](0003-two-phase-upload-contract.ko.md))에는 그런 명시가 없었는데, 실제 코드를
추적해 보니 미정의 상태일 뿐 아니라 세 지점에서 잘못 동작하고 있었다.

| 중복 제출 | 이 ADR 이전 거동 |
|---|---|
| `POST /upload/attach` 2회 | `temp_` 파일 2개 생성, 둘 다 201 — 하나는 orphan |
| 1차 성공 후 `POST /file`을 동일 body로 재시도 | 400 `FILE_TITLE_TAKEN` — "타인이 title을 선점"과 구분 불가 |
| 같은 `filePath` + 다른 title로 `POST /file` | insert 성공 → `rename`이 `ENOENT` → rollback → **500** |
| 같은 title로 `POST /file` 동시 2건 | 락 없는 title 사전검사를 둘 다 통과, 패자의 `QueryFailedError`는 `HttpException`이 아니라 **500** |
| attach가 발급한 적 없는 `filePath` | `rename` `ENOENT` → **500** |

또한 `UploadFileDto.filePath`는 형식 검증 없이 `join(cwd, 'file/temp', filePath)`의 rename
소스로 들어갔다. 따라서 클라이언트가 `../` 세그먼트를 끼워 넣으면 **타인의 `granted_` 파일을
가리키는 `FileEntity` 행**을 만들 수 있었다 — "filePath는 서버가 생성한다"는 전제(Never Do
Group 3)를 강제하는 코드가 없었던 셈이다.

## 결정

**attach가 발급한 파일명을 1회용 청구 토큰으로 삼는다.** 새 저장소도 스키마 변경도 없다.
`temp_{uuid}_{ts}.{ext}`는 이미 서버가 요청마다 유일하게 생성하는 값이고, 그 파일명의
`granted_` 형태를 `filePath`로 가진 `FileEntity` 행의 존재 자체가 "토큰이 소진되었다"는
기록이기 때문이다.

- **`POST /upload/attach`는 의도적으로 비멱등을 유지한다.** 호출마다 새 토큰을 발급하며,
  청구되지 않은 토큰은 스케줄 스윕([ADR 0018](0018-orphan-temp-file-cleanup.ko.md))이
  회수한다. 바이트 단위 중복 제거는 기각했다(아래 참조).
- **`POST /file`은 트랜잭션을 열기 전에 청구 여부를 먼저 판정한다:**
  - **같은 사용자**가 이미 청구 → **200** + 기존 리소스 반환(멱등 replay; 재시도가 두 번째
    생성처럼 보여서는 안 된다),
  - **다른 사용자**가 이미 청구 → **409 `FILE_ALREADY_CLAIMED`**(신규 코드). 역할이 아니라
    신원만 본다 — 관리자가 타인의 파일명을 다시 제출하는 것은 재시도가 아니라 충돌이다.
    RBAC는 파일을 *관리*할 권한이지 *청구*할 권한이 아니다,
  - 형식은 맞지만 뒤를 받쳐 줄 temp 파일이 없음(발급된 적 없거나 TTL 초과로 스윕됨) →
    **400 `FILE_INVALID_PATH`**. 500으로 새어 나가는 대신 어떤 쓰기보다도 먼저 검사한다.
- **동시 제출 경합은 락이 아니라 DB가 판정한다.** title 사전검사는 락 없는 읽기이므로 동시
  제출은 둘 다 통과할 수 있다. 이때 unique 제약이 승자를 정하고, 패자의 `23505`를 다시
  해석한다 — 승자가 같은 파일명을 청구했다면 패자는 같은 요청의 두 번째 사본이므로 replay하고,
  아니면 진짜 title 충돌이므로 400 `FILE_TITLE_TAKEN`을 낸다. 예측 가능한 클라이언트
  시퀀스에서 500이 나오는 경로가 양방향 모두 사라진다.
- **`filePath`는 발급 형식으로 고정한다.** `UploadFileDto`에 `@Matches(TEMP_FILENAME_PATTERN)`
  — `^temp_{uuid}_{ms}\.(mp4|mov|webm)$`이며, 저장되는 확장자가 원본 파일명의 대소문자를
  유지하므로 대소문자를 구분하지 않는다. 형식 위반은 전역 파이프가 경계에서 400
  `VALIDATION_FAILED`로 거절한다(검증은 서비스가 아니라 DTO에 둔다는 기존 규약 유지).
  이로써 경로 탈출이 구조적으로 차단된다. `UpdateFileDto`는 상속받은 `filePath`를
  **omit하고 재선언**한다 — 두 엔드포인트는 접두 상태기계의 반대편에 서 있어서(`temp_`가
  들어오고 `granted_`가 나간다), 패턴을 그대로 상속하면 정상적인 수정 요청이 전부 거절된다.
- **트랜잭션 패턴은 그대로** 수동 QueryRunner(패턴 표 2행)다 — 비-DB 부수효과(`rename`)가
  여전히 경계 안에 있다. 청구 사전검사와 temp 존재 확인은 읽기이므로 트랜잭션 *앞*에 두어,
  재시도가 커넥션을 아예 열지 않게 했다.

## 기각한 대안

- **`Idempotency-Key` 헤더** — 가장 일반적인 해법이고 향후 write 엔드포인트까지 함께 커버하는
  유일한 안이지만, 키↔응답 테이블(스키마 변경 + 마이그레이션), in-flight 상태와 TTL 정리,
  전역 `ValidationPipe` 밖의 헤더 파싱이 필요하다. 게다가 그 키는 서버가 이미 발급하고 있는
  토큰을 중복 구현하는 셈이다. Stage 3에서 자연 토큰이 없는 write 엔드포인트가 생기면 그때
  다시 검토한다.
- **content-hash 중복 제거** — 중복 바이트를 실제로 제거하는 유일한 안이지만 "같은 바이트"는
  "같은 요청"이 아니다. 위 재시도 거동을 하나도 고치지 못하고, 서로 다른 사용자가 같은 영상을
  올리면 소유권이 얽히며, "`file/temp`의 `temp_` 파일은 미청구이므로 삭제해도 안전하다"는
  ADR 0018의 전제를 깨뜨린다.
- **문서화만(코드 무변경)** — 비용은 0이지만 "동시 제출은 500"을 문서화된 계약으로 굳히게 되고,
  `filePath` 검증 공백도 그대로 남는다.

## 영향

- `POST /file`이 201뿐 아니라 **200**(replay)도 응답할 수 있게 된다. 상태 코드는 서비스가
  돌려준 `replayed` 플래그로 컨트롤러가 `@Res({ passthrough: true })`를 통해 지정한다 —
  `AuthController`가 쿠키에 이미 쓰고 있는 패턴이다. `FileService.uploadFile`의 반환 타입은
  `FileResponseDto`에서 `{ replayed, file }`로 바뀐다.
- 동결된 에러 코드 카탈로그([ADR 0011](0011-error-code-contract.ko.md))에
  `FILE_ALREADY_CLAIMED`(409)가 추가된다. 코드 추가는 breaking 변경이 아니지만, 409는 이
  API가 처음 내보내는 상태 코드이므로 프론트엔드가 처리해야 한다.
- **프론트엔드 반영은 프론트엔드 전용 과제이며, 이 변경의 범위 밖임을 명시한다.**
  `frontend/docs/API-CONTRACT.md`와 클라이언트 업로드 흐름이 200 replay와 409를 받아들여야
  하고, 그전까지 프론트엔드는 replay를 새 생성으로 읽으며 409 분기가 없다. 이 변경이 저장소
  경계에서 멈춘 이유는 `frontend/`가 자체 CLAUDE.md와 툴체인을 갖기 때문이다(CLAUDE.md >
  Project Overview: 백엔드 작업에서 프론트엔드 파일을 편집하지 않는다). ROADMAP 7절에
  추적 항목으로 남겼다.
- 형식이 잘못된 `filePath`는 서비스에 도달하기 전에 파이프에서 `VALIDATION_FAILED`로 실패한다.
  서비스가 던지는 `FILE_INVALID_PATH`와 코드가 다른데, 후자는 "형식은 맞지만 사용할 수 없는
  파일명"에만 쓴다.
- `attach` 중복 호출은 스윕이 돌 때까지 여전히 디스크를 차지한다. 상한은
  `TEMP_SWEEP_TTL_HOURS` × 100 MB이며, 중복 제거 대신 이 비용을 의도적으로 수용한다.
- replay는 최초 응답 본문이 아니라 DB 행을 신뢰한다 — 재제출한 `title`은 무시된다. 이는 의도된
  동작이며(최초 청구가 이긴다), title을 바꿔 재시도한 클라이언트는 400이 아니라 원래 title을
  돌려받는다.
- `23505` 판별은 Postgres 드라이버 에러 코드를 읽는다. `DB_TYPE=postgres`로 이미 고정된 범위
  안에서의 의도적이고 국소적인 결합이다.
