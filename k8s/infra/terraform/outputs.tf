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

output "db_host" {
  description = "RDS 엔드포인트 — Helm 배포 시 env.DB_HOST에 전달"
  value       = aws_db_instance.db.address
}

output "db_port" {
  description = "RDS 포트 — Helm 배포 시 env.DB_PORT에 전달"
  value       = aws_db_instance.db.port
}

output "db_name" {
  description = "RDS 데이터베이스 이름 — Helm 배포 시 env.DB_DATABASE에 전달"
  value       = aws_db_instance.db.db_name
}

output "s3_bucket_name" {
  description = "STORAGE_DRIVER=s3용 S3 버킷 이름 — Helm 배포 시 env.S3_BUCKET에 전달"
  value       = aws_s3_bucket.app.bucket
}

output "app_iam_role_arn" {
  description = "앱 파드가 S3에 접근할 때 쓰는 IRSA 역할 ARN. default ServiceAccount에 걸려 있다는 제약은 README 참고"
  value       = aws_iam_role.app.arn
}

output "app_secrets_manager_secret_arn" {
  description = "DB_USERNAME/DB_PASSWORD/ACCESS_TOKEN_SECRET/REFRESH_TOKEN_SECRET을 담은 Secrets Manager 시크릿 ARN"
  value       = aws_secretsmanager_secret.app.arn
}

output "app_secret_k8s_name" {
  description = "ESO가 동기화해 만들 네이티브 Secret 이름 — helm install --set secrets.existingSecret=<이 값>"
  value       = local.app_secret_k8s_name
}

output "external_secrets_manifest" {
  description = "SecretStore + ExternalSecret YAML — `terraform output -raw external_secrets_manifest | kubectl apply -f -` 로 한 번 적용한다(README 참고)"
  value       = local.external_secrets_manifest
}

output "route53_zone_name_servers" {
  description = "도메인 등록기관(또는 기존 registrar)에 지정해야 할 네임서버 목록 — ACM DNS 검증의 전제조건(ADR 0043 D5)"
  value       = aws_route53_zone.app.name_servers
}

output "acm_certificate_arn" {
  description = "ALB Ingress의 alb.ingress.kubernetes.io/certificate-arn 주석에 쓸 ACM 인증서 ARN(ADR 0043 D9)"
  value       = aws_acm_certificate_validation.app.certificate_arn
}
