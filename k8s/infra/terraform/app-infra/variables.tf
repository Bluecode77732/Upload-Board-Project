# ADR 0043(docs/ADR/0043-terraform-project-adaptation.md) D10이 정한 변수 목록 중
# app-infra 상태(RDS/S3/IRSA/Secrets/Route53/ACM)가 실제로 쓰는 것만 남긴다
# (ADR 0044 D5) — cluster 전용 변수(node_desired_size_* 등)는 cluster/variables.tf에
# 남아 있다(별도 작업). region/cluster_name은 이 상태의 provider 설정과 리소스 이름
# 접두사(local.name)에 그대로 필요해 cluster/variables.tf와 값을 동일하게 유지해야
# 한다 — terraform_remote_state로 값이 자동 공유되지 않는 순수 변수이므로 중복
# 선언이다.

variable "region" {
  description = "리소스를 생성할 AWS 리전 — cluster/variables.tf의 region과 동일한 값을 유지해야 한다"
  type        = string
  default     = "ap-northeast-2"
}

variable "cluster_name" {
  description = "리소스 이름 접두사 — cluster/variables.tf의 cluster_name과 동일한 값을 유지해야 한다"
  type        = string
  default     = "upload-board-project"
}

variable "db_instance_class" {
  description = "RDS 인스턴스 클래스 — 기본값은 Graviton 기반(db.t4g)으로 ADR 0043 D3의 비용 기조와 일관됨"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS 할당 스토리지(GiB) — gp3 최소 실용 크기"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "RDS 안에 생성할 데이터베이스 이름 — Helm 배포 시 env.DB_DATABASE에 그대로 전달"
  type        = string
  default     = "upload_board"
}

variable "db_username" {
  description = "RDS 마스터 사용자 이름 — 비밀이 아님(비밀번호는 D7이 생성). Helm 배포 시 secrets의 DB_USERNAME으로 전달"
  type        = string
  default     = "upload_board_admin"
}

variable "s3_bucket_name" {
  description = "STORAGE_DRIVER=s3용 S3 버킷 이름 — 버킷 이름은 전역적으로 유일해야 하므로 안전한 기본값이 없다(ADR 0043 D8)"
  type        = string
}

variable "domain_name" {
  description = "ALB Ingress + ACM 인증서에 쓸 도메인. Route53 호스팅 영역은 이 값으로 Terraform이 생성하지만, 도메인 자체의 구매/등록은 이 설정의 범위 밖이다(ADR 0043 D5) — apply 전에 개발자가 직접 준비"
  type        = string
}

variable "tags" {
  description = "모든 리소스에 추가로 붙일 태그 — local.tags의 Blueprint/GithubRepo 태그에 더해진다"
  type        = map(string)
  default     = {}
}
