# ADR 0069: 사용자·관리자 흐름 전체를 k6로 500 VU 이상까지 부하 시험한다

- 상태: 제안됨 — Phase 1 구현(도구, seed, 10 VU 스모크). 부하 단계는 아직 실행하지 않았다
- 날짜: 2026-11-19
- 개정 대상: [ADR 0049](0049-performance-capacity-criteria.ko.md) D2(k6를 검토하고 기각했다)
- English: [0069-k6-load-testing.md](0069-k6-load-testing.md)

## 배경

ADR 0049는 autocannon으로 고정 요청 8개를 동시연결 20, 10초씩 측정했다. 로그인한 사용자 한 명이
엔드포인트 하나씩을 두드린 셈이다. 그 방식으로는 "10^4 행에서 이 쿼리가 빠른가"에는 답할 수 있지만,
수백 명이 동시에 쓸 때 앱이 어떻게 버티는지는 알 수 없다. 실제 사용자는 180초마다 만료되는 세션을
httpOnly 쿠키로 갱신하고, 읽기와 쓰기를 섞고, ClamAV 검사를 거쳐 업로드한다. 어떤 흐름은 두 계정이
번갈아 움직여야 한다. 파일 이전은 소유자가 제안하고, 수락이나 거절은 대상 본인만 할 수 있다(ADR 0050 D4).

ADR 0049 D2는 k6를 기각했다. pnpm 툴체인 밖의 독립 바이너리이고, 당시 측정하던 엔드포인트 모양에는
필요 없다는 이유였다. 두 번째 이유는 이번 질문에는 더 이상 맞지 않는다. autocannon은 한 번 실행에 미리
만든 요청 하나를 반복할 뿐이고, 사용자별 상태도, 쿠키 jar도, 여러 단계로 이어지는 흐름도 없다.

이번 작업을 준비하다 기존 `perf/load-test.js`의 결함 두 가지도 찾았다. PASS/FAIL을 지연만 보고 정해서
빨리 끝나는 403도 통과로 셌다. 또 쓰기 대상인 `perf-file-000001-trip`은 로그인한 측정 계정이 아닌 다른
seed 사용자의 파일이라, 그 벤치마크의 `PATCH`는 모두 403 `FORBIDDEN_NOT_OWNER`였다(2026-11-19에 새로
seed한 DB로 확인). 헤더는 존재하지 않는 `perf/README`를 가리키고 있었다.

## 결정

### D1 — 여러 단계 흐름은 k6로, ADR 0049의 고정 기준선은 autocannon으로 계속 잰다

k6는 Docker 이미지 `grafana/k6:2.3.0`(2026-09-21 출시)으로 실행한다. 2.4.0은 2026-11-12에 나와 이
결정 시점에 2주가 되지 않아 쓰지 않았다. k6 라이선스는 AGPL-3.0이다. 앱과는 HTTP로만 통신하는 별도
프로세스로 돌리고, `package.json`에 넣거나 번들하거나 배포물에 싣지 않으므로 라이선스가 앱까지 미치지
않는다. 스크립트는 `perf/k6/`에 둔다.

### D2 — 부하 구성: VU마다 전용 계정, 고정 비율, 사람 같은 think time

- 계정: VU `n`(n = 1..2000)은 `perf-vu-n`을 쓰고, 이전의 수락·거절 쪽을 맡을 파트너 `perf-partner-n`을
  VU마다 하나씩 둔다. 계정 하나는 세션 하나만 가진다(ADR 0012). 두 VU가 한 계정을 나눠 쓰면 서로의
  refresh 토큰을 계속 무효로 만든다. `perf-vu-0`은 `setup()` 전용이며, 일반 사용자가 보는 것만 보도록
  user role로 둔다. role은 VU 1이 superadmin, 50번째 VU마다 admin이라 50 VU부터는 모든 단계에 관리자
  요청이 섞인다.
- VU마다 시드된 private 파일 하나(디스크에 1KB)를 가지고, 공개범위 변경, unlisted 공유 토큰 조회, 이전
  왕복에 쓴다. 이전이 중간에 끊기면 다음 파일 동작을 시작할 때 고친다. 걸린 이전은 취소하고, 파트너가
  가져간 파일은 파트너가 되돌려 준다.
- iteration당 비율: 둘러보기 70(목록, 검색, 정렬, `creatorId`, 상세, 댓글 스레드, 익명 공개 콘텐츠, 자기
  정보), 쓰기 20(글·댓글 CRUD, 각각 최대 5개 유지, 공개범위와 공유 토큰), 업로드 5(attach → `POST /file`,
  가끔 같은 filename을 다시 보내 replay 200 확인, 절반은 삭제), 계정·이전·관리자 5(refresh,
  signout → signin, 자기 정보 `PATCH`, 이메일 조회, 이전 수락·거절·취소, 가입 → 자기 계정 삭제. admin은
  사용자 목록과 감사 로그를 보고, superadmin은 파트너의 role을 바꾼다).
- iteration 사이에 0.5~1.5초를 무작위로 쉬어, VU 수를 동시 사용자 수로 읽을 수 있게 한다. 쉬지 않으면
  500 VU는 500명이 아니라 앱이 버틸 수 있는 요청 속도를 뜻하게 된다.
- 요청 타임아웃은 30초로 명시한다(k6 기본값은 60초). 업로드 본문이 1x1 JPEG이라 30초가 정상 소요
  시간일 수는 없다.

### D3 — 모든 응답을 계획과 맞춰 분류한다

요청마다 계획이 붙는다. 성공으로 받을 상태 코드와, 설계상 거절로 받을 `ErrorCode` 목록이다. 여기서
카운터 세 개가 나온다.

- `designed_rejection{code}` — API가 명세대로 거절했다(예: `AUTH_EMAIL_TAKEN`, 회전된 공유 토큰의
  `FILE_SHARE_INVALID`, `FILE_TRANSFER_INVALID_TARGET`). 이 중 일부는 일부러 보내, 건수로 그 경로가
  동작함을 보인다.
- `unexpected_failure{type}` — `timeout`, `connection`(status 0), `internal_error`, `no_code_5xx`,
  `server_error`.
- `unplanned_response{endpoint}` — 그 밖의 모든 상태. 계획에 없는 코드가 붙은 4xx도 여기 들어간다.

`ErrorCode` 목록은 스크립트가 시작할 때 `backend/common/error-code.ts`에서 읽으므로 코드와 어긋날 수
없다. `unexpected_failure`와 `unplanned_response`가 둘 다 0이어야 통과다. id가 들어간 URL은 고정된
`tags.name`으로 묶어 지표 수가 늘어나지 않게 한다.

### D4 — 실행 방식

- 한 번 실행에 VU 수준 하나(`TARGET_VUS`, `RAMP`, `HOLD`). 수준마다 3분을 유지한다. 액세스 토큰 수명
  180초보다 길어서 refresh 경로도 부하에 들어간다. 한 번의 ramping 실행은 수준 사이에서 멈출 수 없어
  기각했다.
- 회복: 부하 실행 직후 10 VU로 60초를 돌린다. 그 p95가 스모크 p95의 2배 이하면 통과다.
- 부하 실행 중에는 throttle을 끈다(`THROTTLE_ENABLED=false`). 모든 VU가 같은 호스트에서 나가므로 IP별
  한도(ADR 0053/0054)가 켜져 있으면 throttle을 시험하는 꼴이 된다. 한도 자체는
  `perf/k6/throttle.js`가 따로 확인한다. 1분 안의 6번째 signin과 101번째 `GET /file`은 429
  `RATE_LIMITED`여야 한다.
- 격리: compose의 `db`/`clamav` 대신 전용 일회용 컨테이너(5436의 `postgres:16`, 3311의
  `clamav/clamav:stable`)를 쓴다. compose는 `.env`를 읽고 dev DB 볼륨을 만들기 때문이다. 앱, migration,
  seed는 저장소 밖 샌드박스 디렉터리에서 새로 만든 시크릿으로 실행해, 저장소의 `.env`와 `file/`
  디렉터리를 읽지도 쓰지도 않는다. 명령은 `perf/README.ko.md`에 있다.

### 기각한 대안

- **autocannon 확장**: 사용자별 상태, 쿠키, 여러 단계 흐름이 없어 모두 바깥에서 직접 짜야 한다.
- **VU마다 파트너를 두지 않고 공용 파트너 풀 사용**: 공용 계정의 세션끼리 충돌한다(계정당 세션 하나).
  수락·거절을 빼면 계정 수는 절반이 되지만, ADR 0050의 동의 쪽 경로가 부하에서 빠진다.
- **호스트에 설치한 k6 바이너리 사용**: 이 PC에 설치돼 있지 않고, 고정한 이미지를 써야 버전이
  재현된다.

ADR 0049가 함께 기각한 Artillery는 다시 검토하지 않았다.

## 결과

- 새 pnpm 의존성은 없다. 새 파일은 `perf/k6/load.js`, `perf/k6/throttle.js`, `perf/README.md`
  (+ `.ko.md`)다. `perf/seed.js`는 계정 4,001개와 파일 2,000개를 더 넣으며, 여전히 현재 디렉터리 안에만
  쓴다.
- `perf/load-test.js`는 `non2xx`, `errors`, `timeouts` 중 하나라도 0이 아니면 `FAIL`을 찍는다. 측정
  대상은 측정 계정이 소유한 public 파일 `perf-file-000000-holiday`이고, 쓰기는 `{ visibility: 'public' }`
  PATCH로 잰다(public 파일에 보내는 멱등 쓰기다. 같은 제목 PATCH는 아래 수정 전까지 거절됐다). 고친 뒤 8개
  벤치마크가 모두 통과했고, 성공 경로를 탄 쓰기는 p50 28 ms, p97.5 60 ms였다. 그러므로 ADR 0049 D3 표의 `PATCH /file/:id`
  행(16/19 ms)은 쓰기가 아니라 403 경로를 잰 값이다. 두 스크립트는 그 ADR의 커밋(`a4c1261`) 이후 바뀐
  적이 없고, 파일 소유자 검사는 그보다 먼저(2026-07-24) 들어갔다. 그 표는 쓰인 그대로 둔다.
- 스모크 결과(10 VU, 램프 10초 + 2분, 2026-11-19): 요청 1,568건(초당 11.9건), 예상 밖 실패 0건, 계획 밖
  응답 0건. 설계된 거절은 `FILE_SHARE_INVALID` 15건, `FILE_TRANSFER_INVALID_TARGET` 2건,
  `FILE_NO_PENDING_TRANSFER` 2건, `AUTH_EMAIL_TAKEN` 1건이다. ADR 0049의 모든 tier가 목표 안이었다(p95: 목록
  11.9, 상세 4.9, 콘텐츠 16.4, 쓰기 12.0 ms). 계획한 엔드포인트 32개 중 31개를 탔다. `GET /audit-log`는
  admin VU가 있어야 하는데, 첫 admin VU가 VU 50이다. refresh 11건은 모두 성공했다. 스모크 직후 회복 모드로
  60초를 돌린 결과 p95 13.6 ms로 기준 31.0 ms 안이었다(PASS). 3 VU로 190초를 돌려 토큰 나이에 따른
  refresh가 동작함을 확인했고(refresh 3건, 실패 0건), `throttle.js`로 6번째 signin과 101번째
  `GET /file`이 설계대로 429 `RATE_LIMITED`로 거절됨을 확인했다.
- 검증하다 찾은 것:
  - **커넥션 풀 교착 — 같은 날 고쳤다.** `FileService.uploadFile`과 `updateFile`은 트랜잭션 내내 QueryRunner 연결 하나를
    쥐고, 그 안에서 제목 중복 검사를 `this.fileRepository`, 즉 풀의 다른 연결로 한다(`uploadFile`은
    rollback 뒤 `release()` 전에 `findClaim`도 부른다). 기본 풀 크기가 10이라, 이 경로의 요청이 동시에
    10개면 각자 연결 하나를 쥔 채 11번째를 기다리고, 어디에도 타임아웃이 없다. 두 번 재현했다. 같은
    제목 PATCH 20개 동시(autocannon), `POST /file` 승격 20개 동시. 모두 멈췄고, `GET /health/ready`가
    응답하지 않았으며, `pg_stat_activity`에 `idle in transaction` 세션 10개가 남았고, 재시작해야만
    풀렸다. `GET /health/live`는 DB를 보지 않으므로 liveness probe는 아무것도 처리하지 못하는 pod를 계속
    살려 둔다. 제목 검사를 타지 않는 visibility PATCH 20개 동시는 멈추지 않았다. 이제 세 읽기를
    `queryRunner.manager`로 해서 트랜잭션 하나가 연결 하나만 쥔다. 고친 빌드로 같은 20건 동시 실행을
    다시 하자 `POST /file`은 201 20건, 제목 PATCH는 200 20건, replay는 200 20건이었고, `/health/ready`는
    살아 있었으며 `idle in transaction` 세션은 남지 않았다. 같은 파일명 20건 동시 제출은 201 1건과 200
    19건, 같은 제목 20건은 201 1건과 400 `FILE_TITLE_TAKEN` 19건이었다. 풀에는 여전히 연결 획득
    타임아웃이 없어서(CLAUDE.md > Known gaps, 2026-10-12 검토), 같은 모양의 읽기가 새로 생기면 똑같이
    멈춘다.
  - **같은 제목 PATCH가 거절됐다 — 같은 날 고쳤다.** 이것을 의도로 기록한 ADR, 테스트, 문서는 없었고(이
    검사는 2025-12-19 `283e9ab`에서 다른 파일과의 제목 충돌을 막으려고 들어왔다), 프론트엔드는 파일 제목을
    PATCH하지 않는다. 이제 검사가 수정 대상 행 자신은 충돌로 보지 않는다. `updateFile`의 중복 검사가 수정 대상 행 자신을 빼지 않아서,
    `PATCH /file/:id { title: <현재 제목> }`이 400 `FILE_TITLE_TAKEN`으로 답한다.
- 받아들인 한계: k6, 앱, Postgres, ClamAV가 Docker Desktop 아래 Windows PC 한 대를 나눠 쓴다. 그래서
  절대 수치는 EKS에 대해 말해 주는 것이 거의 없고, 의미 있는 결과는 수준 간 비교다. 앱 프로세스는
  하나이고, `STORAGE_DRIVER=local`이며, throttle은 꺼져 있다. k6 문서는 쿠키 jar가 `SameSite`를 어떻게
  다루는지 적고 있지 않다. 스모크에서 refresh가 성공한 것으로 `SameSite=Strict`, `Path=/auth/token` 쿠키가
  실제로 전송됨을 확인했다.
- 부하 단계(Phase 2)는 아직 실행하지 않았고, 실행하면 결과를 여기에 적는다.
