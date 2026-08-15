# ADR 0038: Terraform IaC — upstream EKS+Istio 예제가 그대로 랜딩, 아직 이 프로젝트 전용은 아님

- 상태: 승인됨 (스캐폴딩 상태 — 지금 그대로는 배포 불가)
- 날짜: 2026-08-11
- 관련: [ADR 0037](0037-helm-chart-scaffold.ko.md) (Helm 쪽도 같은 상황);
  CHANGELOG.md > 알려진 문제 (2026-08-13, SSL `rejectUnauthorized: false` 변경이
  이 ADR이 다루는 파일들도 같이 건드림 — "결과" 참고)
- English: [0038-terraform-iac-scaffold.md](0038-terraform-iac-scaffold.md)

## 배경

Stage 4 "프로덕션 DevOps 스택 도입" 행(ROADMAP.md §6)은 여덟 컴포넌트 중 하나로
Terraform을 지목한다 — 이 프로젝트의 배포에 필요한 AWS 리소스(네트워크,
클러스터, S3, 시크릿)를 선언적으로 프로비저닝하기 위해서다. 커밋
`c661fc4`("Adopt: Infra/Terraform; IaC")이 `k8s/infra/terraform/`를 추가했는데,
Helm 스캐폴딩([ADR 0037](0037-helm-chart-scaffold.ko.md))과 마찬가지로 CHANGELOG
항목도 ROADMAP 상태표 갱신도 ADR도 없이 랜딩됐다.

디렉터리를 직접 열어보면: `README.md`는 AWS의
`terraform-aws-eks-blueprints` "EKS Cluster w/ Istio" 예제의 **원문 README를
그대로** 옮긴 것이다 — 지금도 Istio 설치, Istio Ingress Gateway 배포, 샘플
애플리케이션으로 Istio 통신 검증하는 절차를 설명하고 있는데, 이 프로젝트와
무관하다. `main.tf`는 `aws`/`kubernetes`/`helm` provider를 선언하고 범용 EKS
클러스터, VPC(`module "vpc"`), Istio 관련 애드온(`module
"eks_blueprints_addons"`, `kubernetes_namespace_v1` `istio_system` 리소스)을
프로비저닝한다 — 예제 시나리오를 위한 인프라이지, 이 프로젝트가 실제로
필요로 하는 리소스가 아니다: [ADR 0029](0029-storage-port-adapter.ko.md) 스토리지
드라이버 전환용 S3 버킷도, 이 프로젝트의 `DB_*` 환경변수에 대응하는 RDS 등도,
[ADR 0033](0033-secrets-delivery-target.ko.md)을 위한 시크릿 관리 리소스도,
[ADR 0034](0034-https-termination-stance.ko.md)를 위한 ALB/ingress도 없다.
`variables.tf`는 **비어 있다(0바이트)** — 이 구성에서 실제로 매개변수화된 건
아무것도 없다는 뜻이다.

이후 커밋 두 개가 가볍게 손을 댔지만 이 그림을 바꾸지는 않았다: `d6587f9`는
하드코딩된 리전 오타(`ap-west-2` → `ap-northeast-2`)를 고쳤고, `41c8c2c`는
provider/lock 파일 버전을 올리면서 같은 커밋 안에서
`backend/app.module.ts`에 프로덕션 전용 `ssl: { rejectUnauthorized: false }`를
추가했다 — 이건 별개 관심사(애플리케이션 레벨 DB TLS 처리)의 변경이 Terraform
파일 수정과 같은 커밋에 우연히 같이 실렸을 뿐이며, 별도로 추적 중이고
(CHANGELOG.md > 알려진 문제, 2026-08-13) 이 ADR로 해소되지 않는다.

## 결정

- **스캐폴딩이 랜딩됐다는 사실을 기록한다** — Stage 4 컴포넌트 상태표의
  Terraform 행을 🆕에서, 범용적이고 아직 미적응이지만 실재하는 기반이 있는
  상태로 옮긴다.
- **이 프로젝트의 인프라라고 서술하지 않는다.** 지금 상태 그대로
  `terraform apply`를 실행하면 AWS 예제의 EKS+Istio 환경이 만들어질 뿐, 이
  백엔드에 필요한 건 아무것도 만들어지지 않는다 — 이 프로젝트의 ADR들이
  요구하는 S3 버킷도, 데이터베이스도, 시크릿 리소스도, ingress도 선언돼 있지
  않다.
- **재작성은 이번 문서화 작업에 포함하지 않고 미룬다** — 구체적으로 어떤
  리소스가 필요한지는 이 프로젝트가 이미 설계만 해둔 ADR들
  ([0033](0033-secrets-delivery-target.ko.md) 시크릿 전달 대상,
  [0034](0034-https-termination-stance.ko.md) ingress/ALB 방침)에 달려 있는데
  아직 프로비저닝되지 않았고, 여기에 더해 ADR 0030이 "바로 이 Terraform
  작업"으로 미뤄둔 노드그룹/인스턴스 패밀리 선택도 필요하다.

## 기각한 대안

- **지금 바로 이 프로젝트 전용 Terraform 구성을 처음부터 작성한다** —
  [ADR 0037](0037-helm-chart-scaffold.ko.md)과 같은 이유로 기각: `plan`/`apply`로
  검증할 AWS 계정 자체가 아직 없고, 거기 담아야 할 ADR 0033/0034의 형태도
  아직 설계 단계일 뿐이라 손으로 쓴 리소스 블록이 검증 불가능하다.
- **Istio 관련 리소스만 지금 걷어내고 나머지는 둔다** — 절반짜리 조치라 기각:
  `variables.tf`가 비어 있다는 점과 README가 upstream 원문 그대로라는 점이
  Istio 부분보다 훨씬 큰 "미적응" 신호다. 여기만 부분적으로 손대면 실제로
  배포 가능한 인프라를 만들지 못한 채 더 완성된 것처럼 보이기만 할 위험이
  있다.

## 결과

- ROADMAP.md의 Stage 4 "Production DevOps stack — component status" 표:
  Terraform 행이 🆕에서 🔶(upstream 스캐폴딩 랜딩, 프로젝트 전용 리소스 미선언)로
  이동.
- 후속 작업(ROADMAP > 미배정에 기록, 아직 독립 작업으로 일정화되지는 않음):
  `main.tf`의 리소스 구성을 이 프로젝트가 실제로 필요로 하는 것(S3 버킷,
  `DB_*`에 대응하는 Postgres 대상, [ADR 0033](0033-secrets-delivery-target.ko.md)에
  따른 IAM/시크릿, [ADR 0034](0034-https-termination-stance.ko.md)에 따른
  ALB/ingress)로 교체하고, `variables.tf`를 채우고, `README.md`를 교체한다.
  이 작업이 끝나면 [ADR 0030](0030-container-non-root-and-arch-stance.ko.md)이
  "Terraform 노드그룹 결정"으로 미뤄둔 ARM/Graviton 결정도 함께 풀린다.
- `backend/app.module.ts`의 SSL 검증 관련 질문(CHANGELOG.md > 알려진 문제,
  2026-08-13)은 **이 ADR로 해소되지 않는다** — 그 변경을 도입한 커밋이 이 ADR이
  다루는 파일들도 같이 건드렸을 뿐, 별도로 추적되고 있고 코드를 고치기 전에
  독립적인 조사가 필요하다.
- 스키마·엔티티·API 표면 변경 없음. 이 ADR이 다루는 범위 밖
  (`k8s/infra/terraform/` 이외)의 코드는 건드리지 않았다.
