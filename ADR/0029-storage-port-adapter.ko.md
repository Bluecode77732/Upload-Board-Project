# ADR 0029: 스토리지 포트-어댑터 — `FileStorage` 인터페이스

- 상태: 채택됨
- 날짜: 2026-08-07
- 개정 대상: [ADR 0005](0005-local-disk-storage.md) (로컬 디스크 저장)
- English: [0029-storage-port-adapter.md](0029-storage-port-adapter.md)

##배경

ADR 0005는 "배포 대상이 없다"는 전제를 명시하고 로컬 디스크 저장을 채택했고, 그 위험까지
스스로 기록해 두었다: "수평 확장이나 다중 인스턴스 배포는 조용히 깨진다(인스턴스마다 서로
다른 `file/` 트리를 본다)." [ROADMAP.md](../ROADMAP.md) §4(아키텍처 방향)는 이미 이 문제의
해법을 결정된 미래 목표로 명시해 두었다 — 물리 파일 조작을 격리하는 `FileStorage` 인터페이스를
두어 로컬 디스크 구현을 S3로 교체 가능하게 만드는 것. 그리고 Stage 4는 이 해법을 배포 직전
과제(K8s·Helm·S3)로 지목한다. 이 ADR은 그 과제의 "코드 선행 조각"이다 — 인터페이스와 두
어댑터가 K8s/Helm 작업보다 먼저, 그리고 실제 AWS 자격증명이 존재하기도 전에 지금 들어간다.
바뀐 것은 ADR 0005가 서 있던 전제이지 로컬 저장 동작 자체가 아니다 — 그 동작은 새 인터페이스
뒤로 변경 없이 그대로 이식된다.

**ISP 통과 근거**: CLAUDE.md의 인터페이스 분리 원칙은 "실제 두 번째 구현체가 생기기 전에는
서비스 인터페이스 계층을 두지 않는다"이다. `S3Storage`가 바로 그 두 번째 구현체이며, 이번
변경에서 함께 만들어지고 단위 테스트까지 거친다(버킷이 아직 없으므로 SDK는 모킹). 즉 지금
인터페이스를 도입하는 것은 이 규약의 예외가 아니라, 규약 자체가 규정한 발동 시점이다.

**코드를 읽으며 확인한 실제 물리 파일 접점** (Structure Analysis, CLAUDE.md > Analysis
Protocol) — 요청 핸들러가 파일시스템에 직접 닿는 지점을 모두 나열한다. 포트가 부분적이
아니라 실효적이려면 이 전부를 덮어야 한다:

- `backend/upload/upload.module.ts` + `upload.controller.ts` — Multer `diskStorage`가
  temp 업로드의 최초 바이트를 Express 미들웨어 단계에서, 어떤 서비스 코드도 실행되기 전에
  `file/temp`에 직접 쓴다.
- `backend/file/file.service.ts`의 `uploadFile()` — QueryRunner 트랜잭션 안에서
  `access()`(ADR 0019 청구 전제조건)와 `rename()`(temp → granted 승격).
- `backend/file/file-content.controller.ts` — `stat()` + `createReadStream()` +
  Range 파싱/206/416(ADR 0025/0026).
- `backend/common/unlink-stored-files.ts` — 커밋 이후 best-effort `unlink()`,
  `FileService.deleteFile`과 `UserService.remove`의 연쇄 삭제 양쪽에서 호출된다.
- `backend/temp-cleanup/temp-cleanup.service.ts`(ADR 0018) — `readdir()` + `stat()` +
  `unlink()`로 `file/temp`를 크론으로 스윕한다.

이 중 넷은 서로 다른 세 모듈(`UploadModule`, `FileModule`, `TempCleanupModule`)에,
나머지 하나(공유 unlink 헬퍼)는 `UserModule`이 직접 호출한다. `FileService`만 덮는 포트는
나머지 셋을 여전히 로컬 디스크에 묶어 둔 채 남겨 포트 도입의 취지를 무력화한다.

## 결정

### D1 — 인터페이스 형태: S3 형태가 아니라 도메인 형태

메서드 이름은 범용 오브젝트 스토어 동사(`put`/`copy`/`get`)가 아니라 이 앱 고유의 상태머신
언어(`saveTemp`, `promote`, ...)를 그대로 쓴다. S3 SDK와 1:1 대응하는 `put(key, stream)` /
`copy(src, dest)` / `get(key, range)` 형태도 검토했으나 기각했다 — `temp_`→`granted_` 이름
치환 로직(현재 `FileService.toStoredPath`, 순수 함수)이 각 어댑터마다 더 얇지만 중복된
형태로 흩어지게 되는데, 이 절감은 도메인 형태가 아닌 세 번째 어댑터가 등장할 때만 의미가
있고 그런 어댑터는 계획에 없다. `FileService`가 이름 치환 로직을 계속 소유하고, 포트는
`FileService`(또는 `UploadService`)가 이미 계산해 둔 키에 대해 바이트만 옮긴다 — 구체적인
메서드 목록은 아래 참고.

### D2 — 모듈 배치: 새 `StorageModule`

이 코드베이스에 이미 있는 선례를 그대로 따른다: `TempCleanupModule`(ADR 0018)은 횡단 관심사인
파일시스템 스윕을 특정 도메인 모듈에 얹지 않고 "운영 모듈"로 독립시켰다. `FileStorage`도
같은 성격의 문제를 한 단계 더 아래에서 겪는다 — 세 도메인 모듈(`UploadModule`, `FileModule`,
`TempCleanupModule`)과 `UserModule`(계정 연쇄 삭제)이 모두 이를 필요로 하는 인프라다.
`FileModule` 안에 두는 대안도 검토했으나 기각했다 — CLAUDE.md가 "`FileModule`은 파일
*메타데이터*만 담당한다"라고 명시하는데, 물리 바이트 조작을 그 안에 접으면 그 문장을
늘리는 게 아니라 정면으로 어긴다.

`StorageModule`은 `FILE_STORAGE` DI 토큰을 export한다(인터페이스는 런타임 표현이 없으므로
토큰이 필요하다 — 다른 크로스모듈 export와 같은 표준 Nest 패턴). 소비하는 모듈은
`imports: [StorageModule]`로 가져와 토큰으로 주입받으며, 어느 모듈도 자기 `providers[]`에
프로바이더를 재선언하지 않는다(Structure Analysis 체크리스트).

### D3 — 어댑터 선택: 단일 `STORAGE_DRIVER` 환경변수

`STORAGE_DRIVER: 'local' | 's3'`를 `app.module.ts`의 기존 단일 Joi 스키마에 검증 추가,
기본값 `'local'`. `StorageModule`의 `useFactory` 프로바이더가 `ConfigService`를 읽어 맞는
어댑터를 생성한다. 검토했던 대안 — driver/bucket/region을 하나의 객체로 묶는
`registerAs('storage', ...)` — 은 기각했다: 이 저장소는 지금까지 모든 env var를 하나의 평평한
Joi 스키마로 검증해 왔고(Architecture Decisions > Config), `registerAs`는 이 기능 하나만을
위해 도입되는 전례 없는 두 번째 설정 패턴이 된다. 여기에 걸리는 변수 둘 — `S3_BUCKET`,
`AWS_REGION` — 은 `when('STORAGE_DRIVER', { is: 's3', then: Joi.required() })`로만
필수화한다. AWS 자격증명 자체는 의도적으로 Joi 스키마에도, `ConfigService`로도 넣지 않는다 —
`S3Storage`는 자격증명 없이 `new S3Client({ region })`만 생성하고, AWS SDK 자체의 기본
자격증명 체인(env var·공유 설정 파일·IAM 역할)이 이를 해석한다. 이것은 "`ConfigService`만
사용"(Architecture Decisions > Config) 규칙의 두 번째 예외가 아니다 — 우리 코드가 그 값을
직접 읽는 지점 자체가 없으므로 통제할 `process.env` 접근이 없다. SDK의 자격증명 해석은
`pg` 드라이버 내부 동작이 우리 설정 계층에 보이지 않는 것과 마찬가지로 우리 쪽에서 불투명하다.

### D4 — `UploadModule`이 서비스를 갖는다; CLAUDE.md의 "서비스 없음" 문구를 개정한다

**개정 배경.** CLAUDE.md Module Responsibility는 `UploadModule`을 "서비스 없음, DB 접근
없음 — 유지할 것"이라고 명시한다. 이는 오늘의 Multer `diskStorage`가 어떤 Nest 서비스도
실행되기 전, Express 미들웨어 단계에서 바이트를 디스크에 직접 쓰는 구조를 그대로 반영한
것이다. 이번 ADR의 목적은 ADR 0005가 기록해 둔 다중 인스턴스 격차를 닫는 것이다. 그런데 temp
업로드의 최초 바이트가 여전히 로컬 디스크에만 떨어진다면 — 포트를 거치지 않는 Multer
`diskStorage` 직접 쓰기 — `STORAGE_DRIVER=s3`에서 인스턴스 A가 처리한 `attach`와 뒤이은
`POST /file`을 처리하는 인스턴스 B는 여전히 그 파일을 찾지 못한다. `FileService.uploadFile`의
청구 확인은 포트를 거쳐(인스턴스에 무관, S3 기반) 읽지만, 그 확인 대상 바이트 자체가 애초에
포트를 거쳐 쓰인 적이 없기 때문이다. ADR 0005가 지목한 격차가 절반만 닫히고, 남는 절반이
하필 이 ADR이 존재하는 바로 그 이유다.

**이유.** 이 격차를 닫으려면 `UploadModule`이 `storage.saveTemp(key, buffer)`를 호출해야
하고, 그러려면 서비스가 필요한데, 현재의 "서비스 없음" 문구가 이를 정면으로 금지한다. 이는
스타일 선호가 아니라 기존 규칙과 이 ADR 자체의 목적 사이의 실제 충돌이므로, 우회하지 않고
여기서 정면으로 해소한다.

**결정.** `UploadModule`은 얇은 `UploadService`를 갖는다: Multer의 저장 엔진을 `diskStorage`
에서 `memoryStorage`로 바꾸고(`upload.controller.ts`의 인터셉터 설정은 그 외에는 그대로 —
같은 필드, 같은 허용목록, 같은 100MB 제한), `UploadService.stageTemp(file)`이
`temp_{uuid}_{timestamp}.{ext}` 이름을 생성하고(오늘 Multer `diskStorage` 콜백이 하는 것과
동일한 생성 로직을 그대로 옮긴 것) `storage.saveTemp(name, file.buffer)`를 호출한다.
컨트롤러는 디스크에 쓰인 Multer 파일의 `.filename`을 읽는 대신 이 서비스를 호출한다.
**CLAUDE.md의 Module Responsibility도 같은 변경 안에서 개정한다**: `UploadModule` 항목이
"서비스 없음, DB 접근 없음"에서 "주입된 `FileStorage` 포트를 통해 물리 *temp* 쓰기만
담당 — 메타데이터/DB 계층이 아닌 얇은 서비스"로 바뀐다.

**포부.** 이 결정은 모듈의 책임 범위를 이전과 똑같이 좁게 유지하면서도 — 여전히
`FileEntity`도, 소유권도, 청구 판정도 전혀 모른다 — "물리 파일"이라는 말이 실제로 "설정된
어댑터가 어디에 두든 물리 파일"을 뜻하게 만든다. 이것이 포트-어댑터를 두는 진짜 이유다.
대안(지금처럼 `diskStorage`를 그대로 두고 `STORAGE_DRIVER=s3`가 절반만 동작하는 것을
받아들이는 것)은 존재 이유인 바로 그 일을 못 하는 포트를 만드는 셈이라 기각했다.

**결과, 있는 그대로 명시.** `memoryStorage`는 업로드 전체(기존 100MB 상한까지)를 요청 하나
동안 프로세스 메모리에 버퍼링한다 — Multer가 거의 메모리 부담 없이 디스크로 바로 스트리밍하던
것과 다르다. 이것은 실제 자원 비용이며, 기존 크기 상한으로 값이 정해져 있고, 이 ADR의
목적 그 자체인 다중 인스턴스 정합성을 위한 대가로 여기서 받아들인다 — 숨겨진 회귀가 아니다.
100MB 상한 자체가 바뀌거나 메모리 압박이 실측될 때 재검토한다, 선제적으로 하지 않는다
(Engineering Principles > Avoid Premature Optimization).

### D5 — 인터페이스가 원안의 5개 동사보다 2개 늘어난다

`existsTemp`(쓰기와 존재확인을 합친 하나의 동사에서 분리 — `FileService`의 ADR 0019 청구
전제조건은 쓰기와 무관하게 바이트 존재 여부만 확인해야 한다)와 `listTemp`(신규 —
`TempCleanupService`를 추적하며 발견. 지금은 `readdir()` + `stat()`을 직접 호출하며 대응하는
동작이 없었다). 둘 다 포트가 위에서 찾은 다섯 접점을 실제로 덮기 위해 필요한 것이지 범위
확장이 아니다: `listTemp`를 빼면 고아 스윕(ADR 0018)이 `STORAGE_DRIVER`와 무관하게 계속
로컬 디스크만 읽다가 `s3`에서 아무 에러 없이 조용히 멈춘다 — 이 ADR이 없애려는 바로 그
종류의 조용한 다중 인스턴스 파손이다.

최종 형태:

```
saveTemp(tempKey, data: Buffer): Promise<void>
existsTemp(tempKey): Promise<boolean>
promote(tempKey, grantedKey): Promise<void>
stat(key): Promise<{ size: number }>
createReadStream(key, range?: { start; end }): Promise<Readable>
unlink(keys: string[]): Promise<{ deleted: number; failures: { key; reason }[] }>
listTemp(): Promise<{ key: string; mtimeMs: number }[]>
```

`grantedKey`/`key`는 오늘 `FileEntity.filePath`가 이미 저장하는 것과 같은 문자열이다
(`file/upload/granted_...`) — 포트가 두 번째 이름 체계를 새로 들여오지 않는다.
`LocalDiskStorage`는 이를 `process.cwd()` 아래로 결합하고, `S3Storage`는 그대로 오브젝트
키로 쓴다.

### D6 — 이번 ADR의 명시적 범위 밖

- **실제 운영을 S3로 전환하는 것.** `STORAGE_DRIVER`는 기본값이 `local`이며, 이번 변경의
  어떤 부분도 실제 버킷 존재를 요구하거나 전제하지 않는다. 그 전환은 Stage 4의 클라우드
  네이티브 인프라 과제(ROADMAP.md)이며 별도 ADR을 가진다.
- **`ServeStaticModule`의 정적 `file/temp` 경로.** 조건 없이 계속 로컬 디스크를 서빙한다.
  `STORAGE_DRIVER=s3`에서는 이 경로가 아무것도 서빙하지 못한다(temp 바이트가 로컬 디스크에
  전혀 닿지 않으므로) — 알려진 채로 받아들이는 격차이지 장애가 아니다: Express
  `serve-static`은 없는 파일을 404로 응답할 뿐 에러를 던지지 않는다. 오늘의 흐름 중 이
  경로를 실제로 읽는 곳은 없다(`FileResponseDto.fileUrl`은 ADR 0025/0026 이후 줄곧
  `GET /file/:id/content`를 가리키지, 정적 temp URL을 가리킨 적이 없다) — 따라서 클라이언트가
  의존하는 동작은 바뀌지 않는다. 나중 S3 전환이 마저 닫아야 할 잔여 항목으로 ROADMAP에 기록.
- **스키마 변경.** 없음 — `FileEntity.filePath`는 현재의 의미와 값을 그대로 유지한다.
- **프론트엔드.** 손대지 않는다 — API 표면 변경이 없는 백엔드 내부 리팩터다.

## 결과

- 로컬 디스크 동작(`temp_`/`granted_` 상태머신, Range/206/416 스트리밍, 실패를 `warn`으로
  남기는 커밋 후 best-effort unlink)은 `LocalDiskStorage` 뒤에서 정확히 그대로 보존된다 —
  회귀 검증으로 확인(기존 단위 테스트를 `fs/promises` 모킹 대신 포트 모킹으로 전환, 더해
  `pnpm test:e2e`).
- `S3Storage`는 실제로 동작하는 완성된 코드이지만, 모킹된 `@aws-sdk/client-s3` 클라이언트에
  대한 단위 테스트로만 검증됐다 — 실제 버킷에 대해 실행된 적이 없다. Stage 4 전환이 실제로
  검증하기 전까지는 "실전 미검증"으로 취급한다.
- 새 런타임 의존성: `@aws-sdk/client-s3`(Apache-2.0, 추가 전 `pnpm info`로 확인 — 카피레프트
  우려 없음).
- `backend/common/unlink-stored-files.ts`는 폐기된다: 경로 가드와 배치 처리 로직이
  `LocalDiskStorage.unlink()` 안으로 옮겨간다 — "어느 경로를 지워도 안전한가"가 이제
  어댑터별 관심사이기 때문이다(S3 어댑터의 대응하는 가드는 폴더 검사가 아니라 키 접두사
  검사다). 더 이상 두 서비스가 직접 import하는 공유 헬퍼가 아니다.
- `UserModule`과 `TempCleanupModule` 둘 다 `StorageModule`(주입된 `FILE_STORAGE` 토큰을
  통해)에 대한 의존성을 새로 갖는다 — 이전에는 어느 쪽도 스토리지를 직접 다루지 않았다.
  `UserModule`은 계정 연쇄 삭제의 unlink를 위해, `TempCleanupModule`은 스윕을 위해서다.
  둘 다 각 모듈 자신의 공개 계약을 바꾸지 않는 부가적인 `imports[]`일 뿐이다.
- CLAUDE.md도 같은 변경 안에서 갱신한다: `UploadModule`의 Module Responsibility 항목(D4),
  "물리 업로드 변경"·"삭제 경로 변경" concern-to-entrypoint 표 행(이제 `UploadService`/스토리지
  포트를 가리킨다), 그리고 새 "스토리지 어댑터 변경" 표 행.
