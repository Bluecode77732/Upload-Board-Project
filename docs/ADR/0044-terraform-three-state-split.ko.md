# ADR 0044: Terraform 3-State 분리 — Cluster / Addons / App-Infra Lifecycle 분리

- Status: Accepted (design-only) — 결정만 기록됨; `k8s/infra/terraform/`은 아직 이 ADR이
  설명하는 3개 디렉토리로 재구성되지 않았음
- Date: 2026-08-19
- Amends: [ADR 0043](0043-terraform-project-adaptation.md) (무엇을 프로비저닝하고 왜인지를
  정한 D1~D10 리소스 결정은 그대로 유지 — 그 ADR이 구현한 단일 root module 패키징만
  이 ADR에서 재구성됨)
- Related: [ADR 0038](0038-terraform-iac-scaffold.md) (이 저장소 Terraform 디렉토리의
  출발점이 된 스캐폴드), [ADR 0042](0042-k8s-helm-directory-consolidation.md) ("Helm 차트
  밖에는 raw manifest를 두지 않는다"는 규칙 — 이 ADR의 하위 디렉토리들은 여전히 Kubernetes
  manifest가 아닌 Terraform 설정이므로 그 규칙을 계속 준수함)
- 한국어: [0044-terraform-three-state-split.ko.md](0044-terraform-three-state-split.ko.md)

## Context

개발자가 "Cluster 프로비져닝"과 "Helm/Kubernetes 프로비져닝"의 lifecycle을 분리해,
모듈 간 역할 분담을 깔끔하게 하는 방향을 조사·논의해 달라고 요청했다. 먼저 실제 저장소
구조부터 조사했다(환각 방지 원칙):

- `k8s/infra/terraform/`(Cluster + AWS 인프라: VPC, EKS, RDS, S3, Secrets Manager,
  Route53/ACM)과 `k8s/helm/`(Kubernetes 애플리케이션 리소스: Deployment, Service,
  ConfigMap, Ingress, migration Job)은 **이미** 디렉토리와 툴 단위로 lifecycle이 분리되어
  있다 — [ADR 0037](0037-helm-chart-scaffold.md)/[0038](0038-terraform-iac-scaffold.md)/
  [0041](0041-helm-chart-project-adaptation.md)/[0042](0042-k8s-helm-directory-consolidation.md)/
  [0043](0043-terraform-project-adaptation.md)이 만들어낸 의도적인 결과다. ADR 0042의
  Consequences는 "`k8s/infra/terraform/`은 건드리지 않음 — 이 ADR은 manifest/chart 분리에만
  한정"이라고 스스로 범위를 명시해 두었다.
- 조사 과정에서 추적되지 않은(untracked) 빈 스텁 파일(`k8s/infra/cluster.yaml`, 한 줄:
  `apiVersion: `)이 발견됐다. 이 파일의 경로/이름은 ADR 0042가 삭제한 `k8s/cluster/` raw
  manifest 디렉토리를 연상시킨다. 개발자에게 확인한 결과 실제 의도는 raw Kubernetes
  manifest가 아니라 Terraform 내부 재구성이었다 — 해당 파일은 이 ADR의 결정과 무관하며,
  여전히 정리가 필요하다는 점만 아래 Consequences에서 별도로 언급한다.
- `k8s/infra/terraform/` 안에서 `main.tf`는 Cluster 리소스(`module.vpc`, `module.eks`)와
  Application-Infrastructure 리소스(RDS, S3+IRSA, Secrets Manager, Route53/ACM)를
  **하나의 Terraform state**로 묶고 있다. 즉 cluster를 RDS/S3/Secrets/DNS와 독립적으로
  apply하거나 destroy할 수 없다 — 개발자가 실제로 메우고 싶은 간극은 Terraform과 Helm
  사이가 아니라 Terraform 자신의 root module 내부에 있었다.

`main.tf`의 실제 리소스 참조를 (추측이 아니라) 추적한 결과, "cluster"와 "app-infra"로
단순히 나눴을 때 얽히는 교차 결합 지점이 4곳 확인됐다:

1. `module.vpc`는 `module.eks`(`vpc_id`, `subnet_ids`)와 `aws_db_subnet_group.db`
   (`module.vpc.private_subnets`) **양쪽 모두**에서 쓰인다 — VPC는 cluster 전용이 아니라
   공통 기반이다.
2. `aws_security_group.rds`의 ingress 규칙이 `module.eks.node_security_group_id`를
   소스로 지정한다 — EKS 노드 그룹이 먼저 있어야 RDS 보안그룹을 만들 수 있다.
3. `aws_iam_role.app`(S3 IRSA 역할, ADR 0043 D8)의 assume-role 정책이
   `module.eks.oidc_provider_arn`/`oidc_provider`에 의존한다 — (2)와 같은 방향.
4. `module.eks_blueprints_addons`(ALB Controller + External Secrets Operator)는 EKS
   출력값(`cluster_endpoint`, `oidc_provider_arn` 등)과 **동시에**
   `aws_secretsmanager_secret.app.arn`(app-infra 리소스, `external_secrets_secrets_manager_arns`용)을
   필요로 한다. 이 addon 계층은 양쪽에 걸쳐 있다 — app-infra의 출력값 없이는 완전히
   구성할 수 없는 cluster 도구다.

4번이 바로 "cluster vs app-infra" 식의 단순 2분할이 깔끔하게 되지 않는 이유다.
`eks_blueprints_addons`를 어느 한쪽에 접어 넣어도 다른 쪽의 값이 필요해지고, 이는 두
state 사이의 순환 참조를 만들거나 목표를 절반만 달성하는 인위적인 apply 순서 제약을
낳는다.

## Decision

### D1 — 2개가 아니라 3개의 Terraform root module, 3개의 state

`k8s/infra/terraform/`을 독립적으로 apply 가능한 3개의 root module로 분리한다:

- **`cluster/`** — `module.vpc`, `module.eks`. VPC를 app-infra가 아니라 여기에 두는 이유는
  그 서브넷/AZ 배치가 애초에 cluster를 수용하기 위해 존재하기 때문이다. RDS는 이미
  cluster 목적으로 만들어진 자원을 재사용하는 소비자일 뿐, 그 반대가 아니다.
- **`addons/`** — `module.eks_blueprints_addons`만. 위 교차 결합 4번의 정체가 바로 이
  계층이 구조적으로 다른 두 state의 출력값을 모두 필요로 한다는 것이었다 — 이를 별도
  계층으로 분리하면 `cluster/`와 `app-infra/`는 서로를 몰라도 된다.
- **`app-infra/`** — `aws_db_instance.db` + RDS 부속 리소스, `aws_s3_bucket.app` +
  `aws_iam_role.app`(S3 IRSA), `aws_secretsmanager_secret.app`,
  `aws_route53_zone.app` + `aws_acm_certificate.app`.

### D2 — 참조 방향: `addons`만 양방향으로 읽는다

`app-infra/`는 `terraform_remote_state`로 `cluster/`의 출력값을 읽는다(교차 결합 2/3번용
`node_security_group_id`) — 단방향이며, `cluster/`는 절대 `app-infra/`를 읽지 않는다.
`addons/`는 `cluster/`(EKS 접속 정보)와 `app-infra/`(Secrets Manager ARN) **양쪽 모두**를
`terraform_remote_state`로 읽는다 — 이것이 교차 결합 4번의 실제 모습을 어느 한쪽에 숨기지
않고 그대로 드러낸 것이다. `cluster/`와 `app-infra/`는 서로 직접 참조하지 않는다.

이로써 apply 순서가 확정된다: **`cluster` → `app-infra` → `addons`** (addons가 app-infra의
출력값을 소비하는 유일한 쪽이므로 마지막에 적용된다).

### D3 — State backend: 신규 S3가 아니라 로컬 유지

`addons/`와 `app-infra/`의 `terraform_remote_state` 블록은 생성 측 state 디렉토리를
상대경로로 가리키는 `backend = "local"`을 쓴다. 이번 분리의 목적은 팀/CI 간 state 공유가
아니라 한 개발자의 `apply`/`destroy` 주기에서 lifecycle을 독립시키는 것 자체다 — 아직
실제 AWS에 `apply`조차 한 번도 실행하지 않은 프로젝트([ADR 0043](0043-terraform-project-adaptation.md)
D1)에 S3+DynamoDB 원격 backend를 지금 추가하는 것은 요청받지 않은 범위 확장이 하나 더
생기는 것이다. `versions.tf`에 이미 주석 처리되어 있는 `backend "s3" {...}` 블록(원본
upstream 스캐폴드에서 그대로 물려받은 것 — [ADR 0038](0038-terraform-iac-scaffold.md))은
계속 주석 상태로 남는다 — 이 결정이 그 backend를 쓰는 것은 아니다.

### D4 — 디렉토리 배치: 기존 Terraform root 아래에 중첩

```
k8s/infra/terraform/
├── cluster/       (main.tf, variables.tf, outputs.tf, versions.tf)
├── addons/         (main.tf, variables.tf, outputs.tf, versions.tf)
└── app-infra/      (main.tf, variables.tf, outputs.tf, versions.tf)
```

기존 `k8s/infra/terraform/` 경로 아래에 중첩시키는 방식(`k8s/infra/{cluster,addons,app-infra}/`로
평탄화하지 않는 방식)을 택한 이유는, 이 디렉토리를 인용하는 기존 경로(CLAUDE.md의
Terraform/infra 진입점, ADR 0038/0043, 이 저장소 README의 상호 링크)가 `k8s/infra/terraform/`
접두사에서 그대로 유효하게 유지되고, `terraform/` 세그먼트가 ADR 0042 Addendum이 이미
`k8s/helm/`에 대해 정립한 것과 같은 역할(프로젝트 이름을 반복하는 대신 툴 이름으로
명확히 구분)을 계속 수행하기 때문이다.

### D5 — `variables.tf`/`outputs.tf` 재분배와 신규 output

각 state는 자신의 리소스에 필요한 변수만 선언한다(예: `cluster/variables.tf`는 `region`,
`cluster_name`, `vpc_cidr`, `node_desired_size_*`를 유지하고, `app-infra/variables.tf`는
`db_*`, `s3_bucket_name`, `domain_name`, `tags`를 유지).

`cluster/outputs.tf`는 오늘날 **같은 state 안에서** `module.eks.*`로 직접 참조되고 있어
아직 output으로 노출되지 않은 값들을 새로 내보내야 한다: `node_security_group_id`,
`oidc_provider_arn`, `oidc_provider`, `cluster_certificate_authority_data`(기존에 이미
있는 `cluster_endpoint`, `cluster_name`에 추가로). 이 값들이 없으면 `app-infra/`와
`addons/`는 교차 결합 2~4번을 위해 읽을 `terraform_remote_state` 값이 없다.

## Alternatives rejected

- **단일 state 유지(현행)** — 기각: 목표(cluster 독립 apply/destroy)를 달성하지 못한다 —
  RDS/S3/Secrets/DNS 변경이 여전히 cluster 변경과 같은 plan에 들어간다.
- **2-state 분리(`cluster`+`addons` 묶음 / `app-infra`)** — 기각: `addons`가
  `app-infra`의 Secrets Manager ARN을 필요로 하므로, addons를 cluster state에 접어
  넣으면 순환 의존(`cluster+addons` → `app-infra` → 다시 `cluster+addons`)이 생기거나,
  cluster가 먼저 있어야 한다는 개념과 반대로 `app-infra`를 먼저 apply해야 하는 상황이
  강제된다 — 개발자가 분리하고자 한 lifecycle을 절반만 분리하는 타협안이다.
- **파일만 분리, state는 단일 유지**(하나의 root module 안에서
  `cluster.tf`/`app-infra.tf`로만 구분) — 기각: 가독성만 개선될 뿐, state를 공유하는
  한 cluster 리소스를 겨냥한 `terraform destroy`도 여전히 RDS/S3/Secrets/DNS까지
  plan에 포함시킨다 — 실제 간극이 메워지지 않는다.
- **지금 S3 원격 backend 도입** — 이번 결정 범위에서는 기각(D3 참고); 두 번째 사람이나
  CI 파이프라인이 이 설정을 apply해야 하는 시점이 오면 그때 다시 검토한다 — 아직
  일정에 없는 작업이다.

## Consequences

- 오늘의 단일 root module인 `k8s/infra/terraform/main.tf`/`variables.tf`/`outputs.tf`/
  `versions.tf`는 D4의 3개 하위 디렉토리로 대체된다 — **이 ADR이 하는 작업이 아니라
  구현 작업**이다. 이 ADR은 설계만 기록하며, 실제 `.tf` 파일 분할, `terraform_remote_state`
  블록 배선, `k8s/infra/terraform/README.md`(+`.ko.md`)를
  `cluster` → `app-infra` → `addons` 3단계 apply 순서에 맞게 다시 쓰는 작업은 별도
  후속 작업이다.
- apply/destroy 순서가 문서 관례가 아니라 데이터 의존성으로 강제된다: `cluster`가
  먼저, `app-infra`가 다음, `addons`가 마지막(D2). `cluster`만 destroy해서 RDS 데이터와
  Route53/ACM/Secrets Manager 설정은 그대로 둔 채 EKS/노드 그룹 비용만 끊는 것이 처음으로
  가능해진다 — 이것이 이 분리가 존재하는 구체적인 이유다.
- 조사 중 발견한 빈 미추적 스텁 `k8s/infra/cluster.yaml`은 **이 ADR의 범위 밖**이다 —
  D4가 설명하는 3개 디렉토리 어디에도 속하지 않는, `k8s/infra/` 바로 밑의 raw 파일이며,
  그 이름/위치는 여전히 [ADR 0042](0042-k8s-helm-directory-consolidation.md)가 금지하는
  패턴과 겹친다. 이 결정과 별개로 (삭제하거나, `cluster/` state의 자리표시자로 쓸
  의도였다면 그쪽으로 흡수하는 등) 별도 처리가 필요하다.
- CLAUDE.md의 Terraform/infra 진입점(concern-to-entrypoint map)에 ADR 0038/0043과 나란히
  이 ADR을 언급해, 3-state 재설계가 결정되었지만 아직 구현되지 않았음을 후속 독자가 알 수
  있게 해야 한다 — 이 ADR만으로 하는 변경이 아니라 후속 구현 작업의 일부로 처리한다.
- 스키마, 엔티티, API 표면 변경 없음. 이 ADR 자체는 `docs/ADR/` 밖의 코드를 건드리지 않는다.
