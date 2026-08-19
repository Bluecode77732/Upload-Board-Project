# ADR 0044(docs/ADR/0044-terraform-three-state-split.md) D5 — 기존 3개
# (configure_kubectl/cluster_endpoint/cluster_name)에 더해, app-infra/와 addons/가
# terraform_remote_state로 읽어가는 신규 4개(node_security_group_id/
# oidc_provider_arn/oidc_provider/cluster_certificate_authority_data)를 노출한다.
# 이 값들은 오늘의 단일 루트 모듈에서는 module.eks.* 직접 참조로만 쓰였고
# output이 아니었다 — 상태를 분리하면 그 직접 참조가 불가능해지므로 반드시 output이
# 되어야 한다.

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
