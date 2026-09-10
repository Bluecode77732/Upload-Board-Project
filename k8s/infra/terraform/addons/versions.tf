# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D5 — addons 상태는
# module.eks_blueprints_addons만 담당한다. kubernetes/helm provider는 이 모듈
# 자신이 required_providers에 명시하기 때문에 필요하다(기존 루트 main.tf의
# 확인된 주석 참고). random provider는 필요 없다 — 비밀값 생성(D7)은
# app-infra/의 책임이다.

terraform {
  required_version = ">= 1.3"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.34, < 6.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 3.0, < 4.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.20"
    }
  }
}
