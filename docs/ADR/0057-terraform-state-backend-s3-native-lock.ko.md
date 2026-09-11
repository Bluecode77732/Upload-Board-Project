# ADR 0057: Terraform State 백엔드 — S3 네이티브 락, DynamoDB·KMS 없이

- Status: Accepted — 코드 완료, 미적용 (버킷 생성과 state 마이그레이션은 실제
  배포 시점으로 유예)
- Date: 2026-09-12
- Amends: [ADR 0044](0044-terraform-three-state-split.md) D3 ("local backend, 두 번째
  개발자나 CI 파이프라인이 필요해지면 재검토"라는 입장을 그 트리거보다 먼저 재검토함 —
  이유는 다름, Context 참고)
- English: [0057-terraform-state-backend-s3-native-lock.md](0057-terraform-state-backend-s3-native-lock.md)

## Context

2026-09-09 `k8s/infra/terraform/` 보안 점검에서 세 state(`cluster/`, `app-infra/`,
`addons/`) 모두 Terraform 기본값인 local backend를 쓰고 있고(`versions.tf`에 `backend`
블록 없음), `app-infra/main.tf`의 `random_password.db`, `random_password.access_token_secret`,
`random_password.refresh_token_secret`의 `.result` 값이 로컬 `terraform.tfstate`에
그대로 평문 저장된다는 것을 확인했다 — Terraform state는 provider의 `sensitive` 표시와
무관하게 모든 리소스 속성을 평문 저장한다(이 저장소 설정의 버그가 아니라 Terraform
자체의 기본 동작). `app-infra/main.tf`를 직접 읽어(83, 104, 208, 213, 226-232행) 추측이
아니라 확인한 사실이다.

점검 시점 기준 실질 위험은 0이었다 — 세 state 모두 현재 리소스가 비어 있다(이 프로젝트가
2026-08-25–27에 실제 적용했던 AWS 스택은 2026-08-28에 완전히 해체됨, ROADMAP.md §9 참고)
— 하지만 위험은 다음 실제 `apply` 시점부터 발생하고, 세 state가 모두 비어 있는 지금이
백엔드를 바꾸는 가장 저렴한 시점이다(`-migrate-state`가 옮길 실제 리소스 목록이 없으므로).

ADR 0044 D3는 S3+DynamoDB-lock 트리거("두 번째 개발자나 CI 파이프라인이 이 설정을
apply해야 할 때")를 이미 언급했고, 아무것도 `apply`된 적 없는 시점에 그것을 의도적으로
불필요한 범위 확장으로 보고 미뤘다. 이 ADR은 8월 당시 그 판단이 틀렸다고 보지 않는다 —
*결론*을 재검토하는 이유는 다른 트리거(팀 성장이 아니라 구체적인 평문 시크릿 노출)가
지금 적용되고, ADR 0044 작성 당시 GA가 아니었던 Terraform 기능 두 가지가 "원격 백엔드"의
실제 비용을 바꿔놓았기 때문이다:

- **S3 네이티브 락**(`use_lockfile`) — Terraform 1.11에서 GA(이 프로젝트에 설치된 CLI는
  1.15.8). 별도 DynamoDB 테이블 대신 S3 conditional write(`PutObject` +
  `If-None-Match`)로 `.tflock` 객체를 만든다.
- **SSE-S3**(`encrypt = true`, AES256)는 원래부터 S3에 내장된 무료 기능이다 — ADR 0044
  D3가 언급한 원래 대안("S3+DynamoDB-lock ... 원격 백엔드")은 암묵적으로 SSE-KMS를
  전제했고, 그래서 실제보다 더 큰 작업처럼 느껴졌다.

개발자와 세션 내에서 여러 대안을 논의하고 기각한 뒤 아래 결정에 도달했다(전체 기록은
세션에, 요약은 "기각된 대안"에).

## Decision

### D1 — 저장 백엔드: S3, 버킷 1개, state별 key 1개

세 state의 `versions.tf` 각각에 `backend "s3" {}` 블록을 추가한다(`cluster/`는 key
`cluster/terraform.tfstate`, `app-infra/`는 `app-infra/terraform.tfstate`, `addons/`는
`addons/terraform.tfstate` — 버킷 3개가 아니라 버킷 1개 + key 구분). 버킷 이름은
**커밋하지 않는다** — `terraform { backend }` 블록은 변수를 참조할 수 없어(Terraform이
나머지 설정보다 먼저 평가함) `terraform init -backend-config="bucket=<value>"`로 init
시점에 넘긴다 — 전역 유일 이름에 안전한 기본값을 두지 않는 기존 컨벤션(`s3_bucket_name`,
ADR 0043 D8)과 동일하다. 제안 이름은 `sharenpo-tfstate` — 결정 시점에
`aws s3api head-bucket --bucket sharenpo-tfstate`로 전역 가용 확인함(404 Not Found =
아직 아무도 안 씀). 단 이것이 실제 버킷 생성 시점까지 그 이름이 계속 비어 있다는 보장은
아니다. `region`도 리터럴(`"ap-northeast-2"`, `var.region` 기본값과 동일)이다 — backend
블록은 `var.region`도 읽을 수 없기 때문. 리전 기본값이 바뀌면 세 `versions.tf` 모두 이
값을 수동으로 맞춰야 한다.

### D2 — 락: S3 네이티브(`use_lockfile = true`), DynamoDB 아님

세 `versions.tf` 모두 `required_version`을 `>= 1.3`에서 `>= 1.11`로 올려야 한다. 별도
DynamoDB 테이블도, 그를 위한 IAM 권한 범위도 없다. 온디맨드 과금 기준 락 테이블 비용은
어느 백엔드를 쓰든 이미 $0에 가까웠다 — DynamoDB를 뺀 이유는 비용이 아니라, 동일한 락
동작을 위해 프로비저닝·관리할 리소스와 IAM 권한이 하나 줄어든다는 점이다.

### D3 — 암호화: SSE-S3(`encrypt = true`), SSE-KMS 아님

일반적인 프로덕션 기본값에서 의도적으로 벗어난 결정이다. 프로덕션 Terraform state
버킷이 보통 SSE-KMS를 기본으로 삼는 이유는 비용이 아니다(고객 관리형 키는 AWS 공식
요금 페이지 기준 월 $1 고정) — "누가 `s3:GetObject` 할 수 있는가"와 "누가 복호화할 수
있는가"를 별도 키 정책으로 분리하고 CloudTrail 감사 이력을 남길 수 있다는 점이다. 그
가치는 분리할 대상이 되는 두 번째 주체가 있어야 성립한다. 이 AWS 계정(`074416822640`)은
사람 주체가 개발자 1명(IAM 사용자 `sharenpo-user`)뿐이라, S3 읽기 권한이 이미 닿는
범위 밖에서 복호화 권한만 따로 막을 대상이 없다. SSE-S3만으로 이 ADR의 실제 목적(평문
저장 방지)은 추가 비용 없이 이미 해소된다. 재검토 시점은 D6 참고.

### D4 — `terraform_remote_state` 데이터소스도 S3로 이동(유예 불가)

`app-infra/main.tf`의 `data.terraform_remote_state.cluster`와 `addons/main.tf`의
`data.terraform_remote_state.cluster`/`data.terraform_remote_state.app_infra`는 이전까지
`backend = "local"` + 상대경로(`${path.module}/../cluster/terraform.tfstate` 등)를
썼다 — 이는 각 state 자신의 저장 백엔드(D1)와는 별개인, "local"의 **두 번째** 용법이고,
ADR 0044 D3의 "local"이라는 표현은 이 둘을 구분하지 않고 함께 가리켰다. `cluster/`·
`app-infra/`의 실제 state가 S3로 옮겨가면 이 상대경로 읽기는 더 이상 의미 있는 값을
가리키지 못하므로, 이 변경은 나중으로 미룰 수 있는 후속 작업이 아니라 D1과 같은
변경에 함께 들어가야 한다 — 그러지 않으면 `app-infra`/`addons`가 의존하는 출력값을
읽을 방법이 없어진다. 최상위 `backend` 블록과 달리 `data "terraform_remote_state"`
블록은 평범한 데이터소스라 변수를 읽을 수 있어서, 두 번째 `-backend-config` 방식
대신 `app-infra/variables.tf`·`addons/variables.tf`에 새 `tfstate_bucket_name`
변수(기본값 없음, `s3_bucket_name`과 같은 이유)를 추가했다.

### D5 — 버킷 생성과 마이그레이션은 실제 배포 시점으로 유예

이 ADR은 버킷을 생성하지도, `terraform init -migrate-state`를 실행하지도 않는다. 세
state 모두 현재 비어 있어 지금 옮길 것이 없고, 이 AWS 계정에는 이미 유효한 자격증명이
설정되어 있다 — 지금 버킷을 만들면 실제 배포가 뒤따르지 않는데도 실질적인(비록
저렴하더라도) AWS 부수효과가 발생한다. `k8s/infra/terraform/README.md`에 1회성
런북 단계(수동 `aws s3api create-bucket` + `put-bucket-versioning` +
`put-public-access-block`, 그 다음 세 디렉터리 각각에서 `terraform init
-backend-config=...`, `cluster` → `app-infra` → `addons` 순서)를 추가해, 실제 apply가
정말 임박한 시점에 한 번 실행하도록 한다.

### D6 — 향후 트리거: 이 계정에 두 번째 주체가 생기면 SSE-KMS 재검토(DynamoDB는 아님)

이 AWS 계정에 두 번째 사람이나 서비스 주체(두 번째 개발자, 자체 IAM 역할을 가진 CI
파이프라인)가 생겨서 state 버킷을 "복호화는 안 되지만 읽기는 되는" 상태로 접근해야
하거나, 컴플라이언스 요구(감사 이력, 강제 키 로테이션)가 생기면 `encrypt = true`를
`kms_key_id = <arn>`로 바꾼다 — KMS의 가치는 복호화 권한을 분리할 두 번째 주체가
생기는 순간 성립한다. 이것이 **DynamoDB를 다시 묶어 들이는 것은 아니다** —
`use_lockfile`은 동시에 apply하는 주체 수와 무관하게 동일한 분산 락 보장을 제공하므로,
팀·파이프라인 성장 자체는 DynamoDB를 되살릴 이유가 아니다. 개발자가 기록해달라고 요청한
"프로젝트·팀 규모가 커지면" 트리거를 막연히 "(a)안으로 되돌아간다"가 아니라 정확하게
표현한 것이다.

## 기각된 대안

- **지금 S3 + DynamoDB + KMS** (ADR 0044 D3가 언급한 그대로의 형태) — 위 D1–D3로
  대체됨: `use_lockfile`(ADR 0044 작성 이후 GA)이 락 목적의 DynamoDB를 불필요하게
  만들고, 이 계정의 단일 주체 구조가 KMS의 실질 가치를 지금은 무의미하게 만든다(D3,
  D6 참고).
- **Terraform Cloud(HCP Terraform)** — AWS 비용 $0, state 암호화 기본 제공이지만
  ROADMAP이 명시한 DevOps 스택(AWS·Docker·K8s·Helm·GitHub Actions·Prometheus·
  Grafana·Terraform·Istio)에 없는 새 외부 SaaS 계정/워크스페이스 의존성을 추가한다.
- **local backend 유지 + 호스트 디스크 자체 암호화**(BitLocker 등) — 이 개발
  머신은 Windows 10 **Home**이라 전통적 BitLocker가 없고, 더 가벼운 "장치 암호화"
  기능은 하드웨어 조건(TPM, Modern Standby)에 달려 있는데 이 머신이 그 조건을
  만족하는지 확인되지 않았다. 가능하더라도 구조적 문제(로컬 단일 사본, 락 없음,
  머신 간 내구성 없음)는 그대로 남는다. 더 나쁜 선택이 아니라 목표 자체를
  신뢰성 있게 만족시키지 못한다고 보고 기각했다.
- **Terraform 자체 로컬 state 암호화**(`encryption` 블록, `pbkdf2` key provider —
  1.9에서 GA) — "평문 저장 안 함"이라는 목표는 AWS 리소스 없이 $0로 정말 해결한다.
  D1–D3를 선택한 이유는 이 방식이 여전히 로컬 파일 1개 단일 사본이라 머신 밖 내구성도
  락도 없고(S3는 둘 다 거의 같은 한계비용으로 해결), passphrase 분실 시 state가
  영구적으로 잠긴다는 S3+IAM에는 없는 새 실패 모드가 생기기 때문이다.
- **지금 버킷을 만들어 마이그레이션을 검증하고 바로 지우기** — 명시적으로 검토하고
  기각했다: 이렇게 하면 이 ADR이 해결하려는 바로 그 평문-로컬 state 상태로 되돌아간다
  (이 작업의 핵심은 "가능하다는 걸 한 번 증명"이 아니라 *지속되는* 백엔드다). S3
  버킷 이름은 이 계정뿐 아니라 모든 AWS 계정이 공유하는 전역 네임스페이스라,
  `sharenpo-tfstate`를 지웠다가 나중에 다시 만든다고 해서 그 사이 다른 계정이
  선점하지 않는다는 보장이 없다 — 그마저도 존재하지 않는 비용 절감(유휴 S3 버킷
  비용은 이미 무시할 수준)을 위해서다.

## Consequences

- `cluster/versions.tf`, `app-infra/versions.tf`, `addons/versions.tf`: `required_version`을
  `>= 1.3` → `>= 1.11`로 상향; 각각 `backend "s3" {}` 블록 추가(D1/D2/D3).
- `app-infra/main.tf`, `addons/main.tf`: `data.terraform_remote_state` 블록이
  `backend = "local"` + 상대경로에서 `backend = "s3"` + `var.tfstate_bucket_name`로
  변경(D4).
- `app-infra/variables.tf`, `addons/variables.tf`: 새 `tfstate_bucket_name` 변수(기본값
  없음, D4).
- `k8s/infra/terraform/README.md`(+`.ko.md`): "Future" 절을 "unscheduled"에서 구체적인
  1회성 부트스트랩 런북으로 재작성(D5); apply/plan 명령 예시에 기존
  `-var="s3_bucket_name=..."` 옆에 `-var="tfstate_bucket_name=<value>"` 추가.
- `docs/ROADMAP.md`(+`.ko.md`) §7: "Terraform remote state backend" 항목을 더 이상
  unscheduled가 아니라 결정됨/코드 완료로 표시.
- 이번 세션에서 세 디렉터리 모두 `terraform init -backend=false`, `terraform fmt
  -check`, `terraform validate`가 통과함을 확인했다. **실제 S3 백엔드를 향한
  `terraform init`도, `apply`도 실행하지 않았다** — 이 ADR로 인해 존재하게 된 AWS
  리소스는 없다; 그게 언제 바뀌는지는 D5가 정한다.
- 스키마·엔티티·API 표면 변경 없음 — 이 ADR은 전적으로 `k8s/infra/terraform/`과 그
  문서에 국한된다.
