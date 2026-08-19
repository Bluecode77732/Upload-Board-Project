# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D5 — 기존 3개
# (configure_kubectl/cluster_endpoint/cluster_name)에 더해, app-infra/와 addons/가
# terraform_remote_state로 읽어가는 신규 4개(node_security_group_id/
# oidc_provider_arn/oidc_provider/cluster_certificate_authority_data)를 노출한다.
# 이 값들은 오늘의 단일 루트 모듈에서는 module.eks.* 직접 참조로만 쓰였고
# output이 아니었다 — 상태를 분리하면 그 직접 참조가 불가능해지므로 반드시 output이
# 되어야 한다.
#
# vpc_id/private_subnets — D5의 4개 목록에는 없었지만, D1/coupling point 1이 이미
# 서술한 대로 module.vpc는 module.eks뿐 아니라 aws_db_subnet_group.db/
# aws_security_group.rds(둘 다 app-infra 리소스)의 소비 대상이다. app-infra/ 구현
# 중 이 두 output이 빠져 있으면 그 두 리소스가 참조할 값이 없다는 것이 확인되어
# 여기 추가한다 — D5 목록의 누락을 메우는 것으로, coupling point 1 자체는 새로운
# 결정이 아니다.

output "configure_kubectl" {
  description = "Configure kubectl: make sure you're logged in with the correct AWS profile and run the following command to update your kubeconfig"
  value       = "aws eks --region ${local.region} update-kubeconfig --name ${module.eks.cluster_name}"
}

output "cluster_endpoint" {
  description = "EKS 클러스터 API 엔드포인트"
  value       = module.eks.cluster_endpoint
}

output "cluster_name" {
  description = "EKS 클러스터 이름"
  value       = module.eks.cluster_name
}

output "node_security_group_id" {
  description = "EKS 워커 노드 보안 그룹 ID — app-infra/의 RDS 보안 그룹 ingress 규칙이 이 값을 소스로 참조한다(ADR 0044 D5 coupling point 2)"
  value       = module.eks.node_security_group_id
}

output "oidc_provider_arn" {
  description = "EKS OIDC 프로바이더 ARN — app-infra/의 S3 IRSA 역할 assume-role 정책과 addons/의 eks_blueprints_addons가 이 값을 참조한다(ADR 0044 D5 coupling point 3/4)"
  value       = module.eks.oidc_provider_arn
}

output "oidc_provider" {
  description = "EKS OIDC 프로바이더(URL, https:// 접두사 제외) — app-infra/의 IRSA assume-role 정책 조건절(StringEquals ...:sub/:aud)이 이 값을 참조한다(ADR 0044 D5 coupling point 3)"
  value       = module.eks.oidc_provider
}

output "cluster_certificate_authority_data" {
  description = "EKS 클러스터 CA 인증서(base64) — addons/의 kubernetes/helm provider 설정이 이 값을 참조한다(ADR 0044 D5 coupling point 4)"
  value       = module.eks.cluster_certificate_authority_data
}

output "vpc_id" {
  description = "VPC ID — app-infra/의 aws_security_group.rds가 이 값을 참조한다(ADR 0044 D1 coupling point 1, D5 목록 보완)"
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "private 서브넷 ID 목록 — app-infra/의 aws_db_subnet_group.db가 이 값을 참조한다(ADR 0044 D1 coupling point 1, D5 목록 보완)"
  value       = module.vpc.private_subnets
}
