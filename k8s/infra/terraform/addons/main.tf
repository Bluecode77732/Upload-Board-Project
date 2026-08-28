# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D2/D4 — addons 상태:
# module.eks_blueprints_addons(ALB Controller + External Secrets Operator)만
# 담당한다. cluster/와 app-infra/ 양쪽을 terraform_remote_state(backend local)로
# 읽는 유일한 상태다(D2) — coupling point 4: 이 애드온 레이어는 EKS 연결 정보
# (cluster/)와 Secrets Manager ARN(app-infra/)을 동시에 필요로 해서, 어느 한쪽에
# 접어 넣으면 순환 참조 또는 억지 apply 순서가 생긴다.

data "terraform_remote_state" "cluster" {
  backend = "local"

  config = {
    path = "${path.module}/../cluster/terraform.tfstate"
  }
}

data "terraform_remote_state" "app_infra" {
  backend = "local"

  config = {
    path = "${path.module}/../app-infra/terraform.tfstate"
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
    # This requires the awscli to be installed locally where Terraform is executed
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
      # This requires the awscli to be installed locally where Terraform is executed
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

  tags = local.tags
}
