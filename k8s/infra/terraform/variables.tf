# ADR 0043(docs/ADR/0043-terraform-project-adaptation.md) D10이 정한 변수 목록.
# 비밀값(DB 비밀번호, 토큰 시크릿)은 여기 없다 — random_password로 생성되어
# Secrets Manager와 Terraform state에만 존재한다(D7/D8).

variable "region" {
  description = "리소스를 생성할 AWS 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "cluster_name" {
  description = "EKS 클러스터 이름이자 대부분의 리소스 이름 접두사. basename(path.cwd) 대신 명시적으로 둔다 — 클론/CI 체크아웃마다 디렉터리 이름이 달라지면 깨지는 값이었다"
  type        = string
  default     = "upload-board-project"
}

variable "vpc_cidr" {
  description = "VPC CIDR 블록"
  type        = string
  default     = "10.0.0.0/16"
}

variable "node_desired_size_graviton" {
  description = "arm64(Graviton) 관리형 노드 그룹의 desired size — ADR 0043 D3: 실 사용 용량은 이쪽이 기본"
  type        = number
  default     = 2
}

variable "node_desired_size_x64" {
  description = "amd64 관리형 노드 그룹의 desired size — ADR 0043 D3: Graviton 용량/가용성 문제가 생겼을 때만 수동으로 올리는 대기용, 기본은 0(유휴 비용 없음)"
  type        = number
  default     = 0
}

variable "db_instance_class" {
  description = "RDS 인스턴스 클래스 — 기본값은 Graviton 기반(db.t4g)으로 D3의 비용 기조와 일관됨"
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
