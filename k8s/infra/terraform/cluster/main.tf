# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D4 — cluster 상태:
# module.vpc + module.eks만 담당한다. RDS/S3/Secrets/DNS는 app-infra/로,
# module.eks_blueprints_addons(및 그것이 요구하는 kubernetes/helm provider)는
# addons/로 옮겨졌다 — 이 상태 자신은 kubernetes_*/helm_release 리소스를 만들지
# 않고 그런 provider도 필요로 하지 않는다.

provider "aws" {
  region = local.region
}

data "aws_availability_zones" "available" {
  # Do not include local zones
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  name   = var.cluster_name
  region = var.region

  vpc_cidr = var.vpc_cidr
  azs      = slice(data.aws_availability_zones.available.names, 0, 3)

  tags = merge(
    {
      Blueprint  = local.name
      GithubRepo = "github.com/aws-ia/terraform-aws-eks-blueprints"
    },
    var.tags
  )
}

################################################################################
# Cluster
################################################################################

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.11"

  cluster_name                   = local.name
  cluster_version                = "1.34"
  cluster_endpoint_public_access = true

  # Give the Terraform identity admin access to the cluster
  # which will allow resources to be deployed into the cluster
  enable_cluster_creator_admin_permissions = true

  cluster_addons = {
    coredns    = {}
    kube-proxy = {}
    vpc-cni    = {}
  }

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # ADR 0043 D3 — 단일 노드 그룹 대신 이기종 두 그룹. graviton이 실 사용 용량을
  # 맡고(ADR 0035가 이미 검증한 arm64 bcrypt prebuild + 이미지가 이미
  # linux/amd64,linux/arm64 멀티아치이므로 nodeSelector 없이도 정상 스케줄됨),
  # x64는 desired_size 0으로 유휴 비용 없이 수동 확장 대비용으로만 존재한다.
  eks_managed_node_groups = {
    graviton = {
      # 모듈 기본 ami_type이 x86_64라 arm64 인스턴스 계열엔 명시 필요
      # (실제 apply에서 InvalidParameterException으로 확인됨).
      ami_type = "AL2023_ARM_64_STANDARD"
      # t4g.micro는 노드당 파드 슬롯이 4개뿐이라 시스템 데몬셋+애드온만으로
      # 꽉 차 실제 앱 파드가 스케줄 안 됨(FailedScheduling). t4g.medium(슬롯 ~17개)로
      # 완화했다 — 애초엔 계정 결제수단/신원 검증(Free Tier 비대상) 전까지의 임시값
      # 이었으나, 검증이 끝난 뒤(2026-08-27) 개발자가 비용 대비 파드 슬롯 여유의
      # 가성비를 이유로 이 값을 확정했다. 설계 원안 m6g.large로의 복귀는 보류
      # (docs/ROADMAP.md §9, 2026-08-27 항목).
      instance_types = ["t4g.medium"]

      min_size     = 1
      max_size     = 5
      desired_size = var.node_desired_size_graviton
    }
    x64 = {
      instance_types = ["m5.large"]

      min_size     = 0
      max_size     = 2
      desired_size = var.node_desired_size_x64
    }
  }

  # ADR 0043 D6 — Istio 전용 포트(15017/15012) 규칙은 Istio 자체와 함께 제거됨.
  # (원래 이 자리에 있던 node_security_group_additional_rules 블록)

  tags = local.tags
}

################################################################################
# VPC
################################################################################

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = local.name
  cidr = local.vpc_cidr

  azs             = local.azs
  private_subnets = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 4, k)]
  public_subnets  = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k + 48)]

  # single_nat_gateway=true는 원본 스캐폴드에서 그대로 물려받은 값 — AZ 3개가
  # NAT 게이트웨이 하나를 공유해 비용은 아끼지만, 그 NAT가 죽으면 3개 AZ의
  # private 서브넷 아웃바운드가 전부 막히는 가용성 트레이드오프다. ADR 0043은
  # 이 값을 바꾸기로 결정한 적이 없다 — 포트폴리오 규모에서 굳이 AZ별 NAT로
  # 비용을 늘릴 이유를 찾지 못했기 때문.
  enable_nat_gateway = true
  single_nat_gateway = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }

  tags = local.tags
}
