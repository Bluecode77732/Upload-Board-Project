provider "aws" {
  region = local.region
}

# 이 root 모듈 자신은 kubernetes_* 리소스를 직접 만들지 않는다(ADR 0043 D6로
# istio_system 네임스페이스 리소스가 삭제된 뒤론 더더욱). 그래도 이 provider는
# 필요하다 — module.eks_blueprints_addons(aws-ia/eks-blueprints-addons ~> 1.16)가
# 자신의 required_providers에 kubernetes를 명시하고 있어서(v1.16.0 소스 확인),
# root가 이 provider를 설정해 암묵적으로 넘겨주지 않으면 그 모듈이 깨진다.
# module.eks(terraform-aws-modules/eks/aws ~> 20.11)는 kubernetes provider를
# 요구하지 않는다 — 이 provider의 필요성은 전적으로 addons 모듈 때문이다.
provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    # This requires the awscli to be installed locally where Terraform is executed
    args = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

# 위 kubernetes provider와 같은 이유로 필요하다 — module.eks_blueprints_addons가
# enable_aws_load_balancer_controller/enable_external_secrets로 내부에서
# helm_release 리소스를 만든다(v1.16.0 소스의 module "aws_load_balancer_controller",
# module "external_secrets" 확인). root에 명시적 helm_release가 없다고 이
# provider가 불필요한 것은 아니다.
provider "helm" {
  kubernetes = {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)

    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      # This requires the awscli to be installed locally where Terraform is executed
      args = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
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

  # ADR 0043 D8 — 이 차트(k8s/helm/)는 아직 전용 ServiceAccount를 만들지 않고
  # 매니페스트가 없는 채로 각 네임스페이스의 default ServiceAccount를 그대로 쓴다.
  # 그래서 앱 IRSA 역할의 신뢰 정책도 일단 "default" SA를 대상으로 건다 — 이는
  # 같은 네임스페이스에서 default SA를 쓰는 모든 파드에 S3 권한이 열린다는 뜻이라,
  # 전용 ServiceAccount 도입은 별도 Helm 차트 작업으로 남는다(README 참고).
  app_service_account_namespace = "default"
  app_service_account_name      = "default"

  # ADR 0043 D7 — Helm 차트의 secrets.existingSecret이 참조할 Secret 이름.
  app_secret_k8s_name = "${local.name}-app-secrets"

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
  cluster_version                = "1.30"
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
      instance_types = ["m6g.large"]

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
# EKS Blueprints Addons
################################################################################

module "eks_blueprints_addons" {
  source  = "aws-ia/eks-blueprints-addons/aws"
  version = "~> 1.16"

  cluster_name      = module.eks.cluster_name
  cluster_endpoint  = module.eks.cluster_endpoint
  cluster_version   = module.eks.cluster_version
  oidc_provider_arn = module.eks.oidc_provider_arn

  # ADR 0043 D9 — Istio 없이도 유지: 이 프로젝트 자체 Ingress(ADR 0041,
  # 현재 비활성)가 ALB를 받으려면 필요하다.
  enable_aws_load_balancer_controller = true

  # ADR 0043 D7 — ADR 0033이 정한 ESO/IRSA 목표 형태를 이 모듈의 내장 플래그로
  # 구현한다. 모듈 소스(v1.16.0 기준, 핀된 버전과 일치 확인됨)가
  # enable_external_secrets로 차트 설치 + IRSA 역할 생성 + 그 역할의 서비스
  # 어카운트 주석까지 한 번에 처리하므로, 손으로 helm_release + aws_iam_role을
  # 따로 작성하지 않는다(ADR 0043 D7의 "Unverified" 각주에서 갈렸던 두 갈래 중
  # 이쪽 — 플래그가 실재함을 확인함).
  enable_external_secrets = true
  external_secrets_secrets_manager_arns = [
    aws_secretsmanager_secret.app.arn
  ]

  tags = local.tags
}

################################################################################
# Supporting Resources
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

################################################################################
# Database (ADR 0043 D2) — 관리형 RDS PostgreSQL, private 서브넷,
# EKS 노드 보안 그룹에서만 5432로 접근 가능
################################################################################

resource "aws_db_subnet_group" "db" {
  name       = "${local.name}-db"
  subnet_ids = module.vpc.private_subnets
  tags       = local.tags
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name}-rds-"
  description = "Allow Postgres access from EKS worker nodes only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Postgres from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# special=false — 특수문자를 넣으면 이 값이 지나가는 연결 문자열/셸 인용
# (`psql` URI, docker-compose env, kubectl 명령 등) 어딘가에서 이스케이프
# 문제가 생길 수 있다. length=24로 엔트로피는 충분히 확보하므로 그 위험을
# 감수할 이유가 없다.
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "aws_db_instance" "db" {
  identifier = "${local.name}-db"
  engine     = "postgres"
  # 마이너 버전(예: "16.4")을 안 적고 메이저만 적은 건 실수가 아니다 — AWS가
  # 최신 마이너를 자동으로 고르게 하고, apply를 반복할 때마다 Terraform이
  # "16" vs 실제 반영된 "16.x"를 서로 다른 값으로 보고 diff를 내는 걸
  # 피하려는 의도적 선택이다.
  engine_version = "16"

  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # 포트폴리오 규모 — 운영 백업 정책이 아니라 apply/destroy를 반복 검증하기
  # 위한 최소 설정(ADR 0043 D1이 실 apply로 검증하기로 한 것과 같은 맥락).
  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true

  tags = local.tags
}

################################################################################
# S3 (ADR 0043 D8) — private 버킷 + 앱 전용 IRSA 역할.
# 공개 정책은 두지 않는다 — 읽기는 항상 presigned 리다이렉트로 나간다(ADR 0036).
################################################################################

resource "aws_s3_bucket" "app" {
  bucket = var.s3_bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket = aws_s3_bucket.app.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "app_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:${local.app_service_account_namespace}:${local.app_service_account_name}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${local.name}-app"
  assume_role_policy = data.aws_iam_policy_document.app_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "app_s3" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.app.arn}/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.app.arn]
  }
}

resource "aws_iam_role_policy" "app_s3" {
  name   = "${local.name}-app-s3"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app_s3.json
}

################################################################################
# Secrets (ADR 0043 D7) — Helm의 secrets.existingSecret이 기대하는 4개 값을
# Secrets Manager에 생성하고, ESO가 그것을 네이티브 Secret으로 동기화한다.
# 값은 random_password로 생성되어 Terraform state에만 존재 — 변수/코드/버전관리에는
# 절대 리터럴로 남지 않는다.
################################################################################

resource "random_password" "access_token_secret" {
  length  = 48
  special = false
}

resource "random_password" "refresh_token_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name = "${local.name}-app-secrets"
  # 포트폴리오 규모 — apply/destroy를 반복 검증하는 동안 30일 복구 대기 없이
  # 즉시 재생성 가능하도록 한다.
  recovery_window_in_days = 0
  tags                    = local.tags
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DB_USERNAME          = var.db_username
    DB_PASSWORD          = random_password.db.result
    ACCESS_TOKEN_SECRET  = random_password.access_token_secret.result
    REFRESH_TOKEN_SECRET = random_password.refresh_token_secret.result
  })
}

# ADR 0043 D7 — SecretStore/ExternalSecret은 커스텀 리소스(CRD)라서, ESO
# 자신이 helm_release로 클러스터에 설치되기 전에는 스키마가 없어 같은 apply
# 안에서 kubernetes_manifest로 선언할 수 없다(Terraform kubernetes_manifest의
# 알려진 제약 — plan 시점에 CRD가 이미 존재해야 함). ADR 0043 D5가 도메인
# 등록을 "Terraform이 준비하고 개발자가 한 번 수동으로 잇는" 단계로 남긴 것과
# 같은 이유로, 여기서도 매니페스트 내용을 output으로 렌더링하고 실제 적용은
# `terraform output -raw external_secrets_manifest | kubectl apply -f -`
# 한 번으로 개발자가 수행한다(README 참고). auth 블록은 생략 — ESO 컨트롤러
# 파드 자신이 이미 IRSA 주석을 갖고 있어(모듈의 set_irsa_names) AWS SDK 기본
# 자격증명 체인으로 인증되는 "controller pod identity" 방식이다.
locals {
  external_secrets_manifest = <<-YAML
    apiVersion: external-secrets.io/v1beta1
    kind: SecretStore
    metadata:
      name: ${local.name}-secretsmanager
      namespace: default
    spec:
      provider:
        aws:
          service: SecretsManager
          region: ${local.region}
    ---
    apiVersion: external-secrets.io/v1beta1
    kind: ExternalSecret
    metadata:
      name: ${local.name}-app-secrets
      namespace: default
    spec:
      refreshInterval: 1h
      secretStoreRef:
        name: ${local.name}-secretsmanager
        kind: SecretStore
      target:
        name: ${local.app_secret_k8s_name}
        creationPolicy: Owner
      dataFrom:
        - extract:
            key: ${aws_secretsmanager_secret.app.name}
  YAML
}

################################################################################
# DNS + TLS (ADR 0043 D4/D5) — Route53 zone + DNS 검증된 ACM 인증서.
# 도메인 자체의 구매/등록은 이 설정의 범위 밖(D5) — apply 전에 개발자가 준비.
################################################################################

resource "aws_route53_zone" "app" {
  name = var.domain_name
  tags = local.tags
}

resource "aws_acm_certificate" "app" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  tags              = local.tags

  # create_before_destroy — 인증서를 교체해야 할 때(도메인 변경 등) 새 인증서를
  # 먼저 발급하고 검증까지 끝낸 뒤에 이전 인증서를 지운다. 순서를 반대로 하면
  # ALB Ingress가 잠깐 인증서 없는 상태에 놓여 다운타임이 생긴다.
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "app_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.app.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = aws_route53_zone.app.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "app" {
  certificate_arn         = aws_acm_certificate.app.arn
  validation_record_fqdns = [for r in aws_route53_record.app_cert_validation : r.fqdn]
}
