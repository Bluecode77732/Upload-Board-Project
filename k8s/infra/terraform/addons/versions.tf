# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D5 — addons 상태는
# module.eks_blueprints_addons만 담당한다. kubernetes/helm provider는 이 모듈
# 자신이 required_providers에 명시하기 때문에 필요하다(기존 루트 main.tf의
# 확인된 주석 참고). random provider는 필요 없다 — 비밀값 생성(D7)은
# app-infra/의 책임이다.

terraform {
  # ADR 0057 — use_lockfile(S3 네이티브 락)이 1.11에서 GA
  required_version = ">= 1.11"

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

  # ADR 0057 D1/D2/D3 — local(기본값) 대신 S3 백엔드. bucket은 전역 유일 이름이라
  # 커밋하지 않고 `terraform init -backend-config="bucket=<value>"`로 init 시점에
  # 지정한다(s3_bucket_name과 동일한 컨벤션, ADR 0043 D8). region은 backend 블록이
  # 변수를 참조할 수 없어 var.region의 현재 기본값을 그대로 리터럴로 둔다 — 리전을
  # 바꾸면 이 값도 수동으로 맞춰야 한다. DynamoDB/KMS는 쓰지 않는다(D2/D3 rationale).
  backend "s3" {
    key          = "addons/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
