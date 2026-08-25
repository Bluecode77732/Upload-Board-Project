# upload-board-project (Terraform)

> English: [README.md](README.md)

이 저장소의 Helm 차트(`k8s/helm/`)가 배포될 AWS 인프라를 만듭니다: EKS
클러스터, RDS PostgreSQL, S3 버킷, ESO/IRSA 시크릿 파이프라인, 그리고
ALB + ACM 인증서 기반의 ingress 경로까지 포함합니다. 각 리소스가 왜 여기
있는지, 어떤 대안이 기각됐는지는
[ADR 0043](../../docs/ADR/0043-terraform-project-adaptation.ko.md)을,
이 디렉터리의 스캐폴딩 이력은
[ADR 0038](../../docs/ADR/0038-terraform-iac-scaffold.ko.md)을,
아래 구성이 왜 단일 root 모듈이 아니라 3개의 독립적으로 apply 가능한
state로 나뉘어 있는지는
[ADR 0044](../../docs/ADR/0044-terraform-three-state-split.ko.md)를
참고하세요.

**상태**: 세 state 디렉터리 모두 `terraform validate`, `terraform fmt
-check` 통과. **실제 AWS에는 아직 apply하지 않았습니다** — 이 설정으로
`terraform apply`를 실행한 적이 없습니다. apply하면 실제로 비용이 청구되는
AWS 리소스(EKS 컨트롤 플레인, RDS 인스턴스, NAT 게이트웨이, ALB)가 만들어지고,
destroy하기 전까지 계속 과금됩니다(ADR 0043 D1).

## 3개의 state, 하나의 apply 순서

```
k8s/infra/terraform/
├── cluster/       module.vpc + module.eks
├── app-infra/      RDS + S3/IRSA + Secrets Manager + Route53/ACM
└── addons/         module.eks_blueprints_addons (ALB Controller + ESO)
```

각 디렉터리는 독립된 Terraform root 모듈이고 각자 로컬 state 파일
(`terraform.tfstate`, gitignore됨)을 가집니다 — 전체를 한 번에 apply하는
단일 `terraform apply`는 없습니다. apply 순서는 관례가 아니라 데이터 의존
관계로 고정됩니다(ADR 0044 D2):

1. **`cluster/`** 먼저 — 다른 두 state에 대한 의존이 없습니다.
2. **`app-infra/`** 다음 — RDS 보안 그룹과 S3 IRSA 역할의 신뢰 정책을 위해
   `cluster/`의 출력값(VPC/서브넷 ID, EKS 노드 보안 그룹, OIDC 프로바이더)을
   `terraform_remote_state`로 읽습니다.
3. **`addons/`** 마지막 — 둘 다를 읽는 유일한 state입니다: `cluster/`에서
   EKS 연결 정보를, `app-infra/`에서 Secrets Manager ARN을
   (`external_secrets_secrets_manager_arns`) 읽습니다. `app-infra/`가
   존재하기 전에는 이 state를 먼저 apply할 수 없는 이유입니다.

`app-infra/`와 `addons/`의 `terraform_remote_state`는 생성한 state
디렉터리를 가리키는 상대 경로와 함께 `backend = "local"`을 씁니다
(`../cluster/terraform.tfstate` 등) — 팀/CI 공유용 백엔드가 아니라 개발자
1인의 편의를 위한 선택입니다(ADR 0044 D3). 아래 명령은 표시된 디렉터리
안에서 각각 실행하세요; `terraform init`도 세 곳에서 각각 따로 실행해야
합니다.

**향후 계획**: 두 번째 개발자나 CI 파이프라인이 이 설정을 apply해야 하는
시점이 오면, 각 state의 `backend "local"`을 원격 backend(S3 + DynamoDB
락, 또는 Terraform Cloud)로 옮깁니다 — 지금은 의도적으로 하지 않은
상태이며(ADR 0044 D3, 기각된 대안), [ROADMAP.md
7절](../../../docs/ROADMAP.ko.md#7-미일정--미결-사항)에 미예정 작업으로
기록돼 있습니다.

## 아무거나 `apply`하기 전에 준비할 것

1. **DNS를 걸 수 있는 도메인.** `app-infra/`는 `var.domain_name`으로
   Route53 호스팅 영역을 만들고 그 안에서 ACM 인증서를 DNS 검증하지만,
   도메인 자체를 구매/등록하지는 않습니다(ADR 0043 D5) — 최초 도메인 구매는
   대화형이고 되풀이 가능하지 않은 작업이라 Terraform의 모델에 맞지 않기
   때문입니다. 먼저 도메인을 구매한 뒤(Route53 Domains나 임의의
   등록기관), 이 설정이 만드는 영역에 위임하세요(`route53_zone_name_servers`
   출력값을 등록기관의 네임서버로 지정). 그 출력값을 얻기 위해 먼저 한 번
   apply한 뒤 위임해도 됩니다.
2. **전역적으로 유일한 S3 버킷 이름** — `app-infra/`의
   `var.s3_bucket_name`에 넣을 값으로, 버킷 이름은 계정을 넘어 AWS
   전체에서 충돌합니다.
3. **필요한 권한을 가진 AWS 자격증명**(EKS/RDS/S3/IAM/Route53/ACM 생성
   권한)과 로컬에 설치된 `aws`/`kubectl`/`helm` CLI — `addons/`의
   `kubernetes`/`helm` provider가 내부적으로 `aws eks get-token`을
   실행합니다.
4. **`region`/`cluster_name`은 세 state의 `.tfvars`/`-var` 값이 모두
   일치해야 합니다.** 이 값들은 `terraform_remote_state`로 자동 공유되지
   않는 순수 변수입니다 — `cluster/`에 준 것과 다른 `cluster_name`을
   `app-infra/`에 주면 plan은 성공하지만 리소스 이름/태그가 서로 어긋난
   구성이 됩니다.

## 배포

```sh
# 1. cluster/
cd cluster
terraform init
terraform apply

# 2. app-infra/ — terraform_remote_state로 cluster/의 state를 읽는다
cd ../app-infra
terraform init
terraform apply \
  -var="s3_bucket_name=<전역적으로-유일한-버킷-이름>" \
  -var="domain_name=<본인-도메인>"

# 3. addons/ — cluster/와 app-infra/의 state를 모두 읽는다
cd ../addons
terraform init
terraform apply
```

세 state 어느 변수도 비밀값을 직접 받지 않습니다 — Helm 차트의
`secrets.existingSecret`이 필요로 하는 네 값(`DB_USERNAME`, `DB_PASSWORD`,
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`)은 `app-infra/`가
`random_password`로 생성하며, AWS Secrets Manager와 그 state의 Terraform
state 파일 안에만 존재합니다(ADR 0043 D7/D8).

## 세 state 모두 `apply`한 이후

1. **kubectl을 새 클러스터로 연결** — `cluster/`에서: `terraform output
   -raw configure_kubectl`이 실행할 명령을 출력해 줍니다.
2. **시크릿을 클러스터로 동기화** — Secrets Manager 항목을 네이티브
   `Secret`으로 미러링하는 `SecretStore`/`ExternalSecret` 객체는 커스텀
   리소스(CRD)라서, `addons/`가 설치한 ESO 자신의 Helm 릴리스가 먼저
   실행되어 그 스키마를 알고 있어야 합니다. Terraform의
   `kubernetes_manifest` 리소스는 CRD를 설치하는 것과 같은 apply 안에서 그
   CRD의 인스턴스를 선언할 수 없다는 알려진 제약이 있어서(provider
   문서에 명시됨), 이 단계는 한 번만 수동으로 수행합니다 — ADR 0043 D5가
   도메인 등록에 이미 쓴 것과 같은 모양입니다. `app-infra/`에서
   실행합니다(매니페스트가 참조하는 건 그 state 자신의 Secrets Manager
   시크릿뿐이므로):

   ```sh
   cd app-infra
   terraform output -raw external_secrets_manifest | kubectl apply -f -
   ```

   동기화됐는지 확인: `kubectl get externalsecret,secret
   $(terraform output -raw app_secret_k8s_name)`.
3. **Helm 차트 설치**, `app-infra/`의 출력값을 그대로 연결합니다:

   ```sh
   cd ../../helm
   helm install sharenpo . \
     --set secrets.existingSecret=$(terraform -chdir=../infra/terraform/app-infra output -raw app_secret_k8s_name) \
     --set env.DB_HOST=$(terraform -chdir=../infra/terraform/app-infra output -raw db_host) \
     --set env.DB_DATABASE=$(terraform -chdir=../infra/terraform/app-infra output -raw db_name) \
     --set env.STORAGE_DRIVER=s3 \
     --set env.S3_BUCKET=$(terraform -chdir=../infra/terraform/app-infra output -raw s3_bucket_name) \
     --set env.AWS_REGION=<var.region과 같은 값> \
     --set env.BASE_URL=https://<본인-도메인>
   ```

## 알려진 한계: 앱의 S3 IRSA 역할이 전용 ServiceAccount가 아니라 `default`에 걸려 있음

`app-infra/`의 `aws_iam_role.app`(`app_iam_role_arn`으로 출력)은
`STORAGE_DRIVER=s3`를 켰을 때 앱 파드의 AWS SDK 클라이언트가 S3 자격증명을
실제로 얻게 해주는 IRSA 역할입니다(ADR 0029, ADR 0043 D8). 그런데 이
역할의 신뢰 정책은 `system:serviceaccount:default:default`를 대상으로
합니다 — Helm 차트(`k8s/helm/`)가 아직 전용 `ServiceAccount`를 렌더링하지
않고, 파드가 네임스페이스의 `default` ServiceAccount로 뜨기 때문입니다.
`default`에 이 역할의 ARN을 주석으로 달면, 그 SA를 쓰는 네임스페이스 안
**모든** 파드에 S3 권한이 열립니다 — 이 앱의 파드만이 아닙니다:

```sh
cd app-infra
kubectl annotate serviceaccount default \
  eks.amazonaws.com/role-arn=$(terraform output -raw app_iam_role_arn)
```

Helm 차트에 전용 `ServiceAccount` 템플릿을 추가하는 일(이미 만들어져 있지만
비활성 상태인 `ingress.yaml`과 같은 모양 — ADR 0041)은 별도의 차트 작업이며,
이 Terraform 설정 혼자서는 고칠 수 없습니다.

## ALB ingress 켜기

Helm 차트의 `Ingress` 템플릿은 이미 만들어져 있지만 기본은 비활성입니다
(`ingress.enabled: false`, ADR 0041). `addons/`가 apply되어 ALB
Controller가 `Ingress` 객체를 조정할 수 있는 상태가 되고 `app-infra/`가
인증서를 가진 뒤, 다음으로 켤 수 있습니다:

```sh
helm upgrade sharenpo . \
  --reuse-values \
  --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.annotations."kubernetes\.io/ingress\.class"=alb \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/scheme"=internet-facing \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw acm_certificate_arn) \
  --set ingress.hosts[0].host=<본인-도메인>
```

## 각 state가 만드는 것

| State | 리소스 | 목적 | ADR 0043 결정 |
|---|---|---|---|
| `cluster/` | `module.vpc` | VPC, public/private 서브넷, 단일 NAT 게이트웨이 | 원래 스캐폴드에서 변경 없음 |
| `cluster/` | `module.eks` | EKS 클러스터, 이기종 관리형 노드 그룹 2개(`graviton` 주력, `x64` 유휴 대기용) | D3 |
| `app-infra/` | `aws_db_instance.db` | RDS PostgreSQL, private 서브넷, EKS 노드에서만 5432로 접근 가능 | D2 |
| `app-infra/` | `aws_s3_bucket.app` + IRSA 역할 | `STORAGE_DRIVER=s3`용 private 버킷, 앱 파드의 S3 자격증명 | D8 |
| `app-infra/` | `aws_secretsmanager_secret.app` | Helm 차트의 `secrets.existingSecret`이 필요로 하는 네 값 | D7 |
| `app-infra/` | `aws_route53_zone.app` + `aws_acm_certificate.app` | ALB ingress용 DNS 영역과 DNS 검증된 TLS 인증서 | D4, D5 |
| `addons/` | `module.eks_blueprints_addons` | AWS Load Balancer Controller + External Secrets Operator(둘 다 모듈 내장 플래그로 설치) | D6, D7, D9 |

**원래 스캐폴드에서 제거됐고, 주석 처리로 남기지 않음**(D6): `istio-system`
네임스페이스, `istio-base`/`istiod`/`istio-ingress` Helm 릴리스, Istio 전용
노드 보안 그룹 규칙(15017/15012 포트). Istio는 나중에 별도의 Terraform
변경으로 예정되어 있고(ROADMAP.md), 그때 가서 이 모듈이 어떤 모양일지 다시
확인하며 새로 작성하는 편이, 필요해질 때까지 죽은 주석 코드를 계속 맞춰
두는 것보다 쌉니다.

## 삭제(Destroy)

apply의 역순: `addons/` 먼저, 그다음 `app-infra/`, 마지막으로 `cluster/`
— 각 state의 `terraform destroy`는 자신이 소유한 리소스만 plan하지만,
`app-infra/`와 `addons/`는 여전히 `cluster/`의 출력값을 `terraform_remote_state`로
실시간 참조하고 있어서, `cluster/`를 먼저 지우면 이미 존재하지 않는
리소스의 state 파일을 읽는 상태가 됩니다.

AWS Load Balancer Controller 애드온은 리소스 삭제를 비동기로 정리합니다.
ALB ingress를 한 번이라도 켰다면, 원래 Istio 예제와 같은 이유로
`addons/`(또는 ALB가 그보다 오래 남아 있었다면 `cluster/`) 안에서
`terraform destroy`가 VPC `DependencyViolation` 오류로 타임아웃할 수
있습니다 — ALB의 보안 그룹이 명령보다 더 오래 살아남을 수 있기 때문입니다.
Helm 릴리스를 먼저 제거하고(`helm uninstall sharenpo`), AWS 콘솔에서
ALB와 그 보안 그룹이 실제로 사라졌는지 확인한 뒤 위 순서대로 destroy하세요.

`app-infra/`(RDS 데이터, Route53 영역, Secrets Manager)는 남긴 채
`cluster/`만 지우는 것이 바로 이 3-state 분리가 존재하는 이유인 구체적
능력입니다(ADR 0044) — 데이터베이스나 DNS 설정을 잃지 않고 EKS/노드
그룹에 대한 과금만 멈출 수 있습니다. 이 경우에도 `addons/`는
`cluster/`의 출력값에 의존하므로 먼저 내려야 합니다.
