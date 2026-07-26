# ADR 0018: 미청구(orphan) temp 파일 스케줄 정리

- 상태: Accepted
- 날짜: 2026-07-26
- English: [0018-orphan-temp-file-cleanup.md](0018-orphan-temp-file-cleanup.md)

## 배경

두 단계 업로드 계약([ADR 0003](0003-two-phase-upload-contract.ko.md))에서
`POST /upload/attach`는 `file/temp/temp_{uuid}_{ts}.{ext}`를 쓰고, 승격(`POST /file`)은
그 파일을 **`file/temp` 밖으로 rename**하여 `file/upload/granted_...`로 옮긴다. 따라서
`file/temp`에 `temp_` 접두로 남아 있는 파일은 정의상 전부 미청구 상태이며, 이를 식별하는 데
DB 조회가 필요 없다. 클라이언트가 파일을 attach만 하고 `POST /file`을 끝내 호출하지 않으면
그 `temp_` 파일은 무기한 잔류한다. ADR 0003의 Consequences는 이를 "아직 정리 작업이 없는 —
후보 로드맵 항목"으로 짚어 두었고, 이는 시스템에서 유일하게 관리되지 않는 리소스 누수다
(ROADMAP Stage 2). 방치하면 버려진 100 MB 업로드가 쌓여, 100 MB 크기 상한
([ADR 0005](0005-local-disk-storage.ko.md))이 막으려던 업로드 기반 서비스 거부(DoS) 표면을
다시 열게 된다.

## 결정

**앱 내부 스케줄 스윕**이 만료된 orphan temp 파일을 삭제한다.

- **메커니즘 — `@nestjs/schedule` (MIT).** 새 런타임 의존성이다. `@nestjs/schedule`가 해석하는
  엔진 `cron@4.4.0`은 backend 코드가 pnpm의 엄격한 링킹 아래에서 `CronJob`을 import할 수
  있도록 **직접(direct) 의존성**으로 승격했다 — `multer`와 동일한 phantom-transitive 승격
  선례를 따른다. `pnpm audit --prod` 기준 두 패키지 모두 새 취약점 경고를 추가하지 않았다.
- `@Cron` 데코레이터가 아닌 **명령형(imperative) 등록.** `TempCleanupService.onModuleInit`이
  `CronJob.from({ cronTime, onTick, waitForCompletion })`으로 잡을 만들어
  `SchedulerRegistry.addCronJob`으로 등록한다. 이유: 주기 문자열을 config에서 받아야 하는데
  (데코레이터 인자는 DI가 존재하기 전 클래스 정의 시점에 고정된다), 기능이 비활성일 때는 잡을
  등록해 두고 무동작시키는 대신 **아예 등록하지 않기** 위해서다.
- **새 모듈 `TempCleanupModule`** (`backend/temp-cleanup/`) — 도메인 모듈이 **아닌** *운영 /
  cross-cutting* 모듈이다. 이는 모듈 정책("새 모듈은 새 도메인이 등장할 때만")을 개정하여 운영
  모듈을 허용한다. 의도적으로 controller 전용인 `UploadModule`에 service를 추가하는 대신 이 방식을
  택했다 — 스윕을 `file/temp` 기록 주체와 같은 모듈에 두는 편이 데이터 응집도는 더 높지만,
  UploadModule의 순수성을 지키는 쪽을 우선했다 (Principle Conflict Protocol: SRP/응집 vs. 로컬
  "UploadModule has no service" 규칙 — 문서화된 정책 개정으로 해소).
- **안전성(되돌릴 수 없는 삭제 규율).** `file/temp` 안에서 이름이 `temp_`로 시작하고 `mtime`
  경과가 TTL을 넘는 항목만 삭제한다. `granted_` 파일과 `file/upload`는 결코 대상이 되지 않는다.
  `temp_` 접두는 이중으로 가드된다 — service가 `temp_`가 아닌 이름은 `stat`하기도 전에 건너뛰고,
  순수 함수 `selectExpiredTempFiles` 셀렉터가 접두를 한 번 더 확인한다. 모든 I/O는
  `fs/promises`(동기 blocking 없음)이며, unlink는 배치 처리(병렬도 제한)하고, 개별 파일 `unlink`
  실패는 로그를 남기되 스윕 전체를 중단시키지 않으며, `file/temp` 부재(`ENOENT`)는 조용한 no-op,
  `TEMP_SWEEP_DRY_RUN` 모드는 삭제 없이 대상만 로그로 남긴다.
- **설정(Joi + `.env.example`), 모두 안전한 기본값 보유:**
  `TEMP_SWEEP_ENABLED` (bool, `true`), `TEMP_SWEEP_CRON` (string, `'0 * * * *'` — 매시간),
  `TEMP_SWEEP_TTL_HOURS` (number, `24`), `TEMP_SWEEP_DRY_RUN` (bool, `false`). e2e 부팅은
  `TEMP_SWEEP_ENABLED=false`로 두어 테스트 중 cron이 등록되지 않게 한다.
- **TTL 24시간.** 느리지만 정상적인 `attach → POST /file` 흐름이 청구 도중 삭제되지 않을 만큼
  넉넉하며, 매시간 스윕이 최악 잔류 시간을 ≈ 25시간으로 제한한다. 스키마 변경은 없다 —
  파일시스템 접두 + `mtime`만으로 orphan이 완전히 식별된다.

## 기각한 대안

- **`POST /upload/attach` 시 기회적 스윕** — 무의존이지만 업로드 트래픽이 없으면 정리가 전혀
  일어나지 않고, 의도적으로 controller 전용인 `UploadModule`에 service를 추가하게 된다.
- **수동 / 외부 cron용 `pnpm` 스크립트** — 무의존이지만 아직 존재하지 않는 외부 스케줄러(배포
  파이프라인 부재)에 의존하므로 누수를 Stage 4까지 미룬다.
- **`@Cron` 데코레이터(선언형)** — env 기반 주기를 받을 수 없고 비활성 시 등록을 건너뛸 수 없다.
  여기서는 둘 다 요구사항이다.
- **`UploadModule` 내부 스윕** — 데이터 응집도는 가장 높지만(`file/temp`를 소유) "UploadModule
  has no service"를 위반하므로, 그 모듈을 controller 전용으로 유지하기 위해 기각했다.
- **DB 기반 orphan 추적** — 불필요하다. `temp_` 접두 + `mtime`이 이미 orphan을 식별하므로
  `FileEntity` 상태나 스키마 변경이 필요 없다.

## 영향

- `@nestjs/schedule`와 `cron`이 새 런타임 의존성이다(둘 다 MIT). `AppModule`에
  `ScheduleModule.forRoot()`가 추가된다(이제 앱 내부에 전역 스케줄러가 상주한다).
- **모듈 정책 개정**: `TempCleanupModule`과 같은 운영 / 인프라성 cross-cutting 모듈은 "새 모듈은
  새 도메인일 때만"에 대한 공인된 예외가 된다. CLAUDE.md의 Module Responsibility 및 Two-Phase
  Upload Contract 절을 갱신했다.
- ADR 0003의 "아직 정리 작업이 없다"는 consequence가 해소된다.
- 향후 다중 인스턴스 배포(Stage 4)에서는 모든 인스턴스가 cron을 돌리게 된다. 스윕은 멱등하므로
  (두 번째 인스턴스는 삭제할 것이 없을 뿐) 문제는 없으나, 중복 제거 — 또는 스윕을 오케스트레이터
  수준의 예약 작업으로 옮기는 것 — 은 Stage 4의 과제가 된다.
- 스윕 처리량에 대한 구조적 메트릭/알림은 범위 밖이다(Stage 4 관측성).
