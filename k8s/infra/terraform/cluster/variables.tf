# ADR 0043(docs/ADR/0043-terraform-project-adaptation.md) D10이 정한 변수 목록 중
# cluster 상태(module.vpc + module.eks)가 실제로 쓰는 것만 남긴다(ADR 0044 D5) —
# db_*/s3_bucket_name/domain_name 등 app-infra 전용 변수는 app-infra/variables.tf로
# 옮겨진다(별도 작업).

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

variable "tags" {
  description = "모든 리소스에 추가로 붙일 태그 — local.tags의 Blueprint/GithubRepo 태그에 더해진다"
  type        = map(string)
  default     = {}
}
