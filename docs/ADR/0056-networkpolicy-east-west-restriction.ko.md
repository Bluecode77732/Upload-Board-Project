# ADR 0056: 클러스터 내부(east-west) 트래픽 제한용 NetworkPolicy

- Status: Accepted — implemented, kind+Calico 검증 완료. 2026-09-26 추가 기록에서 AWS 에이전트를 코드로 켰고(`cluster/main.tf`), 같은 날의 두 번째 추가 기록에 EKS 라이브 실행 결과가 있다(에이전트, ALB 인바운드 허용 규칙, 프로브는 확인했고 Ingress가 꺼져 있는 동안 앱 메트릭 스크레이프는 막힘), 2026-09-27 추가 기록에서 Prometheus를 허용하는 차트 규칙을 넣었다(코드는 완성, 검증은 후속 작업)
- Date: 2026-09-11
- Extends: [ADR 0041](0041-helm-chart-project-adaptation.md)
- English: [0056-networkpolicy-east-west-restriction.md](0056-networkpolicy-east-west-restriction.md)

## Context

2026-09-09 보안 점검에서 `k8s/helm/templates/`에 `NetworkPolicy` 리소스가 없다는
게 발견됐다 — 앱이 배포된 뒤 클러스터 내부 파드 간 트래픽을 제한하는 장치가
전무했다. 쿠버네티스는 기본적으로 어떤 파드든 다른 아무 파드에게나 접근할 수
있게 허용한다 — `NetworkPolicy`가 없으면 클러스터 어딘가의 워크로드가
침해당했을 때 곧바로 이 앱 파드로 접근할 수 있고, 이 앱 파드 자신도 아웃바운드에
아무 제한이 없다.

이 프로젝트의 인프라 형태에서 나온 두 가지 사실이 일반적인 NetworkPolicy보다
설계를 더 크게 좌우한다:

- **이 앱은 Deployment 하나뿐이다.** 클러스터 안에 나눌 마이크로서비스 메시
  자체가 없다 — DB는 외부 RDS(`app-infra/main.tf`), 오브젝트 스토리지도 외부
  S3, 이 차트의 파드는 정확히 하나의 Deployment뿐이다. 그래서 "컴포넌트별
  규칙"은 "여러 파드 중 어떤 게 어떤 파드와 통신할 수 있는가"가 아니라
  "이 파드 하나의 트래픽이 실제로 어떤 모양인가"로 귀결된다.
- **`k8s/infra/terraform/cluster/main.tf`의 `vpc-cni` 애드온은 기본 설정
  그대로다** — VPC CNI의 Network Policy 강제 에이전트가 켜져 있지 않다.
  지금 실제 EKS 클러스터에 `NetworkPolicy` 리소스를 적용해도 리소스만
  생성되고 강제되지 않는다. 강제를 켜는 건 별도 Terraform 작업
  (`cluster_addons.vpc-cni.configuration_values`에 `ENABLE_NETWORK_POLICY`
  추가)이라 이 작업 범위 밖이다.
- **AWS VPC CNI는 파드 IP를 VPC CIDR에서 직접 할당한다**(오버레이 네트워크가
  아니라 실제 ENI 보조 IP) — 파드 IP와 노드 IP가 같은 주소 공간을 공유한다.
  이 CNI에서는 `ipBlock`으로 "파드가 아닌 노드(kubelet)"를 구분할 방법이
  없다 — 파드 CIDR과 노드 CIDR이 분리된 오버레이 CNI(Calico, 오버레이 모드의
  Cilium)와 다른 점이다.
- **S3용 VPC Gateway 엔드포인트가 없다**(`app-infra/main.tf`엔 평범한
  `aws_s3_bucket`뿐) — S3/AWS API 트래픽은 NAT 게이트웨이를 거쳐 VPC 밖
  AWS 공개 엔드포인트로 나간다. RDS 트래픽과 달리 VPC CIDR로 좁힐 수 없다.

## Decision

### D1 — NetworkPolicy 리소스 하나, `ingress.yaml`/`servicemonitor.yaml`과 같은 게이팅

`templates/networkpolicy.yaml`은 `networkPolicy.enabled`가 `true`일 때만
렌더링된다(차트 기본값 `false`) — 이 차트에 이미 있는 두 선택적 리소스와 같은
게이팅 방식이다. 다만 기본을 꺼두는 이유는 그 둘과 다르다: CRD가 없거나
DNS/인증서 메커니즘이 없어서가 아니라, 실제 클러스터의 `vpc-cni`가 아직
`NetworkPolicy`를 강제하지 않기 때문이다(Context 참고). 이 리소스는
`values-prod.yaml`에서도 렌더링되도록 미리 켜둔다(`networkPolicy.enabled: true`,
`metrics.serviceMonitor.enabled: true` 옆에 추가) — Terraform 쪽에서 강제가
켜지는 순간 차트를 다시 건드릴 필요 없이 바로 유효해지도록.

### D2 — 아웃바운드가 주된 통제 수단, 인바운드는 의도적으로 최소화

`policyTypes`엔 `Ingress`와 `Egress`가 둘 다 들어가지만, 단일 Deployment
토폴로지(Context 참고) 때문에 둘의 비중은 크게 다르다:

- **인바운드**: `from: [{ podSelector: {} }]` — 릴리스와 같은 네임스페이스의
  파드에서만, 앱 포트로만 허용. 다른 네임스페이스의 파드가 직접 앱에
  접근하는 경로만 막는다. kubelet의 헬스체크 트래픽을 `ipBlock`으로 따로
  구분하려 하지 않는다 — 이 CNI에서는 파드 IP와 노드 IP를 구분할 방법이
  없기 때문이다(Context). AWS의 EKS 공식 문서는 VPC CNI Network Policy
  에이전트의 "strict" 모드에서 노드발 kubelet 프로브가 자동으로 예외
  처리된다고 명시하지만, 실제 반례도 보고돼 있다
  (`aws/amazon-vpc-cni-k8s#2571` — 이 CNI에서 NetworkPolicy가 특정 설정에서
  liveness/readiness 프로브를 막은 사례). 이 보고된 위험 때문에, 나중에
  `vpc-cni`의 강제를 실제로 켜는 사람은 프로덕션에 의존하기 전에 프로브가
  여전히 통과하는지 다시 검증해야 한다 — 이 차트 자체의 kind 검증(D4)은
  Calico를 썼는데, 이건 AWS의 에이전트와는 다른 강제 엔진이라 정책의
  *모양*이 맞다는 것까지만 증명하지, AWS 에이전트가 kubelet 예외 케이스를
  똑같이 처리한다는 것까진 증명하지 않는다.
- **아웃바운드**: 기본 거부 + 명시적 허용 셋 — DNS는 CoreDNS로
  (`namespaceSelector: {}` + `podSelector: {matchLabels: {k8s-app: kube-dns}}`,
  UDP/TCP 53), DB는 `networkPolicy.egress.vpcCidr`(새 값, 기본
  `10.0.0.0/16` — `cluster/main.tf`의 `var.vpc_cidr` 기본값과 동일)의
  `networkPolicy.egress.dbPort`(5432)로, 그 외 HTTPS(443)는 목적지 제한
  없이 — S3 VPC 엔드포인트가 없어(Context) 마지막 규칙은 CIDR로 못 좁히고
  포트만 제한한다.

단일 Deployment 토폴로지에서 이 정책이 실제로 하는 일은 아웃바운드 쪽이다:
앱 파드가(예를 들어 npm 의존성의 공급망 문제로) 침해당했을 때 클러스터
내부로 임의 연결을 만들거나 임의 포트로 데이터를 빼돌리는 걸 막는다.
인바운드는 주로 "다른 네임스페이스의 워크로드가 이 파드에 직접 접근하는"
경로를 닫는 정도다.

### D3 — `networkPolicy.egress.vpcCidr`은 하드코딩이 아니라 운영자가 공급하는 값

이 차트는 실제 VPC CIDR을 알 방법이 없다(Terraform 변수,
`cluster/main.tf`의 `var.vpc_cidr`). `values.yaml`은 그 변수의 기본값과
맞춰 `10.0.0.0/16`을 기본값으로 둔다 — 다른 `-var vpc_cidr=...`로 apply한
배포라면 `image.tag`/`env.S3_BUCKET` 등을 오버라이드하는 것과 같은 방식으로
이 값도 오버라이드해야 한다.

### D4 — throwaway kind + Calico 클러스터로 실제 검증, 주장만 하지 않음

ADR 0041 전례(새 템플릿을 신뢰하기 전에 throwaway 로컬 클러스터에
`helm install --wait`로 검증)를 따라, 2026-09-11에 기본 CNI를 끄고
Calico(v3.28.0)를 설치한 `kind` 클러스터로 검증했다(`kind`의 기본 CNI는
`NetworkPolicy`를 강제하지 않고 Calico는 강제한다). 현재 소스로 새로 빌드한
이미지를 썼고, throwaway `postgres:16` 파드가 RDS 대역을 대신했다(그 파드
IP를 테스트용으로만 `networkPolicy.egress.vpcCidr=<ip>/32`로 넘김 — 실제
운영에서는 실제 VPC CIDR을 쓴다). 수행한 검사와 결과:

- `networkPolicy.enabled=true`로 `helm install --wait`가 **성공**했다 —
  Deployment가 `Ready`에 도달했다는 건, 인바운드 제한에도 불구하고
  kubelet의 liveness/readiness HTTP 프로브(ADR 0031 — readiness는 DB
  연결까지 확인)가 파드에 도달했다는 뜻이다. 이건 이 정책의 규칙이 아니라
  Calico의 kubelet 트래픽 처리 덕분이다 — AWS 에이전트는 다른 엔진이라는
  D2의 단서를 참고.
- `GET /health/live`, `GET /health/ready`, `GET /doc` 모두 **같은**
  네임스페이스의 `curl` 파드에서 Service를 통해 `200`을 응답했다.
- **다른** 네임스페이스에 만든 `curl` 파드는 앱 파드의 Service 접근이
  타임아웃됐다(`curl: (28) Connection timed out`) — 인바운드 제한이
  실제로 강제되고 있음을(허울뿐인 규칙이 아님을) 확인했다.
- 앱과 같은 라벨을 붙인 `curl` 파드(그래서 이 정책의 아웃바운드 규칙이
  적용됨)는 이미 허용된 throwaway Postgres 파드의 IP라도 허용 목록에 없는
  9999 포트로는 타임아웃됐다 — 이미 허용된 **호스트**라도 허용되지 않은
  **포트**는 막힌다는 걸 확인했다. "허용된 세 경로가 우연히 동작한다"가
  아니라 아웃바운드 기본 거부가 실제로 동작한다는 증거다.
- 마이그레이션 Job(pre-install 훅, 허용된 DB 아웃바운드 규칙을 통해
  throwaway Postgres에 씀)이 성공적으로 끝났다 — 그러지 않았다면
  `helm install --wait` 자체가 그 훅에서 실패했을 것이다 — 그리고 앱
  파드 자신의 로그도 모든 라우트가 매핑된 깨끗한
  `Nest application successfully started`를 보여준다. 즉 Postgres
  Service 이름의 DNS 해석과 DB 연결 자체가 허용된 아웃바운드 경로로
  모두 정상 동작했다는 뜻이다.

이 검증은 AWS 자신의 Network Policy 에이전트가 실제 강제 엔진이 됐을 때
정책이 동일하게 동작한다는 걸 증명하지 않는다(D2) — `cluster/main.tf`의
`vpc-cni` 강제가 실제로 켜지면 그때 별도로 다시 검증해야 한다.

## Consequences

- 새 `networkPolicy` values 블록(`enabled`, `egress.vpcCidr`,
  `egress.dbPort`)과 `templates/networkpolicy.yaml`이 차트에 추가됐다 —
  `values-prod.yaml`에서 켜둔다. `README.md`/`README.ko.md`에 활성화
  방법과 kind+Calico 검증 레시피를 문서화했다.
- 실제(현재는 철거된) EKS 대상에는 아직 이 기능이 무효하다 — `vpc-cni`
  애드온의 Network Policy 강제 에이전트가 꺼져 있다. 이걸 켜는 건 이번
  변경에 포함되지 않은 후속 Terraform 작업으로 남겨둔다.
- 인바운드 제한은 일부러 얕게(같은 네임스페이스만) 잡았다 — kubelet 전용
  허용을 시도하지 않은 건 트레이드오프다. VPC CNI에서는 "파드가 아니라
  노드"를 `ipBlock`으로 표현할 방법이 없고, 인바운드를 과도하게 제한하면
  프로브가 실패하는 프로덕션 사고 위험이 지금 감수하는 잔여 위험보다 더
  크다고 판단했다.
- HTTPS 아웃바운드(443)는 AWS IP 대역이나 VPC 엔드포인트로 좁히지 않고
  목적지 제한 없이 열어뒀다 — `app-infra/`에 S3 VPC Gateway 엔드포인트를
  두면 나중에 더 좁힐 수 있다. 이건 별도의, 아직 일정이 잡히지 않은
  Terraform 작업이다.
- 실제 클러스터에서 `vpc-cni`의 강제를 켜기 전에는, D2/D4의 단서대로
  AWS 자신의 Network Policy 에이전트 아래에서
  `/health/live`/`/health/ready`가 여전히 통과하는지 반드시 따로
  검증한다 — kind 결과를 그대로 가져다 쓰지 않는다.

### 추가 기록 (2026-09-22) — Ingress를 켤 때 ALB 인바운드 허용 규칙 추가

D2의 인바운드 규칙은 "같은 네임스페이스 파드만"이었고 ALB 트래픽을 위한 여지는
없었다 — 이 ADR을 쓸 당시엔 Ingress가 아직 실제 라우팅 경로가 아니었다
(`ingress.enabled`는 그때도 지금도 `false`다). 그 뒤 [ADR 0058](0058-ingress-path-allowlist.ko.md)와
[ADR 0060](0060-frontend-same-alb-path-routing.ko.md)이 Ingress에 실제 형태를
줬고(명시적 경로 allow-list, 그다음 같은 ALB를 공유하는 프론트엔드 Service),
ADR 0060을 위해 `alb.ingress.kubernetes.io/target-type: ip`를 추가하면서(이
차트의 두 Service가 전부 `ClusterIP`인데 컨트롤러 기본값 `instance`는
`NodePort`/`LoadBalancer`가 필요해서) 이 공백이 그대로 드러났다: Ingress를
켜는 순간 ALB 자신의 ENI가 `ip` 모드로 파드에 직접 닿으려 하는데, D2의 인바운드
규칙에는 그걸 허용하는 항목이 없었다.

`templates/networkpolicy.yaml`에 `.Values.ingress.enabled`가 `true`일 때만
렌더링되는 인바운드 규칙을 하나 더 추가한다:

```yaml
- from:
    - ipBlock:
        cidr: {{ .Values.networkPolicy.egress.vpcCidr }}
  ports:
    - protocol: TCP
      port: {{ .Values.service.port }}
```

같은 CIDR용 values 키를 새로 만드는 대신 `networkPolicy.egress.vpcCidr`(D3)를
그대로 재사용한다. 두 규칙이 넓어지는 이유는 구조적으로 같다 — RDS(egress의 DB
규칙)도 ALB ENI(이번 인바운드 규칙)도 파드가 아니라서 `podSelector`로 표현할
수 없고, `NetworkPolicy`가 파드 아닌 트래픽에 쓸 수 있는 수단은 `ipBlock`뿐이다.

**감수하는 확장 범위를 그대로 적는다**: `ingress.enabled`가 `true`인 동안, 이
규칙은 ALB의 ENI뿐 아니라 VPC CIDR 안의 *무엇이든* 앱 포트에 닿을 수 있게
허용한다 — 다른 모든 파드와 모든 노드도 같은 CIDR 안에 있고, 표준
`NetworkPolicy`에는 "실제로 ALB에서 온 트래픽"만 골라내는 선택자가 없다(그런
보안 그룹 기반 선택자는 상위 API에 없고, CNI 전용 확장이 있어야 하는데 이
프로젝트는 그걸 쓰지 않는다). D2의 egress DB 규칙이 같은 이유로 이미 감수한
트레이드오프와 같은 것이라 — 새로운 종류의 위험이 아니라 그것의 두 번째
사례로 여기 기록해 둔다. `ingress.enabled`가 `false`인 동안(기본값이자 지금의
`values-prod.yaml` 값 — ADR 0060의 "구현 단계로 넘기는 것" 목록도 아직 켜지
않았다)은 이 규칙 자체가 렌더링되지 않으므로 오늘의 `networkPolicy.enabled:
true` 상태는 그대로다.

**검증하지 못했다.** `kind`+Calico(D4 자신의 레시피)는 이 정책의 나머지
부분을 검증했던 것과 같은 방식으로 이 규칙을 대신 검증할 수 없다 — `kind`
클러스터의 파드 CIDR은 실제 VPC CIDR과 아무 관계가 없어서, "`10.0.0.0/16`
안의 ALB 아닌 주소"를 의미 있게 흉내 낼 방법이 없다. 실제 ALB Controller가
떠 있는 라이브 EKS 클러스터가 필요하다: ALB의 타깃 그룹에 healthy 타깃이
잡히는지(이 규칙이 함께 따라가는 `ip` 모드 수정)와, D2 자신이 이미 남긴
단서대로 이게 Calico가 아니라 AWS 자신의 VPC CNI Network Policy 에이전트로
동일하게 강제되는지 확인한다. `k8s/helm/README.md`("Enabling HTTPS
(Ingress)")의 라이브 전용 미해결 점검 목록에 올려 뒀다.

### 추가 기록 (2026-09-26) — VPC CNI 에이전트를 코드로 켬. 적용과 라이브 검증은 후속 작업

Context와 D1이 하나를 열어 뒀다. `values-prod.yaml`이 `networkPolicy.enabled: true`로 켜 뒀지만
`cluster/main.tf`의 `vpc-cni` 애드온이 기본 설정으로 돌아서, 규칙을 강제하는 Network Policy
에이전트가 꺼져 있고 정책은 작성만 된 채 아무 효과가 없다. **개발자가 2026-09-26에 결정했다:
강제를 켠다.** 정책을 효과 없이 두지 않겠다는 것이다. 대안이던 `vpc-cni = {}` 유지는 코드도
필요 없고 트래픽을 막을 위험도 없지만, `values-prod.yaml`이 켜져 있다고 말하는 방화벽이 아무
일도 하지 않는 채로 남는다. D1대로 에이전트가 켜지는 순간 차트를 다시 바꾸지 않고도 정책이
효력을 갖는다.

**변경은 이제 `cluster/main.tf`에 들어 있다**(`vpc-cni`의 `configuration_values`).
`cluster/`에서 `terraform validate`와 `fmt -check`가 통과했고, plan이나 apply를 한 적은 없다.

켜는 데 필요한 것은 AWS의 EKS 문서(2026-09-26에 읽음, 실행해 보지는 않음)에 따르면 다음과 같다.

- 애드온 설정값 `{"enableNetworkPolicy": "true"}` — 이 저장소에서는 `cluster/main.tf`의
  `cluster_addons.vpc-cni.configuration_values = jsonencode({ enableNetworkPolicy = "true" })`다.
  (`k8s/infra/terraform/README.md`가 예전에 적은 `ENABLE_NETWORK_POLICY`는 self-managed
  애드온의 설정이지, 관리형 애드온의 키가 아니다.)
- VPC CNI `v1.14.0-eksbuild.3` 이상, 노드 커널 `5.10` 이상(EKS 최적화 Amazon Linux AMI는
  이미 충족). 애드온 버전은 비워 두어서 모듈이 클러스터 Kubernetes 버전의 기본 버전을
  고른다(`terraform-aws-modules/eks` `v20.37.2`가 `aws_eks_addon_version`에
  `most_recent = null`을 넘기고, 그러면 기본 버전이 돌아온다). EKS API는 2026-09-26에
  `1.34`의 기본 버전이 `v1.22.4-eksbuild.3`(최신은 `v1.23.1`)이라고 답했고, 최소 요건보다
  훨씬 높다. 기본 버전은 `apply` 전에 바뀔 수 있다.
- 기본값인 "standard 모드": 새 파드는 정책이 붙기 전까지 전부 허용 상태로 시작한다.
  `strict` 모드(기본 거부)는 택하지 않는다 — CoreDNS를 포함해 파드가 닿는 모든 대상에
  정책이 있어야 하기 때문이다.
- 에이전트가 노드 포트 `8162`(메트릭)와 `8163`(상태 확인 프로브)를 쓴다. 이미 그 포트를 쓰는
  앱은 실패한다.

**후속 작업**:

1. 코드 — 2026-09-26에 완료: 위 `cluster/main.tf` 변경. `cluster/`에서 `terraform init
   -backend=false`, `fmt -check`, `validate`가 통과했다. 적용은 나머지 스택과 함께
   한다(`deploy.sh cluster`).
2. 에이전트를 켠 뒤의 라이브 검증(개발자가 실행하고 세션은 보고받은 내용을 기록한다).
   `k8s/helm/README.md`의 Pending 목록에도 있다:
   1. `aws-node` 파드가 컨테이너 두 개(에이전트가 두 번째)로 떠 있고 VPC CNI 버전이
      `v1.14.0-eksbuild.3` 이상인지.
   2. 앱 파드가 Ready가 되고 `/health/live`, `/health/ready`가 계속 통과하는지 — kubelet
      프로브가 막히지 않는지(`aws/amazon-vpc-cni-k8s#2571`).
   3. ALB 타깃 그룹이 healthy인지(위의 VPC CIDR 인바운드 규칙).
   4. `ingress.enabled: false`일 때 다른 네임스페이스의 파드가 앱 파드에 닿지 못하고(타임아웃),
      허용 목록에 없는 포트로 나가는 egress도 타임아웃되는지 — 렌더링만이 아니라 강제가 실제로
      동작하는지. Ingress가 켜져 있으면 위의 VPC CIDR 규칙이 다른 네임스페이스의 파드도
      허용하므로(감수한 확장) 타임아웃이 나오지 않는 것이 정상이다.
   5. 허용 경로가 동작하는지: DNS, 데이터베이스(5432), clamd(3310), HTTPS/443(S3).
      EICAR 업로드는 거부되고 정상 파일은 통과하는지(ADR 0059의 AWS 전용 잔여 검증).
   6. Prometheus가 백엔드를 계속 스크레이프하는지. 인바운드 규칙은 같은 네임스페이스 파드와
      `ingress.enabled`가 true일 때의 VPC CIDR만 허용하는데 Prometheus는 다른 네임스페이스에서
      돌기 때문에, Ingress가 꺼져 있으면 스크레이프가 막힐 수 있다. 템플릿에서 추론한 것이며
      관찰한 적은 없다.
   7. ExternalDNS, External Secrets, ALB Controller가 영향받지 않는지: 정책의 `podSelector`는
      앱 라벨뿐이다.

### Addendum (2026-09-26, 이후) — EKS 라이브 결과

개발자가 스택을 apply했고, 세션이 위의 확인 7개를 직접 실행했다. 읽기 전용 호출과 백엔드 파드
안에서 돌린 프로브 스크립트 한 번(TCP 연결, clamd `PING`, clamd로 정상 바이트 전송)이 전부이고
아무것도 쓰지 않았다. 시각은 UTC다.

| # | 확인 | 결과 |
|---|---|---|
| 1 | 에이전트와 VPC CNI 버전 | 성공. `aws-node`가 두 노드 모두 `2/2`였고, 애드온은 `v1.22.4-eksbuild.3`, `ACTIVE`, 설정 `{"enableNetworkPolicy":"true"}`였다. |
| 2 | 프로브가 막히지 않는지 | 성공. 백엔드는 `1/1 Running`에 재시작 0이었고 `/health/ready`가 파드 안에서 `200`이었다. Warning 이벤트는 기동 중 readiness 실패 2건(`connection refused`)뿐인데, 앱이 아직 listen하지 않았다는 뜻이다(프로브가 막혔다면 타임아웃이 난다). |
| 3 | ALB 타깃 그룹 | 규칙은 동작했고 헬스체크가 문제였다. 백엔드와 admin 그룹이 처음에 `Target.ResponseCodeMismatch [404]`로 `unhealthy`였는데, ALB의 헬스체크가 VPC CIDR 규칙을 통과해 파드에 닿고 응답을 받았다는 뜻이다. 원인은 기본 헬스체크 경로 `/`였고(Service별로 고침, [ADR 0062](0062-admin-same-alb-subpath-routing.ko.md) 추가 기록), 이후 세 그룹이 모두 `healthy`가 됐다. |
| 4 | Ingress가 꺼진 상태의 강제 | 성공. 백엔드 파드에서 `s3.amazonaws.com:80`과 Prometheus 파드의 `:9090`이 타임아웃됐다. 다른 네임스페이스에서 도는 Prometheus도 백엔드를 스크레이프하지 못했다(`context deadline exceeded`). 다른 네임스페이스에 전용 파드를 띄우지는 않았고, 실패한 스크레이프가 네임스페이스 간 차단의 증거다. |
| 5 | 허용 경로 | 대부분 성공. 백엔드 파드에서 DNS가 `sharenpo-clamav`를 해석했고, clamd가 `PING`에 `PONG`, 정상 바이트에 `stream: OK`로 답했고, `s3.amazonaws.com:443`에 연결됐다. 5432는 직접 시도하지 않았고, DB를 ping하는 `/health/ready`의 `200`으로 추정한다. clamd 로그에는 16:37에 이전 백엔드 파드 IP에서 온 `Eicar-Test-Signature FOUND`가 남아 있다. HTTP `400 UPLOAD_MALWARE_DETECTED` 응답과 앱을 거친 정상 파일 업로드는 세션이 관찰하지 못했다. |
| 6 | Prometheus 스크레이프 | 추론대로 Ingress가 꺼진 동안 막혔다(`up{job="sharenpo"}`가 `0`). Ingress를 켜자 VPC CIDR 인바운드 규칙이 생겼고 `up`이 `1`이 됐다(Prometheus의 파드 IP가 `10.0.0.0/16` 안이다). |
| 7 | 다른 애드온이 영향받지 않는지 | 성공. ExternalDNS, External Secrets, ALB Controller 파드가 `Running`이었고 ExternalDNS가 레코드를 만들었으며 오류는 없었다. |

**이번 작업에서 남은 것:** Ingress가 꺼져 있는 동안에는 백엔드 메트릭이 수집되지 않는다.
`kube-prometheus-stack` 네임스페이스를 허용하는 규칙을 더하면 해결되지만, 차트 변경이라 여기서는
하지 않았다.

### 추가 기록 (2026-09-27) — Prometheus 스크레이프 규칙을 차트에 넣었고, 검증은 후속 작업이다

앞선 추가 기록이 남겨 둔 공백, 즉 `ingress.enabled`가 false인 동안 다른 네임스페이스의 Prometheus가
백엔드의 `/metrics`를 스크레이프하지 못하는 문제를 차트에서 해결했다(`15229f6`).
`templates/networkpolicy.yaml`에 인바운드 규칙이 하나 늘었고, `metrics.serviceMonitor.enabled`일 때만
렌더링된다(`values-prod.yaml`이 켠다). 이 규칙의 `from` 항목 하나에 `namespaceSelector`와
`podSelector`를 함께 적어서, 그 네임스페이스 **안의** Prometheus 파드만(AND) 앱 포트로 들어오게 한다.
두 값은 모두 values에서 온다: `networkPolicy.prometheus.namespace`(기본 `kube-prometheus-stack`)와
`networkPolicy.prometheus.podLabels`(기본 `app.kubernetes.io/name: prometheus`). 네임스페이스는 라이브
클러스터에서 관찰한 값이다. 파드 라벨은 `kube-prometheus-stack` `48.2.3` 차트의 Prometheus Service
selector에서 읽은 것이고, 라이브 파드의 라벨을 조회하지는 않았다. Helm은 맵을 병합하므로 `podLabels`를
오버라이드해도 기본 키가 남는다. 그 키를 없애려면 `null`을 준다(렌더로 확인했다).

검토한 대안은 개발자에게 제시한 순서대로이고, 개발자가 첫 번째를 골랐다:

- **모니터링 네임스페이스의 Prometheus 파드만 허용**(채택) — 공백을 닫는 가장 좁은 규칙이다.
- **모니터링 네임스페이스 전체를 허용** — 더 단순하지만 그 네임스페이스의 모든 파드가 앱 포트에 닿을 수
  있고 `/metrics`는 인증이 없다.
- **정책을 끈다**(`networkPolicy.enabled: false`) — D1의 east-west 제한을 통째로 잃는 대가로 공백을
  닫는다.
- **ServiceMonitor를 끈다** — 제한은 유지되지만 백엔드 메트릭을 잃는다([ADR 0047](0047-observability-prometheus-grafana.ko.md)).
- **Prometheus를 앱 네임스페이스로 옮긴다** — 규칙은 필요 없지만 ADR 0047의 배치와 다른 모든 워크로드의
  스크레이프가 바뀐다.

Ingress가 켜져 있으면 VPC CIDR 규칙(D2 추가 기록)이 이미 Prometheus의 파드 IP를 허용하므로, 그때는 새
규칙이 아무것도 바꾸지 않는다. 이 규칙은 Ingress가 꺼져 있어 그 규칙이 렌더링되지 않는 동안에 의미가 있다.

**세션이 확인한 것(2026-09-27):** 다섯 가지 값 조합의 `helm template` — `values-prod.yaml`(같은
네임스페이스 규칙과 Prometheus 규칙), ServiceMonitor 끔(같은 네임스페이스 규칙만), Ingress 켬(Prometheus
규칙 다음에 VPC CIDR 규칙), 네임스페이스·라벨 오버라이드(반영됨), 정책 끔(아무것도 렌더링되지 않음) —
그리고 `helm lint --strict`.

**확인하지 않은 것 — 후속 작업:**

1. `kind`+Calico: 설정한 네임스페이스에서 `app.kubernetes.io/name=prometheus` 라벨을 단 파드는 앱 파드에
   닿고, 같은 라벨이라도 다른 네임스페이스이거나 올바른 네임스페이스에서 라벨이 없으면 둘 다 타임아웃되며,
   같은 네임스페이스의 파드는 여전히 통과해야 한다. 명령은 `k8s/helm/README.md`의 "Prometheus 스크레이프
   규칙 검증하기"에 있다.
2. 다음 라이브 배포에서 Ingress가 꺼진 상태로: Prometheus에 백엔드 대상이 `up`으로 나오고(규칙 전에는
   `down`, `context deadline exceeded`였다), `kubectl get pod -n kube-prometheus-stack --show-labels`에서
   Prometheus 파드에 `app.kubernetes.io/name=prometheus`가 보여야 한다. Calico와 AWS의 에이전트는 강제
   엔진이 서로 달라서(D2) 1번이 이 항목을 대신하지 못한다.
3. 둘 다 통과하면 이 목록과 `k8s/helm/README.md`의 미해결 항목이 관찰 기록으로 바뀐다.

### Addendum (2026-09-29) — 둘 다 확인: Ingress 켠 상태의 기준선, 그리고 Ingress 끈 상태

세션이 라이브 Prometheus를 조회했다(`kubectl -n kube-prometheus-stack port-forward
svc/kube-prometheus-stack-prometheus 9090:9090` 뒤 `GET /api/v1/targets`). 이때 `Ingress`는
**켜져 있었다**(이번 세션 동안의 평상시 상태). `job=sharenpo` 타깃
(`sharenpo-79556dbc48-6cnmm`, endpoint `http`, `http://10.0.10.34:3000/metrics`)은 `up`이었고,
`sharenpo-frontend`나 `sharenpo-admin` job은 아예 나타나지 않았다 — `down`이 아니라 애초에
없는 것인데, 둘 다 `ServiceMonitor`가 없기 때문이다(오직 백엔드만 `/metrics`를 노출함, ADR
0047). `k8s/helm/README.md`의 "Rollout and scraping" 항목과 일치한다.

**위 2번 항목(`Ingress`를 끈 상태의 스크레이프) — 이것도 확인됨.** `ingress.enabled`를
토글하는 건 라이브 release에 대한 `helm upgrade`이고 그동안 공개 사이트가 도메인에서 잠깐
안 되니, 토글 자체는 세션이 아니라 개발자가 돌렸다(`ingress.enabled=false`, 토글만 따로
보려고 이미지 태그는 그대로 유지). `kubectl get ingress -A`가 아무것도 안 보이는 걸 확인한
뒤 세션이 Prometheus를 다시 조회했다: `job=sharenpo`(그때는 `sharenpo-7b4d7c94df-gr2lr`,
ADR 0061 추가 기록의 롤아웃 시험에 쓴 그 파드)는 `up`이었고 `lastError`는 비어 있었으며
`lastScrape`도 몇 초 전이었다 — 2026-09-27 규칙 전에는 `down`/`context deadline exceeded`
였던 것과 대비된다. `kubectl -n kube-prometheus-stack get pod ... --show-labels`로 실제
Prometheus 파드에 `app.kubernetes.io/name=prometheus`가 있는 것도 확인했다 — 차트의 Service
selector에서 추정만 한 게 아니라. 규칙이 설계대로 동작한다.

`Ingress`를 다시 켜면서 이것과는 무관한 부작용이 하나 있었는데, 여기서는 지나가듯만
적는다 — AWS Load Balancer Controller가 ALB를 지웠다가 다시 만들면서 apex DNS 레코드가
고아가 됐다. 이건 NetworkPolicy가 아니라 DNS/ExternalDNS 쪽 문제라, 그 사고와 해결은 여기가
아니라 [ADR 0063](0063-alb-dns-externaldns-and-delegation-set.ko.md)의 2026-09-29(나중)
추가 기록에 적었다.
