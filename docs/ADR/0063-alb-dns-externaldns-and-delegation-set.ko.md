# ADR 0063: ExternalDNS로 ALB DNS 레코드를 만들고, 재사용 위임 세트로 zone 네임서버를 고정한다

- Status: Accepted — 코드 작성 완료(`terraform fmt -check`/`validate`와 `bash -n` 통과). plan·apply는 하지 않음
- Date: 2026-09-25
- Amends: [ADR 0043](0043-terraform-project-adaptation.ko.md) (D5의 네임서버 단계: 등록기관이 Terraform이 마지막으로 만든 zone이 아니라 재사용 위임 세트를 가리킨다)
- Extends: [ADR 0044](0044-terraform-three-state-split.ko.md) (`addons/`가 `app-infra/`의 출력을 하나 더 읽는다), [ADR 0047](0047-observability-prometheus-grafana.ko.md) (`eks_blueprints_addons` 모듈 플래그 하나 추가)
- Relates to: [ADR 0034](0034-https-termination-stance.ko.md), [ADR 0046](0046-deploy-sequence-automation.ko.md), [ADR 0058](0058-ingress-path-allowlist.ko.md), [ADR 0060](0060-frontend-same-alb-path-routing.ko.md), [ADR 0062](0062-admin-same-alb-subpath-routing.ko.md)
- English: [0063-alb-dns-externaldns-and-delegation-set.md](0063-alb-dns-externaldns-and-delegation-set.md)

## Context

도메인을 ALB로 연결하는 DNS 레코드를 만드는 곳이 이 저장소에는 없다. `app-infra/`는 Route53
zone과 ACM 검증 레코드만 만든다(`app-infra/main.tf`의 "DNS + TLS" 블록). ALB 자체는 `Ingress`가
생긴 뒤에야 AWS Load Balancer Controller가 만들기 때문에(`k8s/infra/terraform/README.md`의
"Enabling the ALB ingress") `apply` 시점에는 ALB 주소를 알 수 없고, ALB를 다시 만들면 DNS 이름이
다른 새 로드밸런서가 된다. `k8s/helm/README.md`의 Pending 목록은 "도메인이 ALB로 향한다"를
전제로 삼을 뿐, 그것을 누가 보장하는지는 적혀 있지 않다.

관련된 비용이 하나 더 있다. hosted zone은 만들 때마다 네임서버 4개를 새로 받고(`README.md`,
"Before you `apply` anything"), 이 프로젝트가 지금까지 써 온 흐름은 전체 `apply` → 검증 →
`destroy`다(ADR 0043 D1). 도메인 `sharenpo.cloud`는 Route53 Domains가 아니라 외부 등록기관
(Gabia)에 등록돼 있어서, zone을 새로 만들 때마다 그곳에서 손으로 고쳐야 한다. 개발자가
2026-09-25에 이 도메인이 본인 소유이고 네임서버를 변경할 수 있다고 확인했다.

이 결정 전에 세션이 2026-09-25에 읽은 것은 소스 코드와 공식 문서이며 기억이 아니다. AWS에는
아무것도 실행하지 않았다.

- **eks-blueprints-addons.** `~> 1.16`은 `init` 때 최신 1.x로 해석된다(lock 파일은 provider만
  고정한다). `v1.16.0`과 `v1.24.3`을 둘 다 읽었다. 두 버전 모두 `enable_external_dns`,
  `external_dns`, `external_dns_route53_zone_arns`를 선언하고, `chart_version` 기본값이 `1.14.3`,
  `values` 기본값이 `["provider: aws"]`이며, zone ARN 목록이 비어 있지 않을 때만 IRSA 역할을
  만든다. 역할 정책은 지정한 zone ARN에 `ChangeResourceRecordSets`와 `ListTagsForResource`를,
  `*`에 `ListHostedZones`와 `ListResourceRecordSets`를 준다.
- **ExternalDNS 차트.** 차트 `1.14.3`(2024-01-26 발행)은 앱 `0.14.0`이고, 가장 새 차트
  `1.22.0`(2026-09-11 발행)은 앱 `0.22.0`이다. 두 `Chart.yaml` 모두 `kubeVersion`을 선언하지
  않으며, `cluster/main.tf`는 Kubernetes `1.34`를 쓴다. `policy` 기본값은 `1.14.3`에서
  `upsert-only`이고 `1.22.0`에서는 필수다. `interval`은 `1m`, `registry`는 `txt`로 두 버전이
  같다. 둘 다 `resources: {}`다.
- **ExternalDNS 동작.** 공식 문서에 따르면 Ingress의 로드밸런서 호스트명은 Route53 ALIAS
  레코드가 되고 zone apex에서도 동작한다. `v0.22.0`의 AWS provider에 그 경로가 있다
  (`AliasTarget`, `useAlias`). `ListTagsForResources` 호출(`v0.14.0`은 단수형)은 zone 태그
  필터를 설정했을 때만 실행되며, 이 설계는 태그 필터를 쓰지 않는다.
- **Terraform.** provider `5.100.0`에 `aws_route53_zone.force_destroy`가 있다: "destroy all
  records (possibly managed outside of Terraform) in the zone when destroying the zone".
- **재사용 위임 세트**(AWS CLI에 포함된 API 모델). 세트는 여러 zone이 재사용할 수 있는
  네임서버 4개다. 만들 때 네임서버를 입력으로 받지 않고 `CallerReference`와 선택 입력인
  `HostedZoneId`만 받는다. `HostedZoneId`를 주면 그 zone의 네임서버 4개를 그대로 쓴다. 세트는
  어떤 zone도 쓰고 있지 않을 때만 삭제할 수 있다. provider는 ID를 `/delegationset/` 접두사 없이
  저장하고, 생성 때는 설정값을 그대로 넘긴다(`zone.go`).
- **비용.** Route53 가격표(버전 `20260911124504`)에는 API 요청 항목도, 위임 세트 항목도 없다.
  AWS IAM 문서는 IAM과 STS가 추가 요금 없이 제공된다고 하고, 가격 페이지는 ELB를 가리키는 alias
  조회가 무료라고 한다. "API 호출은 무료"라고 그대로 적은 문서는 없다.

## Decision

### D1 — `addons/`의 모듈 플래그로 ExternalDNS를 켠다

`addons/main.tf`가 `module.eks_blueprints_addons`에 `enable_external_dns = true`와
`external_dns_route53_zone_arns = [<zone ARN>]`을 설정한다. `addons/`는 이미 `app-infra/`의
state를 읽고 있고(ADR 0044 D2), `app-infra/`는 출력 두 개 `route53_zone_arn`과
`route53_zone_name`을 새로 갖는다. 그러면 ExternalDNS가 Ingress의 host를 감시하다가 그 zone에
ALIAS 레코드와 TXT 소유 레코드를 만들고 지운다. 모듈은 그 zone 하나로 범위가 좁혀진 IRSA 역할을
만든다(기본값은 네임스페이스 `external-dns`, 서비스 어카운트 `external-dns-sa`). 이 state의 ALB
Controller, ESO, kube-prometheus-stack이 이미 쓰는 것과 같은 방식이다.

### D2 — 차트는 `1.22.0`으로 고정하고 values는 최소로 둔다

`external_dns.chart_version = "1.22.0"`으로 두어 모듈 기본값 `1.14.3`을 쓰지 않는다. 1.14.3은
마이너가 8개 뒤처져 있고 Kubernetes `1.34`보다 오래된 차트다. `external_dns.values`를 넘기면
모듈의 기본값 `["provider: aws"]`가 대체되는데, 두 차트 모두 `provider.name` 기본값이 이미
`aws`이므로 values에는 `policy: sync`, `txtOwnerId`(클러스터 이름),
`domainFilters: [<route53_zone_name>]`, `sources: [ingress]`에 더해 `service.enabled: false`를
담는다. 앞의 네 키는 두 차트의 `values.yaml`에 모두 있다. `service.enabled`는 `1.22.0`에만
있고(`1.14.3`은 Service를 무조건 만든다), 이 차트가 만드는 메트릭용 Service를 꺼 준다. 여기서는
그 Service를 아무도 스크레이프하지 않는다. 함께 없어지는 것이 알려진 실패 유형이다. ALB
Controller의 admission webhook이 아직 준비되지 않았을 때 만든 Service가 External Secrets에서
한 번 실패한 적이 있고(`k8s/infra/terraform/README.md`의 "Cleaning up after a failed apply"),
ExternalDNS는 그 컨트롤러와 같은 `apply`에서 설치된다. 실제로 렌더링되는 values는
`addons/main.tf`에 있다.

### D3 — 삭제: `policy: sync`와 zone `force_destroy = true`를 함께 쓴다

`sync`는 Ingress가 사라지면 ExternalDNS가 자신이 소유한 레코드를 지우게 한다. 그것만으로는
부족하다. 반영이 `1m` 주기로 돌고 ExternalDNS가 아직 떠 있을 때만 일어나며, state가 모르는
레코드가 남아 있으면 zone의 `terraform destroy`가 실패하기 때문이다. `aws_route53_zone.app`의
`force_destroy = true`는 zone 삭제가 그 타이밍에 좌우되지 않게 한다. 대가로 zone 안의 모든
레코드가 함께 지워지는데, 이 zone은 이 앱 전용이다. (`1.14.3`의 기본값인 `upsert-only`는 절대
삭제하지 않아 매번 `force_destroy`에 의존하게 된다.)

### D4 — 네임서버는 Terraform 밖에서 만든 재사용 위임 세트로 고정한다

세트는 개발자가 한 번 직접 만들고(`aws route53 create-reusable-delegation-set`), 그 네임서버
4개를 등록기관에 한 번 입력한다. `app-infra/`는 새 선택 변수 `delegation_set_id`(`default = null`)로
세트 ID를 받아 `aws_route53_zone.app`에 넘긴다. 이후 만드는 zone은 모두 같은 네임서버 4개를
받으므로 등록기관 수정이 반복되지 않고, 첫 `apply`도 ACM 검증이 등록기관을 기다리며 중간에
멈추지 않는다(README가 설명하는 대기 구조에서 따진 것으로, 실행해 본 것은 아니다).

- **일부러 Terraform 밖에 둔다.** `aws_route53_delegation_set` 리소스로 만들면 `app-infra/`
  state와 함께 삭제되어 네임서버가 다시 바뀐다.
- **네임서버를 고를 수 없다.** API가 입력을 받지 않고, 이전 zone은 이미 없어서 재사용
  (`HostedZoneId`)도 못 한다. 그래서 등록기관 수정은 새 세트의 서버로 한 번 한다.
- **ID는 CLI가 출력하는 `/delegationset/` 접두사를 뗀 값으로 넣는다.** provider가 저장하는
  형태와 맞추기 위해서다.
- **`deploy.sh`가 이 값을 넘겨야 한다.** `app-infra`의 plan/apply가 이미 네 곳에서
  `-var="domain_name=..."`을 넘기는데, 짝이 되는 `-var="delegation_set_id=..."`이 없으면 고정이
  조용히 빠지고, 중간에 나오는 "새 네임서버를 조회하라"는 안내도 틀린 말이 된다. 이제 선택
  환경변수 `DELEGATION_SET_ID`를 읽어 네 곳 모두에 넘긴다. `plan`과 `apply`를 나눠 실행할 때는
  두 번 모두 같은 값이 필요하다. `app-infra`의 첫 단계는 저장된 plan을 쓰지만 두 번째 단계는
  새로 계산하므로, 값이 없으면 zone의 `delegation_set_id`가 null로 되돌아가는 변경이 보인다.

### D5 — 범위

이 ADR은 아무것도 apply하지 않고, 레코드를 만들지 않으며, 등록기관을 건드리지 않는다. Ingress를
켜는 일은 Helm 쪽에 그대로 남는다(ADR 0041, 0058, 0060, 0062). 구현(Terraform, `deploy.sh`,
README)은 파일 목록을 승인받은 뒤에 진행한다.

## Alternatives rejected

각 항목에 그 대안이 더 나았던 점을 적었다. 그것이 감수한 trade-off이기 때문이다.

- **A — 손으로 만드는 Alias 레코드.** 새 의존성이 0이고, Terraform이 수렴시킬 수 없는 일을
  다루는 이 프로젝트의 기존 방식(ADR 0043 D5, ESO 매니페스트)과 같다. 채택하지 않은 이유:
  ALB를 다시 만들면 주소가 바뀌므로 배포 주기마다 수동 단계가 하나씩 생기고, 남은 레코드는
  결국 `force_destroy`를 켜지 않으면 zone 삭제를 막는다. 개발자는 전체 `apply`/`destroy`를
  여러 번 반복할 것으로 본다.
- **B — Terraform이 관리하는 레코드.** 선언적이고 state로 추적되며 클러스터 안에 구성요소가
  없다. 채택하지 않은 이유: plan 시점에 ALB가 없어서 `data "aws_lb"` 조회에 게이트 변수와 Helm
  이후의 두 번째 `apply`가 필요하고, 이는 `cluster` → `app-infra` → `addons`의 선형 순서(ADR
  0044)를 깬다. 네 번째 state를 두면 ADR 0044를 수정하게 된다. destroy 때도 게이트를 먼저 꺼야
  한다(추론이며 재현하지 않았다). `alb.ingress.kubernetes.io/load-balancer-name`으로 이름을
  고정할 수는 있지만(32자 이하, 생성 시점에만 적용) 순서 문제가 사라지지는 않는다.
- **고정용으로 Terraform `aws_route53_delegation_set` 리소스를 쓰는 안.** 완전히 선언적이다.
  채택하지 않은 이유: state와 수명이 같아 고정의 의미가 없어진다(D4).
- **모듈 기본 차트 `1.14.3`을 그대로 쓰는 안.** 따져 볼 변경이 적다. 채택하지 않은 이유: 2024년
  차트인데 Kubernetes `1.34`와의 호환에 대해 선언된 것이 없다.
- **ExternalDNS용 `helm_release`와 IAM 역할을 직접 작성하는 안.** values를 완전히 통제한다.
  채택하지 않은 이유: 모듈 플래그가 ESO(ADR 0043 D7)처럼 릴리스와 zone 범위 IRSA 역할을 이미
  만들어 준다.
- **teardown 뒤에도 zone을 유지하는 안**(RDS와 분리한 자체 state). 실무에서 흔한 방식이고
  위임 세트가 필요 없어진다. 여기서 채택하지 않은 이유: ADR 0044의 분리 구조를 바꾸는 일이라 이
  작업의 범위 밖이다. 열린 항목으로 남는다.

## Consequences

- **비용.** 위 근거에서 확인되는 ExternalDNS의 추가 AWS 요금은 없다. zone의 월 $0.50은
  ExternalDNS와 무관하게 든다. 파드는 자원을 예약하지 않고(`resources: {}`) 실제 사용량은
  측정하지 않았다. "API 호출 무과금"은 가격표에 해당 항목이 없다는 것에서 추론한 것이고 명시된
  문장은 아니다.
- **변경한 파일:** `app-infra/variables.tf`(`/delegationset/` 접두사가 붙은 값은 변수가
  거부한다), `main.tf`, `outputs.tf`, `addons/main.tf`, `deploy.sh`,
  `k8s/infra/terraform/README.md`와 `k8s/helm/README.md`(각각 `.ko.md` 포함),
  `docs/ADR/README.md`와 `README.ko.md`. `CLAUDE.md`의 Terraform 항목(`addons/` = ALB
  Controller + ESO, `app-infra/`의 구성)은 후속으로 동기화해야 한다.
- **세션이 2026-09-25에 확인한 것:** `app-infra/`와 `addons/`에서 `terraform init
  -backend=false`, `fmt -check`, `validate`가 통과한다. `delegation_set_id` validation은 격리된
  설정에서 실행했다. 값이 없을 때와 접두사 없는 ID는 통과하고, `/delegationset/` 접두사가 붙은
  값은 거부된다. `bash -n deploy.sh`가 통과하며, 따옴표 없는 `-var` 전개는 비어 있으면 사라지고
  값이 있으면 인자 하나가 된다. plan 대상이 될 state 버킷이 없어서 `plan`과 `apply`는 하지
  않았다.
- **라이브에서만 확인되는 것, 아직 관찰하지 못함**(개발자가 실행하고 세션은 보고받은 내용을
  기록한다):
  1. Ingress를 켠 뒤 `aws route53 list-resource-record-sets`에 그 host의 ALIAS 레코드가 ALB를
     가리키는 것과 TXT 소유 레코드가 몇 번의 주기 안에 나타난다.
  2. `curl -I http://<도메인>`이 HTTPS로 리다이렉트된다.
  3. `helm uninstall` 뒤 레코드가 제거되거나 `force_destroy`가 지우고, `app-infra/` destroy가
     끝까지 완료된다.
  4. 차트 `1.22.0`이 ALB Controller 옆에서 Service webhook 실패 없이 설치되고(막으려고 둔 것이
     `service.enabled: false`다) EKS `1.34`에서 동작한다. 고를 때 발행 2주 된 버전이었다.
  5. `delegation_set_id`로 만든 두 번째 zone이 같은 네임서버를 받고, 이후 apply의 `plan`에
     zone 교체가 나타나지 않는다.
- **zone 태그 필터를 나중에 추가하면** `external_dns.policy_statements`로 `ListTagsForResources`
  (복수형)용 IAM 문장을 더해야 한다. 모듈의 정책은 단수형만 준다.
- **앱이 실사용자를 받게 되면 `sync`(D3)를 다시 검토한다.** Ingress를 실수로 지우면 그 레코드도
  함께 지워지기 때문이다.
- `init`은 2026-09-25에 `eks-blueprints-addons`를 `1.24.3`으로 해석했고, 이것이 `external_dns`
  블록을 읽은 버전이다. lock 파일은 모듈을 고정하지 않으므로 이후 `init`은 더 새로운 1.x를 고를
  수 있다. 훨씬 새로운 버전으로 해석되면 그 블록을 다시 읽는다.
