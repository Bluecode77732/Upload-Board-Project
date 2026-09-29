# ADR 0063: ExternalDNS로 ALB DNS 레코드를 만들고, 재사용 위임 세트로 zone 네임서버를 고정한다

- Status: Accepted — 코드 작성 완료(`terraform fmt -check`/`validate`와 `bash -n` 통과). 2026-09-26 첫 라이브 실행: 레코드는 만들어졌고 소유 TXT 레코드는 만들어지지 않음(추가 기록 참고)
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
- **ExternalDNS 이미지.** 차트의 이미지 태그는 `v` + `appVersion`이 기본값이라 `1.22.0`은
  `registry.k8s.io/external-dns/external-dns:v0.22.0`을 실행하고, 그 레지스트리 인덱스에는
  `linux/amd64`, `linux/arm64`, `linux/arm`이 있다(2026-09-26에 읽음) — 클러스터에서 실제로 도는
  노드는 `arm64`뿐이다.
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

## Addendum (2026-09-26) — 첫 라이브 실행: 레코드는 만들어졌고 소유 TXT 레코드는 만들어지지 않았다

개발자가 세 state를 apply하고 Ingress를 켰으며, 차트를 한 번 업그레이드한 뒤 스택을 철거했다.
세션은 AWS, 클러스터, CloudTrail을 읽기 전용으로 조회하고 `curl`로 공개 사이트를 요청했다.
시각은 2026-09-26 UTC다.

**위의 라이브 확인 5개**

| # | 확인 | 결과 |
|---|---|---|
| 1 | Ingress를 켠 뒤의 레코드 | 일부만 성공. ExternalDNS가 `sharenpo.cloud`의 alias `A`**와** alias `AAAA`를 ALB로 만들었다(CloudTrail: 17:13:51의 변경 2건짜리 배치 1개). **`TXT` 소유 레코드는 만들지 않았다.** |
| 2 | `http://`가 HTTPS로 리다이렉트 | 성공. `http://sharenpo.cloud/`는 `https://`로 `301`, `https://`는 `200`, `/file`은 `401`, `/admin/`은 `200`(상태 코드만 보았고 본문은 읽지 않음). `curl`이 인증서를 검증했고 `nslookup`은 두 리졸버에서 주소 3개를 돌려줬다. |
| 3 | uninstall 뒤 레코드 제거, `app-infra/` destroy 완료 | destroy는 완료됐지만 **ExternalDNS는 레코드를 지우지 않았다.** ALB가 삭제된 뒤(17:59:05) 8분 동안 1분마다 Route53을 조회하면서도 변경을 내지 않았다. Terraform의 `force_destroy`가 18:06:29에 `A`와 `AAAA`를, 18:07:00에 zone을 삭제했다. |
| 4 | EKS `1.34`에서 ALB Controller 옆의 차트 `1.22.0` | 성공. `external-dns-1.22.0`(앱 `v0.22.0`)과 `aws-load-balancer-controller-1.7.1`이 모두 `deployed`이고 파드가 `Running`이며 Service webhook 실패가 없었다. |
| 5 | 두 번째 zone이 같은 네임서버를 받는지 | 관찰하지 못함. zone이 하나뿐이었다. |

**TXT 레코드가 없는 이유.** Ingress host가 zone apex다. `v0.22.0`의 TXT registry는 이름의 첫 라벨
앞에 레코드 타입을 붙여 소유 레코드 이름을 만든다(`registry/mapper/mapper.go`의 `ToTXTName`).
그래서 apex의 두 레코드는 `a-sharenpo.cloud`, `aaaa-sharenpo.cloud`가 되고, 이 이름은 zone
`sharenpo.cloud.` 안이 아니다. AWS provider는 이름이 zone과 같거나 `.sharenpo.cloud.`로 끝나는
변경만 받아들이고(`provider/aws/aws.go`의 `suitableZones`) 나머지는 debug 레벨로 버린다
(`changesByZone`, "Skipping record … no hosted zone matching"). 차트가 `--log-level=info`라 이 줄이
보이지 않는다. 근거는 세 가지다. 실행 중이던 설정이 `--registry=txt --txt-owner-id=sharenpo`라서
설정 오류가 아니었고, CloudTrail에서 배치가 alias 변경 2건뿐이었으며 오류가 없었고, 위 소스를
`v0.22.0` 태그에서 읽었다. debug 줄 자체는 보지 못했다. zone 아래의 host(`app.sharenpo.cloud`)는
zone 안의 `a-app.sharenpo.cloud`가 되는데, 이는 코드에서 읽은 것이고 실행해 보지는 않았다. 이 일은
`v0.22.0`에서 alias 접두사가 `cname-`에서 `a-`로 바뀐 것과 그 회귀(이미 `cname-` TXT가 있는
zone이 대상)와 무관하다.

**D3에 미치는 영향.** D3은 ExternalDNS가 자기가 만든 것을 소유한다고 가정했다. apex host에서는
레코드를 만들 수는 있어도 갱신하거나 삭제하지 못한다. `ApplyChanges`가 Delete와 Update를 owner
필터(`FilterEndpointsByOwnerID`, 호출부만 확인했고 함수 자체는 읽지 않음)에 통과시키는데, owner
TXT가 없는 레코드는 통과하지 못하기 때문이다. 따라서:

- apex 레코드에는 `policy: sync`가 아무 일도 하지 않는다.
- zone의 `force_destroy = true`가 이 레코드를 지우는 유일한 수단이라, 단순한 대비책이 아니라
  필수다.
- zone은 두고 `cluster/`만 다시 만들면 apex `A`와 `AAAA`가 삭제된 ALB를 가리킨 채 남고
  ExternalDNS가 고치지 않는다. 다음 Ingress 전에 손으로 지운다.

TXT 레코드와 ExternalDNS의 제거를 기대한 위의 Consequences는 이 추가 기록으로 대체된다.

**결정(개발자, 2026-09-26): apex host를 유지한다.** 검토한 대안은 서브도메인 host(TXT는 되지만
사이트 URL, `BASE_URL`, 인증서, Ingress 값이 바뀜)와 `crd` 같은 다른 registry(검증하지 않음)였다.
둘 다 채택하지 않았다.

개발자의 destroy는 `addons/`를 건너뛰었다. 그 결과로 남는 것은
[`k8s/infra/terraform/README.ko.md`](../../k8s/infra/terraform/README.ko.md)의 Destroy에 있다.

## 추가 기록 (2026-09-29) — 두 번째 라이브 실행: 재현됨; upstream 문서·이슈로 독립 확인; 코드 변경 없음

위 2026-09-26 추가 기록은 이미 external-dns `v0.22.0` 자체 소스에서 메커니즘을 짚었다
(`registry/mapper/mapper.go`의 `ToTXTName`, `provider/aws/aws.go`의
`suitableZones`/`changesByZone`). 이번 추가 기록은 두 가지를 한다 — 2026-09-26 철거 뒤
`app-infra`/`addons`/차트를 다시 적용한 두 번째 독립 라이브 실행에서 증상을 재현하고, 소스
코드만이 아니라 external-dns 자신이 공개한 문서와 이슈 트래커로 그 메커니즘을 다시 확인한다 —
세션은 `docs/registry/txt.md`와 GitHub 이슈 두 건을 직접 읽었고, 기억에 의존하지 않았다. 이는 이
ADR 스스로가 요구하는 증거 기준을 그대로 따른 것이다.

**재현, 2026-09-29.** `aws route53 list-resource-record-sets`로 새 zone(`Z07357852B0DR48XVC7PW`,
UTC `07:33:17` 생성)을 조회하면 레코드가 다섯 개다: `sharenpo.cloud.`의 alias `A`와 `AAAA`, `NS`,
`SOA`, ACM 검증용 `CNAME` — `TXT`는 0개. `kubectl -n external-dns logs`는 파드의 첫 reconcile(UTC
`07:47:18`, AWS 클라이언트를 만든 지 1초 뒤)부터 매 주기 `"All records are already up to date"`만
찍었고 오류나 경고 줄은 없었다 — 차트의 `--log-level=info`가 여전히 그 skip을 가린다는 뜻이고,
debug 줄 자체를 보지 못한 채로 추론했던 2026-09-26 추가 기록의 판단과 정확히 일치한다.

**upstream 문서·이슈로 독립 확인, 소스 코드만이 아니라.**
[`docs/registry/txt.md`](https://github.com/kubernetes-sigs/external-dns/blob/master/docs/registry/txt.md)
(`kubernetes-sigs/external-dns`, `master`)는 이렇게 적혀 있다: "AWS ALIAS records are stored in
Route 53 as A/AAAA records, so their ownership TXT uses the matching `a-`/`aaaa-` prefix" —
`--txt-prefix`를 따로 지정하지 않아도 자동으로 붙는다 — 그리고 이 프로젝트의 증상과 구조적으로
같은 apex 실패 예시를 든다: "If configured `--txt-suffix="-.%{record_type}"` for apex domain
`ex.com`, the expected result would be `ex-.a.com`, which fails to create a TXT record because it
does not exist within the managed zone." `kubernetes-sigs/external-dns`의 이슈 두 건이 이
프로젝트와 무관하게 똑같은 실패를 보고한다:
[#5010](https://github.com/kubernetes-sigs/external-dns/issues/5010)(apex TXT 레코드에 대해 "no
hosted zone matching record DNS Name was detected")와
[#4234](https://github.com/kubernetes-sigs/external-dns/issues/4234)("New format txt registry
records fail for Apex record"), 후자는 메인테이너가 *not planned*으로 닫았다. 이는 zone apex에서
TXT registry가 겪는, 알려져 있고 지금도 고쳐지지 않은 upstream 제약이지 이 프로젝트의
`domainFilters`/`txtOwnerId`/`policy` 값 문제가 아니다 — 실행 중이던 설정(`--registry=txt
--txt-owner-id=sharenpo`, `TXTPrefix`/`TXTSuffix` 둘 다 빈 값, 이번 실행의 `kubectl logs` config
덤프에서도 다시 확인됨)은 2026-09-26에 이미 문제없다고 확인됐고 그대로다.

**D3은 여전히 맞다 — 재확인일 뿐, 바꾸지 않는다.** 개발자가 2026-09-26에 서브도메인 이전과
검증 안 된 `crd` registry를 저울질한 뒤 apex host를 유지하기로 한 결정은 이미 이 같은 제약 위에
서 있었다 — 오늘의 재현과 위 upstream 인용은 그 근거를 더 단단하게 할 뿐이다. 이슈 #4234가 *not
planned*으로 닫혔다는 것은 기다릴 upstream 수정이 없다는 뜻이다. `force_destroy = true`는 여전히
apex `A`/`AAAA` 레코드를 지우는 유일한 수단이고(ExternalDNS의 owner-필터링된 `ApplyChanges`는
소유 TXT가 없는 레코드에 손대지 못한다, 2026-09-26 추가 기록 참고), 여기서 그것도 다른 코드도
바꾸지 않는다.

**이 프로젝트가 아직 검토하지 않은 옵션 하나 — 제시만 하고 채택하지 않음.** 같은 문서 페이지는
apex에서도 안전한 패턴을 알려준다: `%{record_type}`를 포함하고 **마침표로 끝나는**
`--txt-prefix`/`--txt-suffix` — 예를 들어 apex `ex.com`에 `--txt-prefix="%{record_type}-abc-."`를
쓰면 소유 레코드가 `cname-abc-.ex.com.`에 생기는데, 이는 zone의 진짜 서브도메인이라 같은
`suitableZones` 거부에 걸리지 않을 것이다. 이건 2026-09-26 비교(서브도메인 이전 vs `crd`
registry만 저울질함)에는 없던 항목이고, 이 프로젝트의 zone에 시도해 본 적도 없다. 작업 지시에서
예로 든 또 다른 옵션인 "CNAME 전환"은 ExternalDNS와 무관하게 애초에 성립하지 않는다 — zone
apex는 `CNAME`을 아예 가질 수 없다(RFC 1035가 apex의 필수 레코드인 `NS`/`SOA`와의 공존을
금지한다), 그리고 그것이 바로 Route53의 ALIAS 메커니즘(지금 여기서 쓰는 `useAlias`)이 존재하는
이유다 — `AWSPreferCNAME`(실행 중인 설정에서 `false`로 확인됨)는 값을 뭘로 두든 apex에는 영향이
없다.

| 옵션 | apex host 유지? | TXT 소유권 추적 | 비용 | 확인 방법 |
|---|---|---|---|---|
| **A — 지금 그대로** (현재, D3) | 유지 | 없음; `force_destroy`가 유일한 정리 수단 | 0 | 라이브에서 두 번 재현(2026-09-26, 2026-09-29) |
| **B — apex-safe `--txt-prefix`/`--txt-suffix`** | 유지 | 문서의 예시대로라면 동작 시작 | Helm 값 하나 + 라이브 재검증 | 이 zone에 시도한 적 없음 |
| **C — 공개 host를 apex 밖으로 이전** (`app.sharenpo.cloud`) | 이전 | 정상 동작(apex가 아닌 host는 원래도 그렇다) | 큼 — `BASE_URL`, 인증서 SAN, CORS, `values-prod.yaml`, 이미 공유된 링크들 | 2026-09-26에 기각 |
| **D — `crd` registry** | 유지 | 완전히 다른 메커니즘 | 미검증 | 2026-09-26에 기각(검증 안 함) |
| ~~apex의 CNAME~~ | — | — | — | 성립 불가 — DNS 자체가 금지, ExternalDNS와 무관 |

A 외에는 아무 옵션도 여기서 채택하지 않는다. B가 이번 추가 기록이 새로 보탠 사실 하나이고,
개발자에게 제시만 할 뿐 결정하지 않는다 — 채택하려면 그 전에 이 zone에서 라이브로 따로
검증해야 한다.
