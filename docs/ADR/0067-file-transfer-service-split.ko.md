# ADR 0067: 소유권 이전을 `FileService`에서 `FileTransferService`로 분리한다

- 상태: 승인됨 — 구현 완료. 스키마·API·동작 변경 없음
- 날짜: 2026-10-14
- 관련: [ADR 0050](0050-consent-based-file-ownership-transfer.ko.md) (이전 흐름 자체), [ADR 0023](0023-board-domain-schema.ko.md) D4 (FileModule은 질문에 답할 뿐 묻는 쪽을 import하지 않는다)
- English: [0067-file-transfer-service-split.md](0067-file-transfer-service-split.md)

## 배경

`backend/file/file.service.ts`가 1,024줄, 공개 메서드 13개가 됐다. 그중 약 200줄이 소유권 이전
흐름의 쓰기 메서드 4개(`proposeTransfer`, `acceptTransfer`, `rejectTransfer`,
`cancelTransfer`, ADR 0050)였다. 2026-10-14에 코드에서 확인한 사실은 다음과 같다.

- 이 4개는 클래스의 나머지와 상태를 공유하지 않는다. 쓰는 것은 `fileRepository`,
  `userRepository`(propose에서만), `auditLogService`(accept에서만), creator-또는-admin
  판정(propose에서만), "행을 읽고 없으면 404" 단계, `toResponse`다.
- 호출하는 곳은 `FileController`의 `/file/:id/transfer…` 핸들러 4개뿐이다.
- `userRepository`는 `FileService`에서 다른 쓰임이 없었다.

분리할지가 아니라 어떻게 분리할지가 문제였다. 새 모듈, `FileModule` 안의 새 서비스, 그대로 두기가
후보였다.

## 결정

### D1 — `FileModule` 안에 `FileTransferService`를 두고 export하지 않는다

`backend/file/file-transfer.service.ts`가 4개 메서드를 본문과 목적/이유/방법 주석 그대로 옮겨
받는다. `FileModule`의 provider이고 `exports`에는 넣지 않는다. 호출자가 `FileController` 하나뿐이고
다른 모듈에 약속한 계약이 없기 때문이다.

### D2 — `FileService`와는 `toResponse`로만 맞닿는다

`toResponse`는 이미 public이므로(PostService도 쓴다) `FileService`의 공개 표면은 그대로다. 아래 두
가지는 public으로 열지 않고 새 서비스에 복사했다.

- `canManage` 4줄. PostService와 CommentService도 각자 같은 것을 갖고 있다.
- "creator와 `pendingTransferTo`를 포함해 행을 읽고, 없으면 404 `FILE_NOT_FOUND`" 단계. private
  `loadWithPending(id)`로 둔다.

`FileService`는 더 이상 `userRepository`를 주입받지 않는다.

### D3 — 읽기 쪽은 `FileService`에 남긴다

`toResponse`(`pendingTransferTo`를 언제 보여 주는가)와 `getFileById`(대기 중인 파일을 누가 볼 수
있는가)는 다른 호출자도 공유하는 읽기 경로다. 옮기면 `PostService`까지 변경 범위에 들어온다.

### D4 — 라우트는 `FileController`에 둔다

핸들러 4개의 경로·가드·throttle·Swagger 문구는 그대로이고 호출 대상만 바뀐다. `file.service.ts`를
가리키던 Swagger 설명 두 곳은 `file-transfer.service.ts`를 가리키도록 고쳤다.

## 결과

- `file.service.ts`는 1,024줄에서 약 820줄이 되고, 새 서비스는 주석 포함 248줄이다.
- 테스트: 이전 `describe` 4개를 `file-transfer.service.spec.ts`로 그대로 옮겼다(17개).
  `file.service`와 `file-transfer.service`를 합치면 91개로, 분리 전과 같다. 새 spec은 실제
  `FileService`를 써서 응답 단언을 바꾸지 않았다.
- creator-또는-admin 규칙이 이제 서비스 네 곳(File, FileTransfer, Post, Comment)에 있다. 이
  규칙을 바꾸면 각각 고쳐야 한다. 세 곳일 때도 마찬가지였다.
- ADR 0050은 `file.service.ts`와 `file.service.spec.ts`를 위치로 적어 두었다. 본문은 쓰인 그대로
  두고, 이 ADR이 가리키는 역할을 한다.
- 검증: 단위 282/282, 백엔드 e2e 76/76(HTTP + 실제 Postgres, 이전 제안·수락 포함). 실서버
  Playwright는 이번 변경에서 돌리지 못했다. 3000 포트를 같은 머신의 다른 프로젝트 프로세스가
  쥐고 있었다.

## 기각한 대안

| 대안 | 기각 이유 |
|---|---|
| `FileService`에 그대로 둔다 | 저장소에서 가장 큰 파일로 남고, 이전 규칙을 바꿀 때 업로드·가시성 로직과 같은 파일에서 만난다 |
| 별도 `FileTransferModule` | `FileService.toResponse`가 필요해 `FileModule`을 import하고, `FileModule`의 `FileController`가 이 모듈을 다시 import해 순환이 된다. 호출자 하나에 모듈은 과하다 |
| `FileService`의 `canManage`와 로더를 public으로 연다 | 약 20줄을 아끼려고 모든 소비자가 보는 계약을 넓히게 된다 |
| `toResponse`를 별도 매퍼로 뺀다 | `PostService`와 `UserService`까지 변경에 들어온다. 이번 목적은 파일 크기다 |
