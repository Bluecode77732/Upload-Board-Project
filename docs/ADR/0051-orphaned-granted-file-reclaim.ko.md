# ADR 0051: 고아 `granted_` 파일 회수 — DB 조인 훑기(Sweep), 리포트 우선 기본값

- Status: Accepted — implemented (리포트만; 실제 삭제는 여전히 `GRANTED_SWEEP_DRY_RUN` 뒤에 있음)
- Date: 2026-09-05
- Extends: [ADR 0018](0018-orphan-temp-file-cleanup.ko.md) (temp 파일 훑기), [ADR 0029](0029-storage-port-adapter.ko.md) (`FileStorage` 포트), [ADR 0020](0020-account-deletion-cascade.ko.md) (커밋 후 best-effort unlink)
- English: [0051-orphaned-granted-file-reclaim.md](0051-orphaned-granted-file-reclaim.md)

## 배경 (Context)

granted 파일(`file/upload/granted_...`)의 물리 삭제는 커밋 이후 best-effort 방식으로
이뤄진다([ADR 0020](0020-account-deletion-cascade.ko.md)): `unlinkStoredFiles`/
`storage.unlink()`는 DB 행이 이미 사라진 뒤에 실행되고, 실패해도 `warn` 로그만 남을 뿐
재시도는 없다. [ROADMAP.md](../ROADMAP.ko.md)의 "고아 `granted_` 파일 회수" 항목
(2026-07-30 기록)은 구체적인 누출 경로 두 가지 — unlink 실패, 그리고 경로 조회와 계정
연쇄 삭제 사이에 파일이 새로 삽입되는 경우 — 를 짚는다. 그러면서
[ADR 0018](0018-orphan-temp-file-cleanup.ko.md)처럼 temp 파일을 훑는 방식을 그대로
베끼는 것은 명시적으로 배제한다: `temp_` 파일의 고아 여부는 접두사와 `mtime`만으로 판정할 수 있지만
(승격된 이후로는 `file/temp` 바깥에서 그 파일을 읽는 곳이 전혀 없으므로), `granted_`
파일의 고아 여부는 파일시스템만으로는 판정할 수 없다 — `file_entity.filePath`와의 조인이
필요하다. ROADMAP이 이 항목을 ADR 0018의 복사판이 아니라 "자체 ADR이 필요한 DB 조인
재조회"로 명시적으로 미뤄둔 이유가 바로 이것이다.

**실측을 시도했으나 결론 없음.** 이 ADR을 작성하기 전에 실제 현재 고아 개수를 재보려 했다
(`file/upload/`는 2026-09-04 기준 44개, 129MB). 로컬 `db` 컨테이너에는 기존 볼륨이 없었다 —
`docker compose up -d db`가 볼륨을 새로 만들어야 했고, `pnpm migration:show`는 그 위에서 모든
마이그레이션이 미적용 상태임을 확인했다. 이 환경에는 그 44개 파일과 대조할 만한 과거 DB 상태가
전혀 없다 — 빈 스키마를 기준으로는 44개 전부가 그대로 고아로 읽히는데, 이는 실제 신호가 아니다.
아래 설계는 이 숫자에 의존하지 않는다 — 실제 이력이 있는 살아있는 DB에 대해 실행됐을 때 실제
고아 개수가 무엇이든 정확해야 한다.

**포트 공백.** `FileStorage`([ADR 0029](0029-storage-port-adapter.ko.md))에는
`listTemp()`(ADR 0018이 temp 파일을 훑기 위해 추가함)는 있지만 granted 객체를 위한 동등한 메서드가
없다 — ADR 0018은 DB 조인이 전혀 필요 없었으므로 `file/upload`를 나열할 필요도 없었을 뿐이다.
두 어댑터(`LocalDiskStorage`, `S3Storage`) 모두 새 메서드가 필요하다.

## 결정 (Decision)

### D1 — 새 포트 메서드: `listGranted()`

```
listGranted(): Promise<StorageTempEntry[]>   // { key: string; mtimeMs: number }
```

새 타입을 만들지 않고 `StorageTempEntry`를 그대로 재사용한다 — 초안에서는 "granted 항목과
temp 항목은 의미가 다르다"는 논리로 `StorageGrantedEntry`를 별도로 뺐지만, 필드가 완전히
같은 두 인터페이스라 타입 안전성 이득 없는 순수 중복이었을 뿐이다. `StorageTempEntry`의 doc
comment가 이제 두 소비자를 함께 명시한다. `LocalDiskStorage.listGranted()`는 `file/upload`를
읽는다(`listTemp()`가 `file/temp`에 대해 하는 `readdir` + `stat`을 그대로 미러링하되, `granted_`
접두 항목만 걸러내고, key를 `FileEntity.filePath`가 이미 저장하는 정확한 문자열인
`file/upload/granted_...` 전체 형태로 반환한다 — 그래서 D3의 diff는 별도 변환 없이 단순 문자열
집합 멤버십 확인이 된다). `S3Storage.listGranted()`는 `granted/` 물리 접두사를 나열하고
`toS3GrantedKey`의 매핑을 역변환해 논리 키 `file/upload/granted_...` 형태로 되돌린다 —
`listTemp()`가 `temp/`에 대해 이미 하는 역변환과 같은 모양이다.

### D2 — 모듈 배치: 별도 모듈이 아니라 `FileModule` 안

**초안에서 정정함.** 이 ADR의 첫 버전은 `TempCleanupModule`의 모양을 그대로 따르는 새
operational 모듈 `GrantedCleanupModule`(`imports: [StorageModule, MetricsModule]`, 자체
`OnModuleInit` 크론 등록)을 제안했다. 다시 따져보니 그 선례는 여기 그대로 적용되지
않는다: `TempCleanupModule`과 `StorageModule`이 operational 모듈인 이유는 **자기 도메인
데이터가 전혀 없는** 횡단 인프라이면서 *여러* 도메인 모듈이 함께 소비하기 때문이다 —
바로 그 점이 어느 한 도메인도 소유하지 않는 모듈을 갖는 근거다. 이 훑기는 정반대
모양이다: 하는 일 전부가 **`FileModule` 자신의 엔티티**를 디스크와 대조하는 것이고,
`FileModule`은 필요한 걸 이미 다 갖고 있다 — `TypeOrmModule.forFeature([FileEntity,
UserEntity])`, `StorageModule`, `MetricsModule`(`file.module.ts`). 별도 모듈을 뒀다면
`FileModule` 바깥에 소비자가 하나도 없는 이 훑는 작업을 위해 이미 있는 배선을 그대로
중복시켰을 뿐이다 — 이건 공유되는 횡단 관심사가 아니라 `FileModule` 자신의 유지보수
관심사다.

**결정.** `GrantedCleanupService`는 `FileModule` 안의 **export하지 않는** provider다
(`providers: [FileService, GrantedCleanupService]`). `TempCleanupModule`에 합치지도
않는데, 그 모듈의 `TempCleanupService`는 설계상 DB 접근이 전혀 없고(ADR 0018/0029), 이
훑기의 핵심 동작이 바로 그 설계가 의도적으로 배제한 DB 조인이기 때문이다. `FileService`의
export 메서드를 거치지도 않는데, 정의상 고아는 행 자체가 없으므로 `FileService`의
소유권/공개범위 판단이 애초에 적용될 대상이 없기 때문이다 — 필요한 건 오직 현재
존재하는 `filePath` 값의 집합뿐이다. 그래서 `GrantedCleanupService`는 `FileModule`이 이미
선언한 `TypeOrmModule.forFeature`를 통해 `Repository<FileEntity>`를 직접 주입받아
`filePath` 컬럼만 읽는다(`find({ select: ['filePath'] })`) — 읽기 전용이며, 여기엔 쓰기
경로가 전혀 없다. 이는 `AuthModule`이 `UserEntity`에 대해 쓰는 것과 같은 교차 모듈
리포지토리 직접 주입 패턴이다(실제 비즈니스 로직은 별도로 `UserModule`을 임포트해서
쓰는 것도 동일하다 — `auth.module.ts:6,14`) — 다만 여기서는 그 엔티티가 애초에
`FileModule` 자신의 것이라, 건너야 할 교차 모듈 경계 자체가 없다는 점만 다르다.

### D3 — 고아 판정 기준과 승격 레이스

후보는 `listGranted()` 항목 중 키가 현재 `file_entity.filePath` 값 집합에 **없고**,
`mtimeMs`가 최소 나이 기준보다 오래된 것이다.

이 기준이 필요한 이유: `FileService.uploadFile`의 `storage.promote()` 호출은
`commitTransaction()` 전, QueryRunner 트랜잭션 **안에서** 실행된다(Transaction Boundary
표) — 그 DB 행이 다른 커넥션에 보이기 직전 순간에 물리 rename(또는 S3 copy+delete)이
먼저 끝나버릴 수 있다는 뜻이다. 바로 그 순간에 훑으면 아직 대응 행이 없는 granted
키를 보게 되어, 진행 중인 정상 승격을 고아로 오판할 수 있다. ADR 0018의 TTL과 같은
종류의 문제를 뒤집은 형태다: 그 TTL은 temp 파일이 삭제되기 전에 도달해야 하는 최대
나이이고, 이건 디스크에만 있는 granted 키가 고아로 *간주*되기 전에 도달해야 하는 최소
나이다 — `promote()`의 일반적인 소요 시간(1초 미만)에 비해 넉넉하게 잡는다. ADR 0018이
자신의 24시간 TTL에 썼던 "느리지만 진짜인 청구가 절대 걷히지 않을 만큼 넉넉히"와 같은
논리다. 그 TTL과 달리 이 기준은 설정값으로 노출하지 **않는다** — 정정 전 초안엔
`GRANTED_SWEEP_MIN_AGE_MINUTES` 환경변수가 있었지만 재검토했다.
`TEMP_SWEEP_TTL_HOURS`는 진짜 운영 판단이다(방치된 업로드를 얼마나 봐줄지는 운영자가
바꾸고 싶어할 만한 비즈니스 결정이다). 반면 이 기준은 고정된 서브초 단위 내부 동작에
대한 레이스 가드일 뿐이다 — 이 코드베이스의 그 무엇도(테스트조차) 다른 값을 필요로
한 적이 없으므로, 실제 쓰임 없는 설정 표면 대신 `granted-cleanup.service.ts`의
`MIN_AGE_MS` 상수(1시간)로 둔다.

순수 선택기 `selectOrphanedGrantedFiles(candidates, knownFilePaths, now, minAgeMs)`가
`selectExpiredTempFiles`(ADR 0018)의 모양을 그대로 따른다 — DB나 파일시스템 없이
단위 테스트 가능하다; `minAgeMs`는 유일한 호출자가 상수를 넘기는데도 여전히 파라미터로
남아 있는데, 레이스 가드 경계 자체를 독립적으로 테스트 가능하게 두기 위해서다.

### D4 — dry-run 기본값 우선, ADR 0018의 기본값과 의도적으로 다르게

`GRANTED_SWEEP_DRY_RUN`은 기본값이 **`true`**다 — `TEMP_SWEEP_DRY_RUN`의 기본값
`false`와 정반대다. temp 파일 삭제는 오래 검증됐고 위험이 낮다(청구되지 않은 업로드는
다른 소유자나 참조가 없다). granted 파일 삭제는 새롭고, 여기서의 오탐은 실제 사용자가
영구 소유한 파일을 파괴한다 — CLAUDE.md Scope Discipline의 영구 삭제 경로 원칙("코드
작성 전에 연쇄 깊이를 설명하고 이 작업이 의도적으로 되돌릴 수 없음을 확인")과 같은
맥락에서, 이 훑기는 기본값으로 **리포트만** 한다: 일정대로 돌면서 후보를 계산하고
로그와 메트릭을 남기지만, 운영자가 그 신호를 한동안 지켜보고 명시적으로
`GRANTED_SWEEP_DRY_RUN=false`로 바꾸기 전까지는 `storage.unlink()`를 절대 호출하지
않는다. 코드 경로 하나가 두 모드를 다 담당한다 — "리포트만"에서 "실제 삭제"로 가는
데 필요한 건 플래그 하나 뒤집는 것뿐이다. `TempCleanupService.sweep()`이 이미 자기
dry-run 플래그로 분기하는 것과 같은 방식이다.

### D5 — 설정 (Joi + `.env.example`, `TEMP_SWEEP_*` 블록을 그대로 미러링)

- `GRANTED_SWEEP_ENABLED` (bool, 기본값 `true`)
- `GRANTED_SWEEP_CRON` (string, 기본값 `'0 3 * * *'` — 매시간이 아니라 매일: DB 조인은
  단순 `readdir`보다 무겁고, granted 파일 누출은 방치된 temp 업로드보다 훨씬 느리게 쌓인다)
- `GRANTED_SWEEP_DRY_RUN` (bool, 기본값 `true` — D4 참고)

(승격 레이스 나이 기준은 설정 변수가 아니라 `MIN_AGE_MS` 상수다 — D3 참고.)

`test/e2e-env.ts`에 `GRANTED_SWEEP_ENABLED = 'false'`를 추가한다 — `TEMP_SWEEP_ENABLED`가
거기서 꺼지는 이유와 동일하다: e2e는 진짜 DB로 부팅하므로 백그라운드 크론이 자기 픽스처와
경합해선 안 된다.

### D6 — 메트릭 ([ADR 0047](0047-observability-prometheus-grafana.ko.md) 확장)

**라벨 붙은 카운터 하나**, `granted_cleanup_sweep_total`(`labelNames: ['outcome']`) —
카운터 두 개가 **아니다**. 정정 전 초안은 `granted_cleanup_candidates_total`과
`granted_cleanup_deleted_total`을 별개 `Counter`로 등록해 `temp_cleanup_deleted_total`의
라벨 없는 모양을 따랐었다. 재검토 후 바꿨는데, `MetricsService`엔 이미 정확히 이 모양에
더 가까운 선례가 있었기 때문이다 — `upload_claims_total`은 하나의 이벤트에 여러 결과를
갖는 경우를 `outcome: 'fresh' | 'replayed'` 라벨 하나로 처리한다(`file.service.ts`). 이
작업도 같은 모양이다: 한 번 훑을 때마다(`sweep()` 한 번 실행) 찾은 고아 키마다 결과가 두 가지다 —
dry-run을 포함해 매 실행마다 `inc({ outcome: 'candidate' }, orphaned.length)`(리포트
우선 모드에서는 이 결과가 이 기능의 유일한 신호이므로 보이지 않으면 기본 모드는 눈
감고 출시하는 셈이다), 그리고 `storage.unlink()`가 실제로 실행됐을 때만
`inc({ outcome: 'deleted' }, deleted)`.

## 배제한 대안 (Alternatives rejected)

- **dry-run 없이 상시 자동삭제** — 바로 배제: 오탐은 실제 사용자가 소유한 파일에 대한
  되돌릴 수 없는 데이터 유실이고, 개발자에게 물었을 때 이 모드는 명시적으로 거부됐다.
- **온디맨드만, 크론 없음** — 가장 안전해 보여서 고려했지만, 예약 리포트 쪽을 택했다:
  누구도 지켜보지 않아도 안전하게 도는 리포트가 바로 dry-run 플래그를 뒤집기 전에
  필요한 신뢰를 쌓아 주고, 예약으로 노출하는 데 추가 비용이 들지 않는다.
- **전용 `GrantedCleanupModule`** — 이 ADR이 처음 제안했던 설계였으나 재검토 후 배제(D2):
  operational 모듈 선례(`TempCleanupModule`, `StorageModule`)는 자기 도메인 데이터가 없고
  여러 모듈이 공유하는 횡단 인프라를 위한 것이다. 이 훑기는 온전히 `FileModule` 자신의
  엔티티를 대조하는 일이라, 별도 모듈은 `FileModule`이 이미 가진 배선을 소비자 하나 없이
  중복시켰을 뿐이다.
- **`TempCleanupModule`에 합치기** — 배제(D2): 소임이 안 맞고, 굳이 필요 없는 DB 의존성을
  그 모듈에 얹게 된다.
- **DB 읽기를 `FileService`를 거치게 하기** — 배제(D2): `FileModule`이 명시한 두 메서드
  export 계약을 그 계약이 의도하지 않은 소비자를 위해 늘리는 셈이다.
- **`FileService.deleteFile`/`deleteFilesOfCreator` 안에 합성 검사를 넣고 별도로 훑는
  절차를 두지 않기** — 배제: 그 경로들은 이미 동기적으로, 커밋 직후 best-effort unlink를 하고
  있다. 이 ADR이 겨냥하는 누출은 정확히 그 시도가 이미 실패했거나 경합했던 경우들이다.
  나중에 따로 도는 재조회만이 그 인라인 시도가 이미 놓친 것을 잡아낼 수 있다.

## 결과 (Consequences)

- `FileStorage` 인터페이스에 `listGranted()`가 추가되고(`StorageTempEntry` 재사용),
  `LocalDiskStorage`와 `S3Storage` 둘 다 구현한다 — ADR 0029의 ISP 선례가 이어진다(공유
  포트 변경은 스텁이 아니라 항상 실제 구현 둘을 동반한다).
- 새 모듈 없음: `GrantedCleanupService`는 `FileModule` 안의 export하지 않는 provider다
  (D2); `AppModule`은 이 ADR로 바뀌지 않는다.
- 새 Joi 스키마 항목 + `.env.example` 항목 3개(D5 — `ENABLED`/`CRON`/`DRY_RUN`뿐;
  승격 레이스 나이 기준은 네 번째 환경변수가 아니라 코드 상수다); `test/e2e-env.ts`에
  한 줄 추가.
- 새 라벨 붙은 Prometheus 카운터 하나(D6), 다른 `MetricsService` 카운터와 동일하게
  스크랩된다 — 새 `ServiceMonitor` 설정은 필요 없다(ADR 0047이 이미 `/metrics`를
  커버한다).
- **기본 동작은 삭제 관점에서 무해하게 출시된다**: 운영자가 명시적으로
  `GRANTED_SWEEP_DRY_RUN=false`로 바꾸기 전까지, 이 ADR은 관측만 추가할 뿐 새 삭제
  경로를 추가하지 않는다 — 그 플래그를 실제로 뒤집었을 때 이 ADR의 라이브 검증
  과정에서 무슨 일이 있었는지는 아래 Addendum 참고.
- 같은 변경에서 CLAUDE.md도 갱신한다: 새 모듈 항목이 아니라 `FileModule` 아래에 붙는
  Module Responsibility 노트, 새 concern-to-entrypoint map 행, Architecture Decisions >
  File Storage 노트. ROADMAP.md의 "고아 `granted_` 파일 회수" 항목은 해결됨으로 표시하고
  여기로 연결한다.
- 잔여 사항, 수용함: 최소 나이 기준(D3)은 보장이 아니라 휴리스틱이다 — 극단적으로 느린
  `promote()` 호출(`MIN_AGE_MS` 상수를 훌쩍 넘기는)은 ADR 0018이 자기
  TTL 논리에서 이미 받아들인 것과 같은 좁은 창에서 여전히 고아로 오판될 수 있다.
  리포트 우선 모드에서는 이게 로그 한 줄과 카운터에만 영향을 주며, dry-run이 꺼지기
  전까지는 실제 삭제로 이어지지 않는다.

### 추가 기록 (Addendum) — 이 ADR을 라이브 검증하다가 실제 파일 44개를 지웠다

`GrantedCleanupService.sweep()`을 실제 DB·실제 디스크로, `GRANTED_SWEEP_DRY_RUN=false`로
끝까지 손으로 검증하는 작업을 이 저장소의 실제 `file/upload/`에 대해 돌렸다 — 이 ADR의
배경 절이 "44개 객체, 129MB"로 재보면서, 로컬 DB엔 대조할 이력이 없다고 적어뒀던 바로
그 디렉터리다. 그 공백은 위에 적었듯 *측정*을 무의미하게 만들었을 뿐 아니라, 그
디렉터리에 라이브 삭제를 돌리는 것 자체를 안전하지 않게 만들었다 — 당시 DB에
`file_entity` 행이 0개였으므로, 44개 객체 전부가 D3이 설명하는 바로 그 로직으로 고아로
읽혔고, `sweep()`은 정확히 그것들 전부를 지웠다. `file/upload/`는 git으로 추적된 적이
없음을 확인했고(`git ls-files -- file/upload` 결과 없음) `fs.unlink`는 휴지통을 거치지
않아서 복구 경로가 없었다 — 지워진 파일들이 버려도 되는 테스트 데이터였다는 건 나중에
개발자가 확인해 준 것이지, 검증을 진행한 방식이 안전했다는 뜻은 아니다.

이건 출시된 설계의 결함이 아니었다 — `GRANTED_SWEEP_DRY_RUN` 기본값 `true`가 실제
배포 환경에서 정확히 이런 일을 막는 안전장치다. 이 ADR의 배경 절이 스스로 문서화해둔
위험과, 라이브 삭제 경로를 호출하기 전에 검증 과정이 실제로 확인한 것 사이에 생긴
공백이었다. 격리된 샌드박스 디렉터리(스토리지 어댑터를 만들기 전에 `process.chdir()`)로
다시 진행한 두 번째 검증은 부작용 없이 깔끔하게 통과했다. 이 사고가 만들어낸 일반
규칙 — 스윕/회수 서비스를 이 저장소의 실제 `file/temp`/`file/upload`에 대고 라이브로
테스트하지 않는다 — 은 이제 [CLAUDE.md](../../CLAUDE.ko.md)의 Commands 아래에
기록되어 있어, 이 서비스뿐 아니라 앞으로 나올 어떤 스윕형 서비스에도 적용된다.
