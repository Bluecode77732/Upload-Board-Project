# ADR 0043(docs/ADR/0043-terraform-project-adaptation.md) D10이 정한 변수 목록 중
# addons 상태(module.eks_blueprints_addons)가 실제로 쓰는 것만 남긴다(ADR 0044
# D5의 연장). region/cluster_name은 이 상태의 provider 설정과 태그(local.tags)에
# 그대로 필요해 cluster/variables.tf/app-infra/variables.tf와 값을 동일하게
# 유지해야 한다 — terraform_remote_state로 값이 자동 공유되지 않는 순수 변수이므로
# 세 상태 모두에 중복 선언되어 있다.

variable "region" {
  description = "리소스를 생성할 AWS 리전 — cluster/variables.tf의 region과 동일한 값을 유지해야 한다"
  type        = string
  default     = "ap-northeast-2"
}

variable "cluster_name" {
  description = "태그 접두사(local.tags.Blueprint) — cluster/variables.tf의 cluster_name과 동일한 값을 유지해야 한다. 클러스터 이름 자체는 cluster/의 remote_state 출력(cluster_name)에서 읽으므로 이 변수가 그 값을 대신하지 않는다"
  type        = string
  default     = "upload-board-project"
}

variable "tags" {
  description = "모든 리소스에 추가로 붙일 태그 — local.tags의 Blueprint/GithubRepo 태그에 더해진다"
  type        = map(string)
  default     = {}
}
