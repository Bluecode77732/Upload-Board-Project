# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D5 — app-infra 상태는
# RDS/S3/IRSA/Secrets Manager/Route53/ACM만 담당한다. kubernetes/helm provider는
# 필요 없다(그건 addons/의 module.eks_blueprints_addons 때문에만 필요했다 — 기존
# 루트 main.tf의 확인된 주석 참고). random provider는 D7(비밀 값 생성)이 남긴 그대로
# 필요하다.

terraform {
  required_version = ">= 1.3"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.34, < 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5, < 4.0"
    }
  }
}
