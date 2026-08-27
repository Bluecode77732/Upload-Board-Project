# ADR 0046: 배포 순서 자동화 — 로컬 쉘 스크립트, Terraform + Helm까지만

- Status: Accepted — implemented
- Date: 2026-08-27
- Related: [ADR 0043](0043-terraform-project-adaptation.md), [ADR 0044](0044-terraform-three-state-split.md)
  (이 스크립트가 구동하는 3-state 구조 — 두 ADR의 리소스 결정 자체는 바뀌지 않는다),
  [ADR 0016](0016-github-actions-ci.md) (이 작업이 왜 CI 워크플로가 아니라 로컬 스크립트로
  남는지)
- 한국어: [0046-deploy-sequence-automation.ko.md](0046-deploy-sequence-automation.ko.md)

## Context

`docs/ROADMAP.md` §7은 2026-08-26에 이렇게 기록했다 — `cluster` → `app-infra` →
`addons` → Helm 순서를 실제로 처음 end-to-end `apply`해 보니, 개발자가
`k8s/infra/terraform/README.md` 산문에서 매번 다시 떠올려야 하는 순서-의존 실패가
8가지나 드러났다: 이미 EOL된 EKS 버전,
`graviton` 노드 그룹에 빠진 `ami_type`, Free-Tier 인스턴스 타입 거부, ACM 인증서의
2단계 `apply` 요구, 끝을 알 수 없는 Route53 NS 위임 대기, 리전이 다른 S3 버킷 충돌,
ALB Controller의 admission webhook과 External Secrets Operator 자체 `Service` 생성
사이의 Helm 설치 레이스, 그리고 `eks-managed-node-group`의 `ignore_changes`가
`-var` 스케일링 변경을 조용히 무효화하는 문제. 그 항목은 이 배포가 안정화될 때까지
자동화를 미뤄뒀고, 별도 결정이 필요한 두 축을 명시해뒀다: 도구(쉘 스크립트 vs
GitHub Actions vs Makefile)와 범위(인프라만 vs Helm과 배포 후 수동 단계까지).

`docs/ROADMAP.md` §9(2026-08-27)는 이제 그 안정화를 기록한다: Helm 릴리스
`upload-board`가 `STATUS: deployed`(revision 5)에 도달했고, S3 IRSA 접근이 정상
동작함을 확인했으며, `graviton` 노드 타입은 `t4g.medium`으로 영구 확정됐고,
`k8s/helm/values-prod.yaml`이 그 배포의 `--set` 나열을 재사용 가능한 오버레이 하나로
정리해 추가됐다. §7이 명시한 트리거 조건은 충족됐다.

## Decision

### D1 — 도구: Makefile도 CI 워크플로도 아닌, 순수 bash 스크립트

| 기준 | 쉘 스크립트 | Makefile | GitHub Actions (수동 dispatch) |
|---|---|---|---|
| 이 저장소의 선례 | `build-and-push.sh` — 같은 종류(멀티아치 이미지 빌드·푸시)의 사람이 직접 실행하는 로컬 스크립트가 이미 존재 | 없음 | CI(`.github/workflows/ci.yml`, ADR 0016)는 lint/test/build만 수행, 배포는 한 번도 없음 |
| 대화형 사람 확인 게이트 | 자연스러움(`read -p`) | 어색함 — `make`는 관례적으로 비대화형 모델 | environment protection rule로 가능하나, 1인 개발 저장소치고는 구현 복잡도가 급상승 |
| "CD 없음"과의 정합성 | 유지됨 — 여전히 로컬에서 사람이 트리거 | 유지됨 | 위반 — 인프라를 apply하거나 Helm 릴리스를 업그레이드하는 워크플로는 그 자체로 배포 파이프라인이다. 이걸 여기 추가하면 `CLAUDE.md`의 CI/CD 절이 말하는 현재 상태를 그 자체 결정 없이 뒤집는 셈 |
| 과금 리소스 리스크 | 낮음(로컬, 매번 사람이 트리거) | 낮음 | 높음 — 수동 dispatch라도 "한 번 승인해두고 잊는" 방향으로 흐르기 쉽고, 자격증명을 GitHub에 올려야 함 |

선택: **쉘 스크립트**, `k8s/infra/terraform/deploy.sh` — `build-and-push.sh`와 똑같이
사람이 직접 실행한다. 이렇게 하면 `CLAUDE.md` > CI/CD의 "자동 배포 파이프라인(CD)
없음" 서술이 그대로 유지된다 — 사람이 실행하는 *순서*를 자동화하는 것과 *언제*
실행되는지를 자동화하는 것은 다른 결정이며, 이번에 요청받은 것은 전자뿐이다.

### D2 — 범위: Terraform 3-state 순서화 + Helm install/upgrade까지, 1회성 수동 단계는 제외

| 기준 | Terraform만 | **Terraform + Helm** | + 1회성 수동 단계(ESO 동기화, SA 어노테이션) |
|---|---|---|---|
| §7이 실제 기록한 실패를 커버하는가 | 부분적 — Helm/ALB webhook 레이스는 8가지 중 하나이고 Terraform이 아니라 Helm 단계에 있음 | 커버함 — ACM 2단계 apply, 3-state 순서, Helm 단계의 레이스까지 | 커버함, 나머지도 포함 |
| `k8s/infra/terraform/README.md`가 이미 1회성/인터랙티브라고 부르는 것과 일치하는가 | — | 일치함 — ESO 시크릿 동기화와 default ServiceAccount IRSA 어노테이션은 매 배포마다 반복되는 단계가 아니라 `addons`/`app-infra` 출력이 존재해야만 가능한 1회성 단계로 이미 문서화돼 있음 | 1회성 단계를 반복 실행되는 스크립트에 끼워 넣는 것 — 형태가 맞지 않음 |
| Ingress를 건드리지 않는가 | 건드리지 않음 | 건드리지 않음 | 활성화 쪽으로 범위가 슬금슬금 넓어질 위험 — 이 작업에서는 명시적으로 범위 밖 |

선택: **Terraform 3-state 순서화 + `helm upgrade --install`**, `--set` 나열이 아니라
`k8s/helm/values-prod.yaml`을 재사용한다 — 이 오버레이 파일 자체가 그 회귀를 막기
위해 존재한다. 도메인 구매/NS 위임, ESO 시크릿 동기화(`terraform output ... | kubectl
apply -f -`), default ServiceAccount IRSA 어노테이션, ALB `Ingress` 활성화는
`k8s/infra/terraform/README.md`가 이미 문서화한 그대로 모두 수동으로 남는다 —
`k8s/infra/terraform/deploy.sh --help`가 이 네 가지를 이름으로 명시해, 스크립트가
무엇을 다루지 않는지 개발자가 추측하지 않아도 된다.

### D3 — `-auto-approve` 금지, region/cluster_name은 실제 적용된 state와 대조

스크립트 안의 모든 `terraform apply`는 동일한 형태를 따른다: `terraform plan
-out=<tmpfile>` → plan 출력 → `read -p`로 명시적 `y` 확인 → `terraform apply
<tmpfile>`(저장된 그 plan 그대로 적용 — 재확인 프롬프트 없이, 사람이 보지 못한
내용을 적용할 방법이 구조적으로 없다). 그 외 답은 전부 중단시킨다. 과금 리소스
변경에 무인 승인 경로를 두지 말라는 이번 작업의 제약을 만족하며, 단순히
`-auto-approve` 금지보다 더 엄격하다 — `-out` 없이 `terraform apply -var=...`를 따로
재실행하는 방식이었다면 "본 plan과 실제 적용이 어긋날" 여지가 남았을 것이다.

`app-infra`/`addons`의 apply 전에, 스크립트는 `cluster/`의 **이미 적용된**
`cluster_name` output을 읽어 이번 실행의 `CLUSTER_NAME`과 비교하고, 불일치하면
진행을 거부한다. 이것이 `k8s/infra/terraform/README.md`의 "Before you apply
anything" #4 경고의 구체적 구현이다: `region`/`cluster_name`은 세 state 모두에 선언된 순수 변수일 뿐
`terraform_remote_state`로 공유되지 않으므로, 한 state의 `-var`에 다른 값을 넣으면
plan은 성공하면서 리소스 이름/태그만 조용히 어긋난다. 실행 시점에 실제 output을
읽는 방식은(한 스크립트 실행 안에서 하나의 env var를 계속 쓰는 것만으로는 놓치는)
`cluster`를 적용한 뒤 며칠 뒤 다른 스크립트 실행에서 `app-infra`/`addons`를 다른
환경변수로 호출하는 경우까지 잡아낸다.

### D4 — ACM 2단계 apply 자동화

`k8s/infra/terraform/app-infra/main.tf`의 `aws_route53_record.app_cert_validation`은
`aws_acm_certificate.app.domain_validation_options`를 도는 `for_each`를 갖는데, 이
값은 `aws_acm_certificate.app`가 실존하기 전까지는 알 수 없다. 스크립트는 먼저
`terraform apply -target=aws_acm_certificate.app`를 (자체 plan/확인/apply 사이클로)
실행한 뒤 `app-infra` 전체를 apply한다 — `k8s/infra/terraform/README.md`가 이미 이름
붙여둔 2단계 요구사항을 그대로 자동화한 것으로, 이제 개발자가 어떤 리소스를
타겟팅해야 하는지 기억할 필요가 없다.

## Consequences

- 새 파일: `k8s/infra/terraform/deploy.sh`(서브커맨드 `cluster`, `app-infra`,
  `addons`, `helm`, `all`). `.tf` 파일은 하나도 바뀌지 않았다 — `cluster/`,
  `app-infra/`, `addons/` 모두에서 `terraform fmt -check`와 `terraform validate`가
  변경 전과 동일하게 통과한다.
- 실제 AWS 계정(`074416822640`, `ap-northeast-2`)을 대상으로 실측 검증했다:
  `deploy.sh cluster`가 실제 `terraform plan`을 실행했고("No changes. Your
  infrastructure matches the configuration." 확인), 대화형 확인 입력이 없을 때는
  실제로 아무것도 적용하지 않고 중단했다 — 기본 거부 경로가 읽어본 것이 아니라
  실제로 실행되어 검증됐다.
- `CLAUDE.md` > CI/CD의 "자동 배포 파이프라인(CD) 없음, git hook 없음" 서술은 그대로
  유지된다: 이 스크립트는 `build-and-push.sh`와 같은 형태의, 사람이 직접 실행하는
  로컬 도구이지 새로운 CI/CD 표면이 아니다.
- 받아들인 트레이드오프: 이 스크립트가 첫 배포의 모든 수동 단계를 없애주지는
  않는다 — 도메인 구매/NS 위임, ESO 시크릿 동기화, S3 IRSA ServiceAccount
  어노테이션, `Ingress` 활성화는 D2에 따라 여전히 손으로 실행한다. 향후 작업에서
  ESO 동기화와 SA 어노테이션 정도는 접어 넣을 수 있다(둘 다 결정적이고
  스크립트화 가능하며, `addons`/`app-infra`가 이미 적용돼 있어야 한다는 전제만
  있을 뿐) — 다만 그것은 새로운 범위이지 이번 결정이 암묵적으로 포함하는 것은
  아니다.
- `docs/ROADMAP.md` §7의 "cluster → app-infra → addons → Helm 배포 순서 자동화" 항목을
  완료 처리하고 이 문서를 가리키도록 갱신한다.
