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
    # D7(비밀 값 생성)이 추가한 provider — random_password로 DB/토큰 비밀값을
    # Terraform state 안에서만 생성하고, .tfvars나 코드에 리터럴로 적지 않는다.
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5, < 4.0"
    }
  }

  # ##  Used for end-to-end testing on project; update to suit your needs
  # backend "s3" {
  #   bucket = "terraform-ssp-github-actions-state"
  #   region = "us-west-2"
  #   key    = "e2e/istio/terraform.tfstate"
  # }
}
