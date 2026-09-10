# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D5 — cluster 상태는
# module.vpc + module.eks만 담당한다. module.eks(terraform-aws-modules/eks/aws
# ~> 20.11)는 kubernetes provider를 요구하지 않으므로(기존 루트 main.tf의 확인된
# 주석 참고 — 그 필요는 전적으로 addons/의 module.eks_blueprints_addons 때문이었다),
# kubernetes/helm/random provider는 이 상태에 없다.

terraform {
  required_version = ">= 1.3"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.34, < 6.0"
    }
  }
}
