# ADR 0037: Helm 차트 — 스캐폴딩만 랜딩, 아직 이 프로젝트 전용은 아님

- 상태: 승인됨 (스캐폴딩 상태 — 지금 그대로는 배포 불가)
- 날짜: 2026-08-11
- 관련: [ADR 0038](0038-terraform-iac-scaffold.ko.md) (Terraform 쪽도 같은 상황)
- English: [0037-helm-chart-scaffold.md](0037-helm-chart-scaffold.md)

## 배경

Stage 4 "프로덕션 DevOps 스택 도입" 행(ROADMAP.md §6)은 여덟 컴포넌트 중 하나로
Helm을 지목한다 — `k8s/` 매니페스트를 릴리스 패키징/템플릿화하기 위해서다. 커밋
`ee75900`("Adopt: Helm")이 `helm/upload-board-project/`를 추가했는데, CHANGELOG
항목도 ROADMAP 상태표 갱신도 ADR도 없이 랜딩됐다 — Stage 4의 다른 모든 컴포넌트
(Docker, health 엔드포인트, migration-as-deploy-step, storage port-adapter,
Kubernetes 매니페스트)가 각자 하나씩 남긴 관행을 깬 것이다. 이 ADR은 그 문서
공백을 메우고, 랜딩된 차트가 실제로 무엇인지 있는 그대로 기록한다.

차트를 직접 열어보면: `Chart.yaml`의 `description` 필드는 "A Helm chart for
Kubernetes"라고만 돼 있다 — `helm create`가 자동 생성하는 기본 문구 그대로,
한 번도 고친 적이 없다. `values.yaml`의 `image.repository`는 `nginx`(태그
`1.21`)다 — 이 프로젝트 자신의 이미지(`bluecode1775/sharenpo`, 이후 커밋
`1b72ec9`의 `docker-publish` CI 잡이 게시)가 아니다. `templates/`에는
`deployment.yml` 딱 하나뿐이다 — Service/Ingress/ConfigMap 템플릿이 전혀 없는데,
정작 `k8s/`에는 이미 손으로 쓴 raw 매니페스트로 Service
(`k8s/cluster/cluster_IP.yml`)와 두 번째 Deployment
(`k8s/deployment/deployment.yml`, `k8s/deployment/rolling_update.yml`)가 있고
이것들은 한 번도 템플릿으로 옮겨진 적이 없다. 이건 `helm create
upload-board-project`의 원본 출력 그 자체이지, 이 프로젝트에 맞게 손본 차트가
아니다.

## 결정

- **스캐폴딩이 랜딩됐다는 사실을 기록한다** — Stage 4 컴포넌트 상태표의 Helm 행을
  🆕(미착수)에서, 작지만 실재하는 기반이 있는 상태로 옮긴다. 문서화하지 않은 채
  방치하지 않는다.
- **완료됐다거나 배포 가능하다고 서술하지 않는다.** 지금 상태는 placeholder인
  `nginx` 이미지와 템플릿 하나뿐이라, 오늘 당장 이 프로젝트의 백엔드를 실제
  클러스터에 배포할 수 없다.
- **적응 작업(adaptation pass)은 지금 하지 않고 미룬다** — 아직 살아있는
  Kubernetes 클러스터도 AWS 계정도 없고(Terraform도 [ADR 0038](0038-terraform-iac-scaffold.ko.md)에서
  보듯 같은 미적응 상태), "진짜" 차트가 맞게 작성됐는지 검증할 실제 인프라
  자체가 아직 없다.

## 기각한 대안

- **지금 바로 프로덕션급 차트를 작성한다**(Service/Ingress/ConfigMap 템플릿,
  환경별 `values-{env}.yaml`, 실제 이미지 참조, 시크릿 연결까지) — 기각: 배포해
  검증할 대상 자체가 아직 없고, [ADR 0033](0033-secrets-delivery-target.ko.md)의
  시크릿 전달 방식조차 아직 설계만 돼 있다. 검증 불가능한 인프라 코드를 지금
  써봐야 클러스터와 시크릿 메커니즘이 실제로 생기면 다시 써야 할 위험이 크다.
- **스캐폴딩을 지우고 나중에 적응 작업 시점에 처음부터 새로 쓴다** — 기각:
  유지하는 데 비용이 들지 않고, 빈 디렉터리보다 `helm create`가 이미 갖춰준
  구조(`.helmignore`, `Chart.yaml` 필드 등)가 있는 편이 시작점으로 더 빠르다.

## 결과

- ROADMAP.md의 Stage 4 "Production DevOps stack — component status" 표: Helm
  행이 🆕에서 🔶(스캐폴딩 랜딩, 프로젝트 전용 적응 대기)로 이동.
- 후속 작업(ROADMAP > 미배정에 기록, 아직 독립 작업으로 일정화되지는 않음):
  실제 `k8s/` 매니페스트(Service, 두 번째 Deployment, rolling-update 전략)를
  `templates/`로 템플릿화하고, `values.yaml`의 `image.repository`를
  `bluecode1775/sharenpo`로 맞추고, [ADR 0033](0033-secrets-delivery-target.ko.md)에
  실제 코드가 붙으면 Kubernetes `Secret` 소비까지 연결한다. 이 작업을 시작하는
  데 새로운 결정은 필요 없다 — 이 ADR은 "아직 안 됐다"는 사실을 기록할 뿐, 그
  작업을 막는 설계 게이트가 아니다.
- 스키마·엔티티·API 표면 변경 없음. 이 ADR이 다루는 범위 밖(`helm/` 이외)의
  코드는 건드리지 않았다.
