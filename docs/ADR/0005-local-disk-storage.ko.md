# ADR 0005: ServeStaticModule로 서빙하는 로컬 디스크 저장

- 상태: 승인됨
- 날짜: 2025-12-17
- English: [0005-local-disk-storage.md](0005-local-disk-storage.md)

## 맥락

업로드된 동영상에는 물리적 저장소와 공개 URL이 필요합니다. 클라우드 오브젝트
스토리지(S3 등)는 배포 대상이 없는 로컬/포트폴리오 프로젝트에 자격 증명, SDK,
비용을 추가합니다. 프로젝트의 학습 목표 자체가 Multer의 디스크 처리였습니다.

## 결정

- Multer `diskStorage`가 `file/temp`에 기록하고, 승격된 파일은 `file/upload`에
  존재합니다 ([ADR 0003](0003-two-phase-upload-contract.ko.md) 참조).
- `ServeStaticModule`이 `file/` 디렉터리를 `/file` URL 접두사로 서빙합니다
  (`rootPath: join(process.cwd(), 'file')`, `serveRoot: 'file'`).
- 공개 URL은 `FileService.toResponse()`에서 `{BASE_URL}/{filePath}`로 조합됩니다 —
  표현 로직은 엔티티 밖에 둡니다.
- 업로드 제약: 단일 multipart 필드 `video`, `fileSize` 제한 100,000,000바이트(100 MB).

**금지 제안** (명시적 요청 없이는): S3/클라우드 스토리지, 스트리밍/청크 업로드, CDN.

## 결과

- 외부 의존성 제로. 체크아웃 + PostgreSQL만으로 전체 스택이 동작합니다.
- 저장 용량은 호스트 디스크에만 의존합니다. 수평 확장이나 다중 인스턴스 배포는
  조용히 깨집니다(각 인스턴스가 자기만의 `file/` 트리를 가짐) — 배포 대상이 없으므로
  수용 가능합니다.
- 정적 서빙이 `temp/`와 `upload/` 폴더 모두를 노출하므로, 파일명 접두사가 수명주기
  상태를 담습니다.
- `FileEntity` 행 삭제는 물리 파일을 삭제하지 **않습니다** — 물리 정리는
  [ROADMAP.ko.md](../ROADMAP.ko.md)에서 추적하는 알려진 공백입니다.
