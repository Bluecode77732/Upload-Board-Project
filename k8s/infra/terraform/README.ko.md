# upload-board-project (Terraform)

> English: [README.md](README.md)

이 저장소의 Helm 차트(`k8s/helm/`)가 배포될 AWS 인프라를 만듭니다: EKS
클러스터, RDS PostgreSQL, S3 버킷, ESO/IRSA 시크릿 파이프라인, 그리고
ALB + ACM 인증서 기반의 ingress 경로까지 포함합니다. 각 리소스가 왜 여기
있는지, 어떤 대안이 기각됐는지는
[ADR 0043](../../docs/ADR/0043-terraform-project-adaptation.ko.md)을,
이 디렉터리의 스캐폴딩 이력은
[ADR 0038](../../docs/ADR/0038-terraform-iac-scaffold.ko.md)을 참고하세요.

**상태**: `terraform validate`, `terraform fmt -check` 통과. **실제 AWS에는
아직 apply하지 않았습니다** — 이 설정으로 `terraform apply`를 실행한 적이
없습니다. apply하면 실제로 비용이 청구되는 AWS 리소스(EKS 컨트롤 플레인,
RDS 인스턴스, NAT 게이트웨이, ALB)가 만들어지고, destroy하기 전까지 계속
과금됩니다(ADR 0043 D1).

## `apply` 전에 준비할 것

1. **DNS를 걸 수 있는 도메인.** Terraform은 `var.domain_name`으로 Route53
   호스팅 영역을 만들고 그 안에서 ACM 인증서를 DNS 검증하지만, 도메인 자체를
   구매/등록하지는 않습니다(ADR 0043 D5) — 최초 도메인 구매는 대화형이고
   되풀이 가능하지 않은 작업이라 Terraform의 모델에 맞지 않기 때문입니다.
   먼저 도메인을 구매한 뒤(Route53 Domains나 임의의 등록기관), 이 설정이
   만드는 영역에 위임하세요(`route53_zone_name_servers` 출력값을 등록기관의
   네임서버로 지정). 그 출력값을 얻기 위해 먼저 한 번 apply한 뒤 위임해도
   됩니다.
2. **전역적으로 유일한 S3 버킷 이름** — `var.s3_bucket_name`에 넣을 값으로,
   버킷 이름은 계정을 넘어 AWS 전체에서 충돌합니다.
3. **필요한 권한을 가진 AWS 자격증명**(EKS/RDS/S3/IAM/Route53/ACM 생성 권한)과
   로컬에 설치된 `aws`/`kubectl`/`helm` CLI — 여기 `kubernetes`/`helm`
   provider가 내부적으로 `aws eks get-token`을 실행합니다.

## 배포

```sh
terraform init
terraform apply \
  -var="s3_bucket_name=<전역적으로-유일한-버킷-이름>" \
  -var="domain_name=<본인-도메인>"
```

이 설정의 어떤 변수도 비밀값을 직접 받지 않습니다 — Helm 차트의
`secrets.existingSecret`이 필요로 하는 네 값(`DB_USERNAME`, `DB_PASSWORD`,
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`)은 Terraform이
`random_password`로 생성하며, AWS Secrets Manager와 Terraform state
안에만 존재합니다(ADR 0043 D7/D8).

## `apply` 이후

1. **kubectl을 새 클러스터로 연결** — `terraform output -raw
   configure_kubectl`이 실행할 명령을 출력해 줍니다.
2. **시크릿을 클러스터로 동기화** — Secrets Manager 항목을 네이티브
   `Secret`으로 미러링하는 `SecretStore`/`ExternalSecret` 객체는 커스텀
   리소스(CRD)라서, ESO 자신의 Helm 릴리스가 먼저 설치되어 그 스키마를
   알고 있어야 합니다. Terraform의 `kubernetes_manifest` 리소스는 CRD를
   설치하는 것과 같은 apply 안에서 그 CRD의 인스턴스를 선언할 수 없다는
   알려진 제약이 있어서(provider 문서에 명시됨), 이 단계는 한 번만 수동으로
   수행합니다 — ADR 0043 D5가 도메인 등록에 이미 쓴 것과 같은 모양입니다:

   ```sh
   terraform output -raw external_secrets_manifest | kubectl apply -f -
   ```

   동기화됐는지 확인: `kubectl get externalsecret,secret
   $(terraform output -raw app_secret_k8s_name)`.
3. **Helm 차트 설치**, 이 설정의 출력값을 그대로 연결합니다:

   ```sh
   cd ../../helm
   helm install upload-board . \
     --set secrets.existingSecret=$(terraform -chdir=../infra/terraform output -raw app_secret_k8s_name) \
     --set env.DB_HOST=$(terraform -chdir=../infra/terraform output -raw db_host) \
     --set env.DB_DATABASE=$(terraform -chdir=../infra/terraform output -raw db_name) \
     --set env.STORAGE_DRIVER=s3 \
     --set env.S3_BUCKET=$(terraform -chdir=../infra/terraform output -raw s3_bucket_name) \
     --set env.AWS_REGION=<var.region과 같은 값> \
     --set env.BASE_URL=https://<본인-도메인>
   ```

## 알려진 한계: 앱의 S3 IRSA 역할이 전용 ServiceAccount가 아니라 `default`에 걸려 있음

`aws_iam_role.app`(`app_iam_role_arn`으로 출력)은 `STORAGE_DRIVER=s3`를
켰을 때 앱 파드의 AWS SDK 클라이언트가 S3 자격증명을 실제로 얻게 해주는
IRSA 역할입니다(ADR 0029, ADR 0043 D8). 그런데 이 역할의 신뢰 정책은
`system:serviceaccount:default:default`를 대상으로 합니다 — Helm 차트
(`k8s/helm/`)가 아직 전용 `ServiceAccount`를 렌더링하지 않고, 파드가
네임스페이스의 `default` ServiceAccount로 뜨기 때문입니다. `default`에 이
역할의 ARN을 주석으로 달면, 그 SA를 쓰는 네임스페이스 안 **모든** 파드에
S3 권한이 열립니다 — 이 앱의 파드만이 아닙니다:

```sh
kubectl annotate serviceaccount default \
  eks.amazonaws.com/role-arn=$(terraform output -raw app_iam_role_arn)
```

Helm 차트에 전용 `ServiceAccount` 템플릿을 추가하는 일(이미 만들어져 있지만
비활성 상태인 `ingress.yaml`과 같은 모양 — ADR 0041)은 별도의 차트 작업이며,
이 Terraform 설정 혼자서는 고칠 수 없습니다.

## ALB ingress 켜기

Helm 차트의 `Ingress` 템플릿은 이미 만들어져 있지만 기본은 비활성입니다
(`ingress.enabled: false`, ADR 0041). 이 Terraform이 실행된 뒤에는 다음으로
켤 수 있습니다:

```sh
helm upgrade upload-board . \
  --reuse-values \
  --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.annotations."kubernetes\.io/ingress\.class"=alb \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/scheme"=internet-facing \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=$(terraform -chdir=../infra/terraform output -raw acm_certificate_arn) \
  --set ingress.hosts[0].host=<본인-도메인>
```

## 이 설정이 만드는 것

| 리소스 | 목적 | ADR 0043 결정 |
|---|---|---|
| `module.vpc` | VPC, public/private 서브넷, 단일 NAT 게이트웨이 | 원래 스캐폴드에서 변경 없음 |
| `module.eks` | EKS 클러스터, 이기종 관리형 노드 그룹 2개(`graviton` 주력, `x64` 유휴 대기용) | D3 |
| `module.eks_blueprints_addons` | AWS Load Balancer Controller + External Secrets Operator(둘 다 모듈 내장 플래그로 설치) | D6, D7, D9 |
| `aws_db_instance.db` | RDS PostgreSQL, private 서브넷, EKS 노드에서만 5432로 접근 가능 | D2 |
| `aws_s3_bucket.app` + IRSA 역할 | `STORAGE_DRIVER=s3`용 private 버킷, 앱 파드의 S3 자격증명 | D8 |
| `aws_secretsmanager_secret.app` | Helm 차트의 `secrets.existingSecret`이 필요로 하는 네 값 | D7 |
| `aws_route53_zone.app` + `aws_acm_certificate.app` | ALB ingress용 DNS 영역과 DNS 검증된 TLS 인증서 | D4, D5 |

**원래 스캐폴드에서 제거됐고, 주석 처리로 남기지 않음**(D6): `istio-system`
네임스페이스, `istio-base`/`istiod`/`istio-ingress` Helm 릴리스, Istio 전용
노드 보안 그룹 규칙(15017/15012 포트). Istio는 나중에 별도의 Terraform
변경으로 예정되어 있고(ROADMAP.md), 그때 가서 이 모듈이 어떤 모양일지 다시
확인하며 새로 작성하는 편이, 필요해질 때까지 죽은 주석 코드를 계속 맞춰
두는 것보다 쌉니다.

## 삭제(Destroy)

AWS Load Balancer Controller 애드온은 리소스 삭제를 비동기로 정리합니다.
ALB ingress를 한 번이라도 켰다면, 원래 Istio 예제와 같은 이유로 `terraform
destroy`가 VPC `DependencyViolation` 오류로 타임아웃할 수 있습니다 — ALB의
보안 그룹이 명령보다 더 오래 살아남을 수 있기 때문입니다. Helm 릴리스를
먼저 제거하고(`helm uninstall upload-board`), AWS 콘솔에서 ALB와 그 보안
그룹이 실제로 사라졌는지 확인한 뒤 `terraform destroy`를 실행하세요.
