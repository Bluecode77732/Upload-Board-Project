# ADR 0061: 우아한 종료 — `enableShutdownHooks()`와 PID 1로 뜬 Node

- Status: Accepted — implemented, 로컬 Linux 컨테이너와 로컬 `kind` 클러스터, 그리고(2026-09-29) 라이브 EKS에서 검증; D3는 Addendum으로 뒤집힘
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

여전히 측정하지 않은 것: EKS와 ALB, 종료 중 처리 중인 요청. 라이브 클러스터가 필요한 점검
두 가지 — 운영 값(`STORAGE_DRIVER=s3`)에서 파드가 1~2초 안에 `Terminating`을 벗어나는지,
롤링 업데이트 중 ALB가 `502`/`503`/`504`를 내지 않는지 — 는 `k8s/helm/README.md`의
"Enabling HTTPS (Ingress)" 아래 미해결 점검 목록에 통과 기준과 함께 있다. 실패할 가능성이 높은
쪽은 두 번째다: 이번 변경 전에는 파드가 SIGTERM을 무시하고 SIGKILL까지 계속 돌았는데, 이것이
(추론일 뿐 측정한 것은 아니지만) 우연히 ALB의 등록 해제 지연보다 길었을 것이다. 이제는 1초 안에
종료하므로 그 지연 동안 라우팅된 요청이 거절될 수 있다. 아래 Addendum이 `S3Storage`는 닫았고
`preStop` 처방의 메커니즘도 시험했지만, 실제 ALB로는 아니다.

### Addendum (2026-09-22) — `S3Storage`와 `preStop` 메커니즘을 따로 떼어 시험

위 "여전히 측정하지 않은 것" 중 두 가지는 라이브 클러스터나 실제 AWS 접근 없이도 바로
시험할 수 있는 것으로 드러났다.

**`S3Storage`의 `S3Client`.** `@aws-sdk/client-s3`의 기본 request handler는 agent를
`new https.Agent({ keepAlive: true, maxSockets, ... })`로 만든다 — `@smithy/node-http-handler`의
번들된 소스를 읽어 확인했지 추측이 아니다. `keepAlive` agent는 응답이 끝난 뒤에도 소켓을 풀에
ref된 채로 남겨 두는데, 이게 정확히 D2가 미확인으로 남겨 둔 핸들의 모양이다. Docker만 쓴
프로브로 이 메커니즘을 평범한 `http.Agent({ keepAlive: true })`와 로컬 서버로 재현했다(TLS도
AWS 네트워크도 자격 증명도 없다) — 소켓은 일부러 닫지 않고 열어 뒀다: `docker stop`은 여전히
386 ms, 종료 코드 0, `pg.Pool.end()`와 `exit` 이벤트 모두 예상대로 찍혔다. 첫 Addendum의
ref된 타이머 결과를 `S3Client`가 실제로 쓰는 구체적인 핸들 모양으로 일반화한 셈이다 — D2의
"`STORAGE_DRIVER=s3`를 실제로 켤 때 다시 확인"은 종료 속도 면에서는 닫혔다. 시험하지 않은 것:
실제 `S3Client` 인스턴스나 S3로의 진짜 요청.

**`preStop`/`terminationGracePeriodSeconds` 메커니즘.** 앞과 같은 로컬 `kind` 클러스터에서
`kubectl patch`로 돌고 있는 Deployment에 `lifecycle.preStop.exec`와
`terminationGracePeriodSeconds`를 얹었다(차트에는 커밋하지 않았다 — 특정 값을 정하려는 게
아니라 메커니즘 자체를 보려는 것이다). 두 번 실행하고 `kubectl get events -o json`과 절대
시각을 남기는 프로브를 맞대조했다:

- **유예가 sleep을 다 덮는 경우**(`preStop: sleep 5`, 유예 35초): scale-down부터 파드가
  사라지기까지 5.7초 걸렸다. SIGTERM은 sleep이 끝난 뒤에야 왔고, 그 뒤 앱은 1초도 안 돼
  종료했다 — ADR의 Pending 메모가 전제했던 메커니즘 그대로였다.
- **유예가 sleep보다 짧은 경우**(`preStop: sleep 40`, 유예는 여전히 35초 — 일부러 부족하게
  뒀다): `FailedPreStopHook`이 정확히 유예 35초 경계에서 떴고, kubelet은 **바로 그 순간**
  (프로브 자체 타임스탬프로 10 ms 뒤) 메인 프로세스에 SIGTERM을 보냈다 — 아예 안 보낸 게
  아니었다. 앱은 그래도 깔끔하게 종료했다 — `pg.Pool.end()`, 그다음 종료 코드 0 — 그로부터
  약 0.5초 뒤. 파드가 사라지기까지 총 36.4초로, (끝내 완료되지 못한) preStop이 원래 쓰인
  5초가 아니라 유예 시간 전체에 가까웠다.

이건 위 문단과 `k8s/helm/README.md`의 미해결 점검 목록이 측정 전에 적어 뒀던 추론을
정정한다: 적어도 이 `kind`/containerd 조합에서는, 부족한 `terminationGracePeriodSeconds`가
비용을 치르는 지점은 앱이 지저분하게 SIGKILL당하는 게 아니라 배포 *시간*이었다(롤아웃이 유예
시간 전체를 기다린다) — kubelet이 막힌 hook을 포기하는 순간에도 SIGTERM은 여전히 보냈고,
앱이 그걸 받아 챌 만큼 빨랐기 때문이다. EKS의 containerd도 똑같이 동작하는지, 그리고 —
진짜 열려 있는 질문인 — ALB가 (얼마나 길든) 유예 시간이 다 끝나기 전에 그 파드로의 라우팅을
먼저 멈추는지는 둘 다 아직 확인하지 못했다. 이 ADR의 다른 측정에 쓴 `docker stop`의 유예/
SIGKILL 방식에는 `preStop`에 대응하는 게 없어서, 이 두 시나리오는 `kind`에서만 돌려볼 수
있었다.

### Addendum (2026-09-29) — 라이브 EKS: 파드 종료 속도는 빠름을 확인, ALB 레이스는 두 번 재현 — `preStop` sleep을 제안만 하고 채택은 안 함

라이브 클러스터에서 `kubectl rollout restart deployment/sharenpo`를 두 번 돌렸다(차트 `0.5.1`,
레플리카 1개, `maxSurge: 25%`/`maxUnavailable: 25%` → surge 우선: 새 파드가 먼저 뜬 뒤에야 옛
파드가 죽는다). 각 회차마다 세 가지 독립된 측정을 동시에 돌렸다 — 초당 1회
`curl -s -o /dev/null -w '%{http_code}' https://sharenpo.cloud/file`(토큰 없음, `401` 예상,
UTC 타임스탬프 기록), 백엔드 타깃 그룹(`k8s-default-sharenpo-60fc9d48fc`)을 약 3초마다 조회하는
`aws elbv2 describe-target-health`, 그리고 끝난 뒤 읽은
`kubectl get events --sort-by=.lastTimestamp`.

**파드 종료 속도 — "1~2초" 미해결 항목, 이전엔 `kind`에서만 확인.** 두 회차 모두 옛 파드의
`Killing`과 `SuccessfulDelete` 이벤트가 *같은 초*에 찍혔고(`2026-09-29T16:15:00Z`,
`...T16:17:38Z`), 몇 초 뒤 돌린 `kubectl get pod <옛-이름>`은 이미 `NotFound`였다. Kubernetes
이벤트는 초 단위까지만 찍히므로 `kind`의 `0.4초`라는 소수점 수치를 그대로 재현하진 못했지만,
이 미해결 항목이 우려하던 실패 형태 — 기본 유예 30초 근처까지 `Terminating`에 머무는 파드 —
는 확실히 아니었다. EKS도 `kind`와 마찬가지로 빠르다.

**ALB 레이스 — 한 번이 아니라 재현됨.** 두 회차 모두 `401`이 아닌 응답이 정확히 하나씩
나왔는데, 둘 다 curl `000`이었다(HTTP 응답 자체가 없음 — 거부되거나 리셋됨 — ALB나 앱이
냈을 `502`/`503`/`504`가 아니다):

| 회차 | `Killing` 이벤트(UTC) | curl `000`(UTC) | 타깃 헬스 전환 첫 관측 |
|---|---|---|---|
| 1 | `16:15:00` | `16:15:00.448` | `16:15:00.948`: 옛 타깃 `draining`/`DeregistrationInProgress`, 새 타깃 `initial`/`RegistrationInProgress` |
| 2 | `16:17:38` | `16:17:39.281` | `16:17:41.321`: 옛 타깃 `draining`/`DeregistrationInProgress`(조회 간격 약 3.1초라 실제 전환은 더 일렀을 수 있음) |

나머지 샘플은 전부 `401`로 깨끗했다(1회차 21개 중 19개, 2회차 10개 중 9개). 각 회차의 유일한
실패는 `Killing`에서 약 1초 안, 그리고 타깃 헬스 API가 `draining`을 처음 보고하는 시점과
같거나 그 직전에 몰려 있다 — 위 2026-09-22 추가 기록이 진짜 열려 있는 질문으로 남겨 둔
메커니즘과 맞아떨어진다: 파드가 연결을 안 받기 시작하는 시점(SIGTERM → 앱 자신의 빠른 종료,
D1/D3)이 ALB의 등록 해제 전파보다 먼저라서, 그 틈에 도착한 요청이 다른 곳으로 돌려지지 못하고
거부된다는 것. 이건 surge 우선 경로에서 나온 결과다 — 새 파드는 옛 파드가 죽기 전에 이미
`Running`이었으므로(회차마다 부팅 중 예상된 `Unhealthy` readiness probe 이벤트 1건 포함),
틈은 "아직 타깃이 없어서"가 아니라 등록 해제 쪽에 있다.

**개발자에게 제안만 함, 구현하지 않음.** 백엔드 컨테이너에 ALB 등록 해제 전파가 끝날 때까지
파드가 계속 서비스하도록 붙잡아 두는 `preStop` sleep과, 그걸 넉넉히 덮도록 올린
`terminationGracePeriodSeconds` — 2026-09-22 추가 기록이 이미 따로 떼어 검증해 둔 바로 그
메커니즘이다(`preStop: sleep 5` + 유예 35초: pod-gone까지 5.7초, sleep이 끝날 때까지 SIGTERM
보류). 이번 세션의 측정은 EKS에서 그 메커니즘이 덮어야 할 구간을 좁혀 준다 — 두 번의 실제
실패 모두 `Killing`으로부터 대략 1~3초 안에 `draining`으로 전환됐으니, `kind`에서 이미
검증된 것과 같은 `sleep 5`면 여기서도 이 틈을 막을 것으로 보인다 — 다만 샘플 두 개로는 꼬리
분포까지 보장 못 하고, 차트에는 아직 두 설정 다 없다. 채택 여부는 개발자의 몫이고, 채택하려면
`values-prod.yaml`/`values.yaml` 변경과 함께 같은 방식의 계측 롤아웃을 여러 번 다시 돌려
`000`/`502`/`503`/`504`가 전부 0인 걸 확인해야 — 좁혀진 게 아니라 닫힌 항목이 된다.
