# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D2/D4 — addons 상태:
# module.eks_blueprints_addons(ALB Controller + External Secrets Operator)만
# 담당한다. cluster/와 app-infra/ 양쪽을 terraform_remote_state(backend s3, ADR
# 0057)로 읽는 유일한 상태다(D2) — coupling point 4: 이 애드온 레이어는 EKS 연결
# 정보(cluster/)와 Secrets Manager ARN(app-infra/)을 동시에 필요로 해서, 어느
# 한쪽에 접어 넣으면 순환 참조 또는 억지 apply 순서가 생긴다. 두 state의 실제
# 저장 위치가 S3로 옮겨간 이상 로컬 상대경로로는 더 이상 읽을 수 없다 — 이 상태
# 자신의 backend "s3" 블록(versions.tf)과 같은 버킷·리전을 가리켜야 한다.

data "terraform_remote_state" "cluster" {
  backend = "s3"

  config = {
    bucket = var.tfstate_bucket_name
    key    = "cluster/terraform.tfstate"
    region = var.region
  }
}

data "terraform_remote_state" "app_infra" {
  backend = "s3"

  config = {
    bucket = var.tfstate_bucket_name
    key    = "app-infra/terraform.tfstate"
    region = var.region
  }
}

provider "aws" {
  region = var.region
}

# 기존 루트 main.tf의 확인된 주석 그대로: module.eks_blueprints_addons
# (aws-ia/eks-blueprints-addons ~> 1.16)가 자신의 required_providers에
# kubernetes를 명시하고 있어서, 이 provider를 설정해 암묵적으로 넘겨주지
# 않으면 그 모듈이 깨진다. cluster/의 module.eks 자체는 kubernetes provider를
# 요구하지 않는다 — 이 provider의 필요성은 전적으로 이 addons 모듈 때문이다.
provider "kubernetes" {
  host                   = data.terraform_remote_state.cluster.outputs.cluster_endpoint
  cluster_ca_certificate = base64decode(data.terraform_remote_state.cluster.outputs.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    # Terraform을 실행하는 로컬 환경에 awscli가 설치되어 있어야 한다
    args = ["eks", "get-token", "--cluster-name", data.terraform_remote_state.cluster.outputs.cluster_name]
  }
}

# 위 kubernetes provider와 같은 이유로 필요하다 — module.eks_blueprints_addons가
# enable_aws_load_balancer_controller/enable_external_secrets로 내부에서
# helm_release 리소스를 만든다.
provider "helm" {
  kubernetes = {
    host                   = data.terraform_remote_state.cluster.outputs.cluster_endpoint
    cluster_ca_certificate = base64decode(data.terraform_remote_state.cluster.outputs.cluster_certificate_authority_data)

    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      # Terraform을 실행하는 로컬 환경에 awscli가 설치되어 있어야 한다
      args = ["eks", "get-token", "--cluster-name", data.terraform_remote_state.cluster.outputs.cluster_name]
    }
  }
}

locals {
  tags = merge(
    {
      Blueprint  = var.cluster_name
      GithubRepo = "github.com/aws-ia/terraform-aws-eks-blueprints"
    },
    var.tags
  )
}

################################################################################
# EKS Blueprints Addons
################################################################################

module "eks_blueprints_addons" {
  source  = "aws-ia/eks-blueprints-addons/aws"
  version = "~> 1.16"

  cluster_name      = data.terraform_remote_state.cluster.outputs.cluster_name
  cluster_endpoint  = data.terraform_remote_state.cluster.outputs.cluster_endpoint
  cluster_version   = data.terraform_remote_state.cluster.outputs.cluster_version
  oidc_provider_arn = data.terraform_remote_state.cluster.outputs.oidc_provider_arn

  # ADR 0043 D9 — Istio 없이도 유지: 이 프로젝트 자체 Ingress(ADR 0041,
  # 현재 비활성)가 ALB를 받으려면 필요하다.
  enable_aws_load_balancer_controller = true

  # ADR 0043 D7 — ADR 0033이 정한 ESO/IRSA 목표 형태를 이 모듈의 내장 플래그로
  # 구현한다. external_secrets_secrets_manager_arns는 app-infra/가 만든 실제
  # Secrets Manager 시크릿의 ARN이어야 하므로, cluster/가 아니라 app-infra/의
  # remote_state에서 읽는다(D2 — addons만이 두 상태를 동시에 읽는 이유).
  enable_external_secrets = true
  external_secrets_secrets_manager_arns = [
    data.terraform_remote_state.app_infra.outputs.app_secrets_manager_secret_arn
  ]

  # ADR 0047 D2 — Prometheus/Grafana를 이 프로젝트 자신의 EKS 노드에 자체호스팅한다
  # (kube-prometheus-stack: Prometheus Operator + Prometheus + Grafana +
  # Alertmanager, 커뮤니티 Helm 차트를 이 모듈이 내부적으로 helm_release로 설치).
  # ALB Controller/ESO와 같은 이유로 이 모듈에 얹는다 — 새 AWS 관리형 서비스(AMP/AMG)
  # 도입은 기각했으므로 별도 리소스가 필요 없다.
  enable_kube_prometheus_stack = true

  # ADR 0063 D1 — Ingress의 host를 감시해 ALB로 가는 Route53 ALIAS 레코드를 만들고 지운다.
  # IAM 역할(IRSA)은 이 모듈이 만들며, 범위는 아래 zone ARN 하나다. zone은 cluster/가 아니라
  # app-infra/의 리소스라서 그쪽 remote_state에서 읽는다.
  enable_external_dns = true
  external_dns_route53_zone_arns = [
    data.terraform_remote_state.app_infra.outputs.route53_zone_arn
  ]

  # ADR 0063 D2 — chart_version을 고정한 이유: 모듈 기본값 1.14.3(2024-01-26)은 이 클러스터의
  # Kubernetes 1.34보다 오래된 차트다. values를 넘기면 모듈의 기본값(["provider: aws"])이
  # 대체되지만, 두 차트 모두 provider.name 기본값이 aws라서 따로 적지 않는다.
  #   - policy=sync: Ingress가 사라지면 ExternalDNS가 자기가 소유한 레코드를 지운다(D3).
  #     1.22.0에서 policy는 필수 값이라 어차피 명시해야 한다.
  #   - txtOwnerId / domainFilters: 소유 표시와 대상 zone을 이 클러스터·이 도메인으로 좁힌다.
  #   - sources=[ingress]: 이 프로젝트가 쓰는 소스만 본다.
  #   - service.enabled=false: 이 차트가 만드는 Service는 메트릭용(7979)이라 쓰지 않는다.
  #     ALB Controller의 Service 관련 admission webhook이 아직 준비되지 않았을 때 다른 차트의
  #     Service 생성이 실패한 적이 있어(k8s/infra/terraform/README.md "Cleaning up after a
  #     failed apply") 그 경합의 소지를 아예 없앤다. 이 키는 1.22.0에만 있다(1.14.3은 무조건 생성).
  external_dns = {
    chart_version = "1.22.0"
    values = [yamlencode({
      policy        = "sync"
      txtOwnerId    = data.terraform_remote_state.cluster.outputs.cluster_name
      domainFilters = [data.terraform_remote_state.app_infra.outputs.route53_zone_name]
      sources       = ["ingress"]
      service       = { enabled = false }
    })]
  }

  tags = local.tags
}
