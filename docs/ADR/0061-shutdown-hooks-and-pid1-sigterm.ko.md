# ADR 0061: 우아한 종료 — `enableShutdownHooks()`와 PID 1로 뜬 Node

- Status: Accepted — implemented, 로컬 Linux 컨테이너와 로컬 `kind` 클러스터에서 검증(EKS에서는 검증하지 않음); D3는 Addendum으로 뒤집힘
- Date: 2026-09-21
- Extends: [ADR 0030](0030-container-non-root-and-arch-stance.ko.md) — 이번 측정의 대상이 된 컨테이너 구성(non-root, `CMD ["node", "dist/main"]`). 그쪽은 바뀌는 것이 없다
- English: [0061-shutdown-hooks-and-pid1-sigterm.md](0061-shutdown-hooks-and-pid1-sigterm.md)

## Context

`backend/main.ts`는 `app.enableShutdownHooks()`를 한 번도 호출하지 않았다(`backend/`와
`test/`에서 grep 0건). CLAUDE.md의 Known Gaps가 2026-09-16에 이 사실을 기록하면서 다음
재배포 때로 미뤘다. 모든 쓰기가 요청 하나짜리 트랜잭션이라 갑자기 죽어도 데이터가 깨지지
않고(끊긴 연결은 Postgres가 롤백한다), 실제로 배포된 곳도 없어 영향을 줄 대상이 없다는
이유였다. 그 항목에는 "SIGTERM을 받으면 프로세스가 그냥 죽는다"는 문장도 있었다.

2026-09-21에 측정해 보니 마지막 문장은 틀렸고, 비용도 "풀이 깔끔하게 안 닫힌다" 수준이
아니었다. `53dd4a5`에서 빌드한 `production` 이미지(Docker Desktop 28.5.1, linux/amd64,
PID 1이 `node`, Compose 기본값에 맞춘 `--stop-timeout 10`)에서 `docker stop`이 10.4초
걸렸고 컨테이너는 137로 끝났다. Docker 이벤트 스트림에는 SIGTERM이 +0 ms, SIGKILL이
+10,014 ms에 찍혀 있다. 시그널 핸들러를 등록하지 않는 `--require` 프로브에는
`pg.Pool.end()` 호출도 `exit` 이벤트도 남지 않았다 — 프로세스는 종료 관련 코드를 하나도
실행하지 못했고, 스스로 빠져나오지도 못했다.

이유: `node`는 컨테이너 PID 네임스페이스의 init 프로세스이고, 이런 프로세스는 자신이
핸들러를 설치한 시그널만 받는다(`pid_namespaces(7)`). Node는 자체 SIGTERM/SIGINT 핸들러를
설치하지만 — 변경 전 `/proc/1/status`에서도 SIGTERM이 caught로 보인다 — Node 소스를 읽은
바로는 그 핸들러가 터미널 상태를 복구한 뒤 기본 처리 방식으로 시그널을 다시 보내고, init은
그 시그널을 버린다. 그래서 SIGTERM은 아무 효과가 없었고, 프로세스는 유예 시간이 끝나 버릴 수
없는 유일한 시그널인 SIGKILL이 올 때까지 살아 있었다.

Kubernetes에서도 PID 1 규칙은 같고 `k8s/helm/templates/deployment.yml`에는
`terminationGracePeriodSeconds`가 없으므로, 롤링 업데이트가 파드마다 기본값인 30초를 기다릴
것으로 본다. 다만 이건 추론이다 — 측정해 볼 배포가 없다.

## Decision

### D1 — `bootstrap()`에서 `app.listen()` 바로 앞에 `app.enableShutdownHooks()`를 호출한다

옵션 없이 기본 시그널로 그냥 호출한다. 이제 Nest가 SIGTERM/SIGINT(와 `ShutdownSignal`의
나머지)를 듣고 `OnModuleDestroy`/`BeforeApplicationShutdown`/`OnApplicationShutdown` 훅을
실행한다. 여기서 의미 있는 훅 두 개는 이미 있어서 코드를 더 쓸 필요가 없었다:
`TypeOrmCoreModule.onApplicationShutdown`(`dataSource.destroy()` — pg 풀을 닫는다)과
`@nestjs/schedule`의 `SchedulerOrchestrator.beforeApplicationShutdown`(`SchedulerRegistry`의
모든 잡을 삭제한다 — `TempCleanupService`/`GrantedCleanupService`가 `addCronJob`으로 등록한
두 개도 포함).

### D2 — `OnModuleDestroy`는 어디에도 추가하지 않는다

`app.close()` 뒤에도 남는 것이 있는지 후보마다 코드를 읽었다:

- 스윕 크론 두 개 — 위의 스케줄러 훅이 멈춘다.
- `ScanService` — `clamscan`을 `bypassTest: true`로 초기화하므로 `init()`이 연결을 열지
  않고, 스캔할 때마다 소켓을 열었다 닫는다.
- `S3Storage` — `S3Client`를 destroy하지 않는다. 실행해 보지는 않았다: `S3Storage`는 실제
  버킷에서 돌아본 적이 없고(ADR 0029), SDK의 keep-alive 소켓이 프로세스를 붙잡지는 않을
  것으로 본다 — 예상일 뿐 측정한 것이 아니다.

누수를 보여주는 것이 없어서 아무것도 추가하지 않았다. `STORAGE_DRIVER=s3`를 실제로 켤 때
다시 본다.

### D3 — plain 호출을 유지한다. `{ useProcessExit: true }`는 기록해 두는 대안이다

Nest의 정리는 `process.kill(process.pid, signal)`로 끝난다: 자기 리스너를 제거한 뒤 같은
시그널을 자기 자신에게 다시 보낸다. PID 1에서는 이 자기 전송 시그널도 다른 시그널처럼
버려지므로 아무 일도 일어나지 않는다. 프로세스가 빠져나가는 이유는 `app.close()`가 끝난
뒤 이벤트 루프가 비어서일 뿐이다 — 종료 코드가 143이 아니라 0인 것도 그래서다.

ref된 `setInterval` 하나를 추가한 프로브 변형(정리 후에도 남는 핸들을 대신하는 것)으로
측정했다: 훅은 그대로 실행됐지만(`pg.Pool.end()` 로그) 프로세스는 나가지 않았다 —
`docker stop`이 10,337 ms 걸렸고 137로 끝났다. plain 호출은 정리 후 이벤트 루프를 붙잡는
것이 없을 때에만 맞다.

이 조건을 없애 주는 옵션이 `enableShutdownHooks([], { useProcessExit: true })`다. 설치된
`@nestjs/core` 11.1.28에 있고, 정리 후 시그널을 다시 보내는 대신 `process.exit(0)`을
호출한다. 이건 측정하지 않았다(`NestApplicationContext.listenToShutdownSignals`를 읽어서는
결정적으로 동작한다).

채택하지 않은 이유: plain 형태가 보류 결정에서 말한 그 한 줄이고, 지금은 목표를 충족하며,
`process.exit`는 훅이 닫지 못한 것까지 끊어 버리고, 나중에 핸들이 새더라도 실패의 모습은
지금과 같은 10초/30초 뒤 SIGKILL일 뿐 더 나빠지지 않는다. 그런 일이 생기면 그때 옵션을
추가한다.

*같은 날 나중에 뒤집었다 — 맨 끝의 Addendum을 볼 것. 옵션을 측정해 보고 채택했다.*

## Consequences

절차와 `--stop-timeout 10`을 전부 같게 두고 측정했다:

| | `docker stop` | 종료 코드 | Docker가 보낸 시그널 | 프로브 |
|---|---|---|---|---|
| 변경 전 (`53dd4a5`) | 10,388 / 10,427 ms | 137 | SIGTERM +0, SIGKILL +10,014 ms | `Pool.end()` 없음, `exit` 없음 |
| 변경 후, plain 호출 | 439 / 324 ms | 0 | SIGTERM +0, 종료 +252 / +183 ms | `Pool.end()` 뒤 3 ms 만에 `exit` 코드 0 |
| 변경 후 + ref된 타이머 (실험) | 10,337 ms | 137 | SIGTERM +0, SIGKILL +10,015 ms | `Pool.end()`는 있고 `exit` 없음 |

- 이제 pg 풀을 애플리케이션이 직접 닫고, 컨테이너 종료가 유예 시간 전체가 아니라 0.5초
  미만으로 끝난다. Kubernetes의 롤링 업데이트와 스케일 인에서도 같을 것으로 본다 — 측정하지
  않았다.
- `pg_stat_activity`로는 변경 전후를 구별할 수 없다: SIGKILL된 프로세스의 소켓은 커널이
  닫아 주므로, 어느 쪽이든 측정 시점에는 연결 수가 0이다. 증거는 프로브의 `Pool.end()`
  로그다.
- e2e로는 검증할 수 없다: 거기서는 `app.close()`가 이미 훅을 실행하고(`teardownE2E`), 이번
  변경이 더하는 것은 시그널 리스너뿐이다. 실제 시그널이 필요해서 컨테이너에서 손으로
  확인했다. 자동화된 회귀 검사는 없다 — 회귀가 생기면 위 표의 ref된 타이머 행과 같은 모습일
  것이다.
- 측정하지 않은 것: 종료 중 처리 중인 요청, `S3Storage`, Kubernetes 자체.
- 측정 방법의 한계: 로컬 Docker만 사용했고, Compose `db` 서비스 안의 빈 일회용 데이터베이스를
  썼으며, 스윕은 껐고, 볼륨은 마운트하지 않았고, `STORAGE_DRIVER=local`이며, AWS 자격 증명은
  넘기지 않았다. 이 Docker Desktop은 stock 컨테이너에도 `StopTimeout=1`을 보고하므로
  `--stop-timeout 10`을 명시했다. 프로브는 일회용 preload였고 커밋하지 않았다.
- 스키마, Joi, `.env.example`, 가드, Swagger 변경은 없다.
- CLAUDE.md의 2026-09-16 Known Gaps 항목은 닫았고, "프로세스가 그냥 죽는다"는 문장은
  바로잡았다.

### Addendum (2026-09-21, 같은 날 나중에) — `useProcessExit: true` 채택, 로컬 `kind` 클러스터에서 검증

D3는 `useProcessExit: true`를 측정하지 않은 대안으로 남겨 뒀다. 측정해 보니 결론이 났고,
그래서 호출은 이제 `app.enableShutdownHooks([], { useProcessExit: true })`다. 이것이 D3의
결론과, 위 "측정하지 않은 것"의 "Kubernetes 자체" 항목을 대체한다(로컬 `kind` 클러스터는
이제 측정했고, EKS는 아직이다).

이미지와 프로브는 전부 같게 두고, plain과 옵션을 각각 ref된 타이머가 있을 때와 없을 때로
측정했다:

| | plain | `useProcessExit: true` |
|---|---|---|
| Docker, 정상 | 385 ms, 종료 코드 0 | 422 ms, 종료 코드 0 |
| Docker, 타이머 남김 | 10,400 ms, 137 (SIGKILL +10,033 ms) | 409 ms, 종료 코드 0 |
| `kind` 파드, 정상 | 1,187 ms, `exit` 이벤트 code 0 | 460 ms, code 0 |
| `kind` 파드, 타이머 남김 | 30,568 ms, `exit` 이벤트 없음(유예 시간 뒤 SIGKILL) | 412 ms, code 0 |

Docker 행은 `--stop-timeout 10`을 준 `docker stop`이다. `kind` 행은 `kubectl scale
--replicas=0`부터 파드 오브젝트가 사라질 때까지의 시간이라 kubectl과 kubelet의 오버헤드가
포함된다. 파드 스펙에는 `terminationGracePeriodSeconds: 30`이 있다 — 차트가 설정하지 않으므로
이는 Kubernetes 기본값이며, 가정한 것이 아니라 실행 중인 파드에서 읽어 확인했다.

바꾸는 이유: D3가 감수하기로 한 실패는 조용하고, 자동으로 잡아내는 것이 없다. plain은 이벤트
루프를 붙잡는 것이 하나라도 생기는 날 — `S3Storage`를 실제로 켜는 것이 가장 유력한 후보다 —
유예 시간 전체를 기다리는 방식으로 되돌아가고, 증상은 배포가 느려지는 것뿐이다. 옵션을 쓰면
종료가 그 조건에 의존하지 않는다. 옵션 행에서는 모두 프로브가 `exit` 이벤트보다 먼저
`pg.Pool.end()`를 기록했으므로, 풀 닫기와 크론 정지는 여전히 먼저 실행된다.

감수하는 비용: `process.exit(0)`는 열린 핸들이 남아 있어도 프로세스를 끝내므로, 핸들 누수가
더는 느린 종료로 드러나지 않는다. 종료 코드도 항상 0이다(Kubernetes는 신경 쓰지 않는다).

측정 방법: `kind` v0.27.0(Kubernetes v1.32.2)을 전용 kubeconfig 파일로 띄워 `kubectl`/`helm`에
실제 클러스터 컨텍스트가 아예 보이지 않게 했고, HEAD의 `k8s/helm` 차트를 `helm install`로
설치했다(마이그레이션 hook 포함, `clamav`는 설치 후 0으로 내렸다 — 차트에 끄는 스위치가
없다). Postgres 파드는 일회용, 시크릿은 생성한 값, 이미지는 로컬에서 빌드해 `kind load`로
넣었다. 프로브는 ConfigMap으로 마운트하고 `NODE_OPTIONS`로 켰다. 종료된 컨테이너의 종료
코드는 읽어 오지 못했다 — kubelet이 이미 가비지 컬렉션한 뒤였다 — 그래서 프로브의 `exit`
이벤트로 대신했다: 있으면 프로세스가 스스로 나간 것이고, 없으면 SIGKILL이다.

여전히 측정하지 않은 것: EKS와 ALB의 연결 드레이닝, 종료 중 처리 중인 요청, `S3Storage`.
