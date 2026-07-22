# ADR 0003: `temp_` → `granted_` 접두사 상태 머신의 2단계 업로드

- 상태: 승인됨
- 날짜: 2025-12-17
- English: [0003-two-phase-upload-contract.md](0003-two-phase-upload-contract.md)

## 맥락

단일 요청 업로드(multipart + 메타데이터 동시)는 물리적 쓰기와 DB 행을 결합시킵니다:
파일이 저장된 뒤 메타데이터 검증이 실패하면 고아 파일이 남고, insert 후 파일 쓰기가
실패하면 행이 존재하지 않는 파일을 가리킵니다. 또한 이 프로젝트가 `UploadModule`과
`FileModule`로 의도적으로 분리한 두 관심사(물리 저장 vs 메타데이터)를 하나로 합쳐
버립니다. `ServeStaticModule`이 `file/` 트리 전체를 노출하므로 파일에는 눈에 보이는
수명주기 상태도 필요합니다.

## 결정

업로드는 접두사 상태 머신을 가진 두 개의 요청입니다:

1. `POST /upload/attach` — Multer diskStorage가
   `file/temp/temp_{uuid}_{timestamp}.{ext}`를 기록하고 생성된 파일명만 반환합니다.
   `temp_`는 "업로드됐지만 미소유"를 의미합니다.
2. `POST /file/uploadFile` — 하나의 QueryRunner 트랜잭션 안에서
   `filePath = file/upload/granted_...`로 `FileEntity` 행을 insert하고 파일을
   `file/temp`에서 `file/upload`로 물리적으로 rename합니다. `granted_`는
   "DB 행이 소유"를 의미합니다.

`UpdateFileDto.filePath`는 `temp_` 값을 거부하고 `granted_` 값만 허용합니다.
파일명은 항상 서버가 생성(uuid + timestamp)하며 클라이언트는 그것을 되돌려줄
뿐입니다 — 클라이언트가 선택한 경로 조각이 파일시스템에 닿는 일이 없습니다.

## 결과

- 접두사는 정적 서빙에 보이는 유일한 수명주기 표식입니다. `filePath`의 모든 소비자는
  상태 머신을 끝까지 보존해야 합니다.
- 고아 `temp_` 파일(첨부됐지만 미소유)이 누적됩니다. 정리 작업은 아직 없으며
  로드맵 후보 항목입니다.
- DB insert + rename의 결합이 `FileService`가 수동 QueryRunner 패턴을 쓰는
  이유입니다 ([ADR 0004](0004-transaction-pattern-selection.ko.md) 참조).
- 경로 조작(path traversal)은 정제(sanitization)가 아니라 구조적으로 차단됩니다.
