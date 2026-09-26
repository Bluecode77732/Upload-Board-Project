# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D1/D2/D4 — app-infra 상태:
# RDS + S3(IRSA 포함) + Secrets Manager + Route53/ACM만 담당한다. cluster/의
# module.vpc/module.eks 출력을 terraform_remote_state(backend s3, ADR 0057)로
# 단방향 읽기만 한다(D2/D3) — app-infra는 cluster를 읽지만 cluster는 app-infra를
# 절대 읽지 않는다. cluster/의 실제 state가 S3로 옮겨간 이상 로컬 상대경로로는
# 더 이상 읽을 수 없다 — 이 상태 자신의 backend "s3" 블록(versions.tf)과 같은
# 버킷·리전을 가리켜야 한다(ADR 0057).

provider "aws" {
  region = local.region
}

data "terraform_remote_state" "cluster" {
  backend = "s3"

  config = {
    bucket = var.tfstate_bucket_name
    key    = "cluster/terraform.tfstate"
    region = var.region
  }
}

locals {
  name   = var.cluster_name
  region = var.region

  # ADR 0043 D8, 갱신 2026-09-03 — 이 차트(k8s/helm/)가 이제 전용 ServiceAccount
  # 템플릿(serviceaccount.yaml, serviceAccount.create)을 만들 수 있게 되면서
  # (docs/ROADMAP.md §7), 앱 IRSA 역할의 신뢰 정책 대상도 네임스페이스의 default SA가
  # 아니라 그 전용 SA로 옮겼다. 이름은 이 차트가 이미 쓰는 helm install sharenpo .
  # 관례에 맞춰 "sharenpo"로 확정(ROADMAP.md §7) — 릴리스를 그 이름으로 설치했을 때만
  # sharenpo.serviceAccountName 헬퍼가 이 값과 정확히 일치한다. 네임스페이스는 이 앱이
  # 여전히 default 네임스페이스에 배포되므로 그대로 둔다.
  app_service_account_namespace = "default"
  app_service_account_name      = "sharenpo"

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
# Database (ADR 0043 D2) — 관리형 RDS PostgreSQL, private 서브넷,
# EKS 노드 보안 그룹에서만 5432로 접근 가능
################################################################################

resource "aws_db_subnet_group" "db" {
  name       = "${local.name}-db"
  subnet_ids = data.terraform_remote_state.cluster.outputs.private_subnets
  tags       = local.tags
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name}-rds-"
  description = "Allow Postgres access from EKS worker nodes only"
  vpc_id      = data.terraform_remote_state.cluster.outputs.vpc_id

  ingress {
    description     = "Postgres from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [data.terraform_remote_state.cluster.outputs.node_security_group_id]
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

# ADR 0036 addendum(2026-09-22) — private/unlisted 파일의 presigned 리다이렉트를 브라우저가
# blob으로 읽으려면(비공개 파일 미리보기) 이 CORS 규칙이 있어야 한다. 운영 origin은
# ADR 0060으로 ALB 호스트 하나로 확정됐다(var.domain_name — values-prod.yaml의 BASE_URL과
# 같은 값). 이 리소스는 버킷의 CORS 설정을 통째로 관장한다 — 2026-08-16에 손으로 돌렸던
# localhost 개발 origin용 스크립트를 대체하는 게 아니라 apply 시점에 그 규칙을 통째로
# 덮어쓴다. GET만 허용하는 이유는 presigned GetObject 응답을 읽는 게 이 프로젝트의 유일한
# 교차 출처 읽기이기 때문이다(ADR 0036).
resource "aws_s3_bucket_cors_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  cors_rule {
    allowed_methods = ["GET"]
    allowed_origins = ["https://${var.domain_name}"]
    allowed_headers = ["*"]
    max_age_seconds = 300
  }
}

data "aws_iam_policy_document" "app_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.terraform_remote_state.cluster.outputs.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${data.terraform_remote_state.cluster.outputs.oidc_provider}:sub"
      values   = ["system:serviceaccount:${local.app_service_account_namespace}:${local.app_service_account_name}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${data.terraform_remote_state.cluster.outputs.oidc_provider}:aud"
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

# 두 JWT 시크릿은 backend/app.module.ts의 Joi 규칙(32자 이상, 대문자·소문자·숫자·기호 각 1개
# 이상)을 통과해야 앱이 부팅한다. special=false로 만들면 기호가 없어 부팅 중에 종료된다(2026-09-26
# 첫 라이브 배포에서 발견 — Joi 규칙은 09-11에 강화됐지만 이 생성 쪽은 그대로였다). 기호는 URL·셸
# 어디서 다뤄져도 이스케이프가 필요 없는 "-_"만 쓴다(위 DB 비밀번호가 special=false인 이유와 같다).
# min_*는 무작위 결과가 우연히 한 종류를 빠뜨리는 경우까지 막아, 규칙이 항상 충족되게 한다.
resource "random_password" "access_token_secret" {
  length           = 48
  special          = true
  override_special = "-_"
  min_lower        = 1
  min_upper        = 1
  min_numeric      = 1
  min_special      = 1
}

resource "random_password" "refresh_token_secret" {
  length           = 48
  special          = true
  override_special = "-_"
  min_lower        = 1
  min_upper        = 1
  min_numeric      = 1
  min_special      = 1
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
# 파드 자신이 이미 IRSA 주석을 갖고 있어(addons/의 eks_blueprints_addons가
# 붙이는 set_irsa_names) AWS SDK 기본 자격증명 체인으로 인증되는
# "controller pod identity" 방식이다. 이 매니페스트는 app-infra 자신의 자원
# (Secrets Manager 시크릿 이름/ARN)만 참조하므로 addons/의 클러스터 연결
# 정보가 필요 없다 — cluster/를 향한 두 번째 remote_state 읽기가 필요 없는
# 이유이기도 하다.
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

  # ADR 0063 D4 — Terraform 밖에서 만든 재사용 위임 세트를 물리면 zone을 다시 만들어도 같은
  # 네임서버 4개를 받는다. 세트는 일부러 이 state의 리소스가 아니다(aws_route53_delegation_set을
  # 쓰면 destroy 때 함께 지워져 고정의 의미가 없다). null이면 기존처럼 zone마다 새 네임서버.
  delegation_set_id = var.delegation_set_id

  # ADR 0063 D3 — ALB로 가는 레코드는 ExternalDNS가 만든다(addons/). 그 레코드는 이 state가
  # 모르므로, 남아 있으면 zone destroy가 실패한다. true면 zone 안의 모든 레코드를 함께 지운다 —
  # 이 zone은 이 앱 전용이라 감수한다. ExternalDNS의 policy=sync가 먼저 지워 주겠지만 그것은
  # 1분 주기와 파드 생존에 달려 있어 destroy의 성공 조건으로 삼지 않는다.
  force_destroy = true
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
