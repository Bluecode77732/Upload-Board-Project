# ADR 0047: 관측 가능성 스택 — Prometheus와 Grafana

- Status: Accepted — 구현됨, 라이브 검증 완료(Addendum 참고)
- Date: 2026-08-28
- Extends: [ADR 0017](0017-logging-conventions.ko.md)
- English: [0047-observability-prometheus-grafana.md](0047-observability-prometheus-grafana.md)

## Context

[ROADMAP.md](../ROADMAP.ko.md) §6 Stage 4 "Production DevOps stack introduction" 컴포넌트
상태 표는 Prometheus와 Grafana를 모두 🆕(미착수)로, 각각 "own ADR (planned)"로 예고해뒀다.
표는 Prometheus를 "Nest `Logger` 관측가능성 스탠스 위에 얹는 메트릭 export 레이어"로
설명하는데, 이는 [ADR 0017](0017-logging-conventions.ko.md)을 직접 가리킨다 — 그 ADR은
Nest 내장 `Logger`를 Stage 1의 첫 관측가능성 증분으로 채택하면서 "구조화된 로깅과 외부
에러 트래킹은… 배포 환경이 생길 때까지(Stage 4) 명시적으로 유예한다"고 적어뒀다. 이
ADR이 바로 그 유예됐던 증분이다.

현재 격차를 조사한 결과: `HealthService`/`HealthController`
([ADR 0031](0031-health-and-readiness-endpoints.ko.md))는 이진 liveness/readiness
신호만 제공한다 — "프로세스가 살아있다", "DB에 연결된다"뿐, 요청 지연·처리량·에러율·
업로드 성공/실패 수, 혹은 자원이 고갈에 얼마나 가까운지는 전혀 말해주지 않는다.
`AllExceptionsFilter`의 로깅(ADR 0017)은 발생한 개별 실패를 기록하지만, 로그는 사건
하나의 기록일 뿐 추세가 아니다. `k8s/helm/values.yaml`의 `resources: {}`는 이미
CPU/메모리 limit을 정할 실측 기준선이 없다고 스스로 적어뒀다. `package.json`,
`k8s/helm/`, `docker-compose.yml` 어디에도 메트릭 라이브러리(`prom-client` 등)에 대한
언급이 없다 — 완전히 0에서 시작한다.

`k8s/infra/terraform/addons/main.tf`([ADR 0043](0043-terraform-project-adaptation.ko.md)/
[ADR 0044](0044-terraform-three-state-split.ko.md))는 이미 `aws-ia/eks-blueprints-addons`
Terraform 모듈을 호출해 AWS Load Balancer Controller와 External Secrets Operator를
설치하고 있다. 같은 모듈이 `enable_kube_prometheus_stack` 플래그도 제공하지만 아직
켜지 않은 상태였다.

위 격차와 별개로, 다른 메트릭/대시보드 조합이 아니라 **이 두 도구를** 구체적으로
선택한 동기는 구체적인 실무적 요인들에 있다 — 격차를 메운다는 이유 하나만은 아니다:
- **Prometheus**: 낮은 도입 비용(자체호스팅 가능, 라이선스 비용 없음), 얕은 학습
  곡선과 단순한 구현, 가벼운 실행 비용(런타임 부담), 타 도구 대비 압도적으로 높은
  점유율(D1 Addendum의 다운로드 수 비교로 직접 확인됨), 그리고 사실상의 업계
  표준 메트릭 도구라는 위상.
- **Grafana**: 범용 시각화 표준으로 자리매김했다는 위상이 주된 이유였고, 타 도구
  대비 동일하게 높은 점유율, 마찬가지로 얕은 학습 곡선과 가벼운 구현 비용, 그리고
  생소한 도구를 새로 익히는 대신 대부분의 팀이 이미 아는 도구를 채택함으로써
  얻는 비용 절감도 한몫했다.

## Decision

### D1 — 앱 레벨 메트릭 라이브러리: `prom-client` 직접 사용

`prom-client`를 직접 사용해, 기존 operational 모듈인 `HealthModule`
([ADR 0031](0031-health-and-readiness-endpoints.ko.md))·`TempCleanupModule`
([ADR 0018](0018-orphan-temp-file-cleanup.ko.md))과 같은 형태로 새 `MetricsModule`을
만든다 — 어떤 도메인 모듈에도 흡수시키지 않고, 프레임워크 전용 래퍼가 아닌 직접
의존성 주입으로 배선한다.

기각한 대안:

- **`@willsoto/nestjs-prometheus`** — `prom-client`를 감싼 데코레이터 기반의 두 번째
  의존성. 이 프로젝트의 기존 operational 모듈들은 이미 "최소 의존성 + 직접 DI"를
  하우스 스타일로 세워뒀고, 실제로 필요한 것도 범용 HTTP 히스토그램이 아니라 커스텀
  비즈니스 카운터(업로드 성공/실패, orphan 정리 sweep 횟수)라 — 데코레이터 래퍼가
  보일러플레이트를 줄이는 대가로 내주는 바로 그 유연성이 여기서는 필요하다.
- **앱 레벨 커스텀 메트릭 없이 인프라 전용(kube-state-metrics / node-exporter /
  cAdvisor)** — 코드 비용은 0이지만, 업로드 성공/실패율이나 클레임 재전송(replay)
  빈도 같은 애플리케이션 레벨 신호를 전혀 볼 수 없다. pod 단위 CPU/메모리와 인그레스
  단의 범용 HTTP 카운터만 남는다. Stage 4가 메우려는 바로 그 격차(Context)를
  메우지 못해 기각.

`prom-client`를 고른 이유는 셋 중 유일하게, 이 프로젝트의 운영 가능성이 실제로
요구하는 지표를 자유롭게 직접 구현할 수 있는 선택지이기 때문이다 — 데코레이터에
묶인 래퍼나 앱 내부를 아예 볼 수 없는 인프라 전용 방식보다 Stage 4가 명시한 목적에
더 직접적으로 부합한다.

### D2 — 배포 방식: 기존 `eks-blueprints-addons` 모듈을 통한 자체호스팅

`k8s/infra/terraform/addons/main.tf`의 기존 `module "eks_blueprints_addons"` 호출에
`enable_kube_prometheus_stack = true`를 추가한다 — 이미 ALB Controller
([ADR 0043](0043-terraform-project-adaptation.ko.md) D9)와 External Secrets Operator
([ADR 0033](0033-secrets-delivery-target.ko.md)/
[ADR 0043](0043-terraform-project-adaptation.ko.md) D7)를 제공하고 있는 바로 그
모듈이다. 이 플래그는 커뮤니티 `kube-prometheus-stack` Helm 차트(Prometheus
Operator, Prometheus, Grafana, Alertmanager)를 이 프로젝트 자신의 EKS 노드 위에
파드로 설치한다.

기각안: **Amazon Managed Prometheus(AMP) + Amazon Managed Grafana(AMG)**. 자체호스팅과
달리 메트릭 데이터 자체가 AWS 백엔드에 저장되는 진짜 AWS 관리형이며, ESO→Secrets
Manager 패턴과 결이 같다. 하지만 AMG는 이 프로젝트가 한 번도 필요로 한 적 없는
AWS SSO/IAM Identity Center 인증 체계를 요구하고, 메트릭을 AMP로 `remote_write`하려면
클러스터 내부에 별도 수집기(ADOT)가 여전히 필요하다 — 즉 관리형 경로도 클러스터
내부 설치를 피하지 못한 채, 자체호스팅이 이미 요구하는 것과 같은 클러스터 내부
수집 단계 위에 AWS 서비스 과금·새 IRSA 역할·새 인증 체계만 더 얹는 셈이다. 이
프로젝트 규모에는 움직이는 부품이 명백히 더 많아 기각.

앱 자신의 파드는 Prometheus Operator의 `ServiceMonitor` 커스텀 리소스로 스크레이프
대상이 되며, `k8s/helm/templates/servicemonitor.yaml`로 새로 추가한다 — 대상은
D1의 `/metrics` 엔드포인트다.

### D3 — 통합 ADR 1개, 분리 2개 아님

ROADMAP.md의 Stage 4 표는 Prometheus와 Grafana를 별도 행으로 나열하고 각각
"own ADR (planned)"로 예고해뒀지만, 이 ADR은 그 예고를 통합 기록 하나로 대체한다.

`kube-prometheus-stack`(D2)이 이미 두 컴포넌트를 Helm 릴리즈 하나로 함께 배포하므로
결정 단위 자체가 하나다. Grafana도 독자적으로 결정할 내용이 없다 — 유일하게
정당화된 데이터소스가 Prometheus뿐이라(ROADMAP 자신의 표현 그대로 "Prometheus
데이터소스 위의 대시보드/알림"), Prometheus가 먼저 정해지지 않으면 Grafana 단독
ADR은 스크레이프 대상·리텐션·수집 메커니즘 중 어느 것도 쓸 말이 없다.

### D4 — 검증 범위

이 작업은 `terraform validate`/`fmt -check`만으로 추론하지 않고, 2026-08-28 AWS
비용을 멈추기 위해 완전히 destroy됐던 세 Terraform 상태(`cluster`/`app-infra`/
`addons`, [ROADMAP.md](../ROADMAP.ko.md) §9)를 실제로 다시 올려서, Prometheus가
앱을 스크레이프하고 Grafana가 그 데이터를 렌더링하는지 라이브로 확인한다. 이로
인해 AWS 비용이 다시 발생한다는 점을 알고도 developer가 명시적으로 선택했다.

## Consequences

- 새 런타임 의존성: `prom-client`(`devDependencies`가 아닌 `dependencies` —
  2026-07-22에 정리된 `@nestjs/jwt` 선례를 따름).
- 새 모듈: `MetricsModule`, `/metrics` 엔드포인트를 노출. 그 가드/인증 방식은
  구현 시점의 결정 사항으로 의도적으로 여기서 정하지 않았다 — 다만 그 답과
  무관하게 어떤 메트릭 라벨/값에도 PII·비밀 정보가 담겨서는 안 된다(Never Do
  Group 3는 이 엔드포인트에도 그대로 적용).
- Terraform: `k8s/infra/terraform/addons/main.tf`의 `module "eks_blueprints_addons"`가
  플래그 1개를 새로 받는다. 새 Terraform 상태도, 그 파일이 이미 구성해둔 것 이상의
  새 provider 블록도 필요 없다.
- Helm: `k8s/helm/templates/`에 `ServiceMonitor` 템플릿을 새로 추가한다. 차트 자체는
  여전히 스크레이프 설정을 직접 갖지 않는다 — `ServiceMonitor`는 `kube-prometheus-stack`이
  제공하는 CRD를 소비하는 쪽이지, 직접 구축하는 쪽이 아니다.
- 비용: 기각된 AMP/AMG 경로와 달리 새 AWS 관리형 서비스 청구 항목은 없다 — 기존
  EKS 노드의 컴퓨트/스토리지 사용량만 Prometheus/Grafana/Alertmanager 파드만큼
  늘어난다.
- [ROADMAP.md](../ROADMAP.ko.md)의 Production DevOps stack 컴포넌트 상태 표(§6,
  Prometheus·Grafana 행)는 구현이 실제로 반영된 뒤, 다른 컴포넌트 행들(예: Terraform
  자신의 행)이 갱신됐던 방식과 동일하게 갱신돼야 한다.
- 이 ADR이 아직 하지 않은 것: `MetricsModule` 코드, `ServiceMonitor` 템플릿,
  Terraform 플래그 자체, 그리고 라이브 재기동 + 검증(D4) — 이 ADR은 결정을
  기록할 뿐이고, 후속 구현 태스크가 실제로 수행한다.

### Addendum (2026-08-29) — 지금은 `prom-client` 유지, 향후 재검토 트리거 기록

구현 도중 `pnpm add prom-client` 설치 로그에 npm deprecated 경고가 떴다. 추측하지
않고 직접 검증했다: `github.com/siimon/prom-client`는
`github.com/prometheus/client_js`로 301 리다이렉트되고, 메인테이너 본인의 GitHub
Discussion([prometheus/client_js#755](https://github.com/prometheus/client_js/discussions/755),
2026-07-01)에서 원저자(`siimon`)가 프로젝트를 Prometheus Project에 실제로
기증했음을 확인했다 — 별개 fork나 무관한 패키지가 아니다. 개명된 패키지
`@prometheus-io/client`는 이 Addendum 작성 닷새 전인 2026-08-24에 `0.16.0`으로
첫 배포됐고, 그 Discussion의 메인테이너 코멘트를 보면 2026-08-19까지도 npm 배포
파이프라인을 직접 디버깅하고 있었다.

D1의 선택이 바뀌어야 하는지 확인했다: `@prometheus-io/client` `0.16.0`
CHANGELOG가 적은 breaking change는 — Node 16/18/20/21/23 지원 중단(이 프로젝트는
Node ≥24 고정, [ADR 0014](0014-node-pnpm-version-pinning.ko.md)라 무관), 메트릭
내부 storage 구조 리팩터(서브클래싱 안 함, 무관), Counter Exemplar 값 표기
방식(Exemplar 미사용, 무관), `MetricType`이 숫자 enum에서 string union으로 바뀐
것(직접 참조 안 함, 무관) — 전부 `MetricsService`가 실제로 쓰는
`Registry`/`Counter`/`Histogram`/`collectDefaultMetrics` 표면과는 무관했다.

결정 전에 실무 채택 현황도 확인했다: `prom-client`는 주간 다운로드
9,206,303회, `@prometheus-io/client`는 7,157회(npm 다운로드 수 API,
2026-08-29 기준) — 약 1300:1이다. NestJS 생태계의 Prometheus 통합 패키지들
(`@willsoto/nestjs-prometheus`, `@miinded/nestjs-prometheus`, `nest-prom`)은
전부 여전히 `prom-client`에 의존 중이고, 그중 어느 것도 마이그레이션한 흔적을
찾지 못했다.

**결정: `prom-client`를 유지한다.** D1은 그대로 유지된다 — 여기서 열려 있던
질문은 패키지 이름뿐이었지, 이 기반 클라이언트 자체를 쓸지 말지가 아니었다.

**향후 재검토 트리거를 기록해둔다 — 나중에 이 논의를 처음부터 다시 하지
않도록**: 다음 둘 중 하나가 일어나면 재검토한다 — (a) `prom-client`의 npm
등록 정보에 명시적인 지원 종료/보안 패치 중단 시한이 붙거나, (b) 이
프로젝트가 실제로 고려할 만한 NestJS Prometheus 통합 패키지(D1에서 기각한
`@willsoto/nestjs-prometheus` 선례, 혹은 그에 준하는 패키지)가 자신의
의존성을 `@prometheus-io/client`로 옮기는 경우. 둘 중 하나라도 일어나면 이
Addendum을 쓴 시점의 "배포된 지 며칠 안 된" 상태를 벗어났다는 신호다.

### Addendum (2026-08-29/30) — D4 라이브 검증: 막혔다가 완료됨

재프로비저닝 자체는 끝까지 성공했다: `cluster`/`app-infra`/`addons` 전부 적용됨(NS
위임을 바로잡은 뒤 ACM도 검증 완료), `kube-prometheus-stack`은 `deployed`로 모든
파드가 `Running`, 앱 쪽 Helm 릴리스(이 ADR의 `ServiceMonitor` 템플릿을 담은 chart
`sharenpo-0.3.0`)도 `deployed`에 도달했다. Prometheus는 타겟을 잡았지만 상태가
`down`이었고 `lastError: "server returned HTTP status 404 Not Found"` — 직접 확인해도
`GET /metrics` → `Cannot GET /metrics`로 재현됐다.

근본 원인은 이 ADR 자신의 작업이 아니었다: 실행 중인 pod의 이미지
(`values-prod.yaml`에 고정된 `bluecode1775/sharenpo:db-ssl-ca`)가 `MetricsModule`이
생기기 전에 빌드된 것이었다. 이건 [ROADMAP.md §7](../ROADMAP.ko.md#7-미일정--미결-사항)에
이미 기록돼 있던 알려진 격차("`image.tag`… 조용히 옛날 코드를 배포함")가, 그 글이
다루지 않았던 변형(*고정* 태그조차 낡을 수 있다는 것, `latest` 기본값만의 문제가
아니라는 것)으로 재발한 것이다. 그 격차의 근본 원인을 고치는 건 이 ADR의 범위 밖이고
ROADMAP §7의 미결 사안(후보 세 가지, 여전히 개발자의 선택 대기)으로 그대로 남는다 —
D4 자체를 막힌 데서 풀기 위해서는 1회성 수동 이미지 빌드+푸시 +
`values-prod.yaml` 태그 갱신이면 충분했지, 그 격차를 고칠 필요는 없었다.

**D4는 이제 완료됐다.** `bluecode1775/sharenpo:2cd73b9`(이 ADR의 구현 커밋)를
새로 빌드·푸시하고 `helm upgrade`를 다시 실행한 뒤 직접 확인했다:
- `GET /metrics`(앱 pod) → `200`, exposition 본문 존재(기본 프로세스 지표 +
  `http_request_duration_seconds`가 수동 트래픽 없이도 kubelet 자신의
  liveness/readiness probe만으로 이미 채워져 있음).
- Prometheus: `up{job="upload-board"}` → `1`(타겟 정상); `temp_cleanup_deleted_total`
  → `0`(라벨 없는 카운터라 정리할 게 없어도 즉시 존재, 예상대로); 
  `sum(http_request_duration_seconds_count)` → `54`(0이 아님 — 단순히 엔드포인트가
  열려 있는 걸 넘어 실제 스크레이프가 쌓이고 있음을 확인).
- Grafana: `GET /api/datasources`에 정상 동작하는 `Prometheus` 데이터소스(+
  `Alertmanager`)가 나열됨 — `kube-prometheus-stack`의 자동 프로비저닝이 별도 수동
  설정 없이도 대시보드 계층을 같은 Prometheus 인스턴스에 연결해뒀음을 확인.

**후속 Grafana 점검 (2026-08-29, Playwright)**: 개발자가 Dashboards 페이지가 비어
보인다고 보고했다. 직접 로그인해서(`admin`/`prom-operator`, 차트 기본 계정) API와
렌더링된 UI를 둘 다 확인했다. `GET /api/folders` → `[]`(커스텀 폴더 없음 — 모든
대시보드가 루트 "General" 폴더에 있음), `GET /api/search?type=dash-db` → 17개
대시보드 전부 존재, 전부 `kube-prometheus-stack`이 프로비저닝한 기본값
(Alertmanager/Overview, CoreDNS, etcd, Grafana Overview, `Kubernetes / …` 계열
전체). "비어 보인" 원인은 "View by folders" 모드가 "General"을 기본적으로 접힌
행으로 렌더링하기 때문이었다 — 클릭해서 펼치니 17개가 전부 나타남(스크린샷으로
확인). 결함이 아니라 별도 조치 없음. 이는 위 D4 자체의 `up`/쿼리 확인을 넘어,
대시보드 프로비저닝 사이드카와 Prometheus 데이터소스 연결이 실제로 동작하고
있다는 독립적인 확인이기도 하다. 이 점검에서 드러난 진짜 빈틈 하나(오탐과는
별개로): 17개 기본 대시보드 어디에도 이 프로젝트 고유의 커스텀 시계열
(`upload_claims_total`, `temp_cleanup_deleted_total`,
`http_request_duration_seconds`)을 그래프로 그려주는 게 없다 — 지금은 Grafana의
Explore 탭에서 즉석 PromQL 쿼리로만 볼 수 있다. 이를 위한 대시보드 패널 구축은
애초에 이 ADR의 범위가 아니었다(Consequences에 이미 "커스텀 대시보드는 아직
없다"고 명시돼 있었다).
