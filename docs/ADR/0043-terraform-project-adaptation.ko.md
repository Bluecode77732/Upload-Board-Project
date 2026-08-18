# ADR 0043: Terraform 프로젝트 적응 — 이 프로젝트의 실제 AWS 리소스, 실제 apply로 검증

- 상태: 승인됨 — 구현됨(`main.tf`/`variables.tf`/`outputs.tf`/`versions.tf`/
  `README.md`를 이 설계에 맞춰 재작성함 — 아래 Addendum 참고). 실제 AWS에
  apply는 아직 안 함
- 날짜: 2026-08-18
- 개정: [ADR 0038](0038-terraform-iac-scaffold.md) ("재작성 유예" 결정을 해제 —
  Helm 쪽에서 [ADR 0041](0041-helm-chart-project-adaptation.md)이 [ADR
  0037](0037-helm-chart-scaffold.md)의 유예를 해제한 것과 같은 관계)
- 관련: [ADR 0029](0029-storage-port-adapter.md) (이 ADR이 설계하는 S3 버킷 +
  앱 IRSA 롤이 `S3Storage`의 실제 목표), [ADR 0030](0030-container-non-root-and-arch-stance.md)
  (이 ADR로 미뤄뒀던 노드 아키텍처 질문), [ADR 0033](0033-secrets-delivery-target.md)
  (이 ADR이 설계하는 ESO/IRSA/Secrets Manager 배선), [ADR 0034](0034-https-termination-stance.md)
  (이 ADR이 설계하는 ALB/ACM ingress 형태), [ADR 0035](0035-arm64-bcrypt-source-rebuild.md)
  (이 ADR 자체의 초안 프레이밍을 정정한 근거 — 맥락 참고), [ADR 0041](0041-helm-chart-project-adaptation.md)
  (D1이 인용하는 실사용 검증 선례)
- English: [0043-terraform-project-adaptation.md](0043-terraform-project-adaptation.md)

## 맥락

[ADR 0038](0038-terraform-iac-scaffold.md)은 `k8s/infra/terraform/`이 업스트림
`terraform-aws-eks-blueprints`의 "EKS Cluster w/ Istio" 예제를 손대지 않은 상태
그대로임을 기록했다: 범용 EKS 클러스터·VPC·Istio 애드온만 프로비저닝할 뿐 —
S3 버킷도, Postgres 대상도, 시크릿 리소스도, 이 프로젝트의 ADR들이 요구하는
ALB/ingress도 없다 — 그리고 재작성을 유예했는데, 당시엔 `plan`/`apply`를 돌려볼
AWS 계정이 없었고 ADR 0033/0034가 정한 목표 형태 자체도 아직 설계만 되어 있었기
때문이다.

그 사이 두 가지가 바뀌었다: Helm 차트의 프로젝트 적응([ADR
0041](0041-helm-chart-project-adaptation.md))이 랜딩해 임시 `kind` 클러스터로
검증까지 마쳤고, 이번 세션에서 이 작업을 위한 라이브 AWS 계정이 있다는 것도
확인됐다. ADR 0038이 걸어둔 두 차단 조건 모두 해소됐다.

이 ADR은 실제 Terraform 코드를 바꾸기 전에 필요한 설계/결정 단계다 — ADR
0029/0033/0034/0030이 미정으로 남긴 여섯 가지 아키텍처적으로 중요한 질문(검증
범위, DB 형태, 노드 아키텍처, 인증서 소스, 도메인 준비 상태, Istio 관련 리소스
처리 방식)을 2026-08-18 개발자와 함께 확정했고, 그 내용을 아래에 기록한다.

이 ADR 자체의 초안 작성 과정에서 ADR 0035가 자신의 결과 섹션에 남긴 것과 같은
원칙 위반이 반복됐다 — 전체 기록은 아래 결과 섹션 참고.

## 결정

### D1 — 검증 범위: `plan`만이 아니라 실제 AWS에 `apply`까지

개발자는 처음엔 이 작업을 구조만 맞추는 범위(라이브 `plan`/`apply` 없음)로
한정했다가, 선례를 보여주자 실제 `terraform apply`까지 검증하는 쪽으로 명시적으로
재결정했다. 선례는 [ADR 0041](0041-helm-chart-project-adaptation.md)의
addendum이다 — 임시 `kind` 클러스터에 `helm install --wait`을 돌렸더니
`helm lint --strict`/`helm template`로는 절대 못 잡았을 실제 버그 두 개(`pre-install`
hook 순서 문제, 빈 문자열 optional env var 문제)가 나왔다. 리소스가 실제로
API 서버에 맞춰 조정될 때만 보이는 오류였다. 여기도 같은 종류의 공백이 있다:
`terraform plan`은 IAM 트러스트 정책이 실제로 깨졌는지, IRSA 롤이 ESO가 실제로
Secrets Manager 항목을 읽게 해주는지, 보안 그룹이 EKS 노드에서 RDS에 실제로
닿게 해주는지, ALB Ingress Controller가 차트의 `Ingress` 리소스로부터 실제로
ALB를 프로비저닝하는지를 잡아내지 못한다. 이런 것들이 정확히 `apply`라야
드러나고 `plan`으로는 안 드러나는 오류 부류다.

트레이드오프를 분명히 밝히면: `apply`는 리소스가 존재하는 동안 실제 시간당
AWS 비용(EKS 컨트롤 플레인, RDS 인스턴스, NAT Gateway, ALB)을 발생시키고,
`terraform destroy`는 업스트림 README가 이미 기록해 둔 VPC dependency-violation
문제를 그대로 물려받는다(ALB Ingress Controller의 비동기 리소스 정리가
`destroy` 명령보다 오래 걸릴 수 있음 — 현재 README가 설명하는 Istio ingress
사례와 같은 구조). 뒷정리엔 같은 종류의 수동 target-then-destroy 절차가
필요한데, 대상이 Istio 리소스가 아니라 AWS Load Balancer Controller의
리소스로 바뀔 뿐이다.

### D2 — DB: RDS PostgreSQL (관리형)

관리형 `aws_db_instance`(Postgres 엔진, `DB_TYPE=postgres`와 일치)를 8개 필수
env var 중 `DB_HOST`/`DB_PORT`/`DB_DATABASE`의 대상으로 삼는다. 기각한 대안:
클러스터 내부 self-hosted Postgres(`StatefulSet` + `PVC`) — 이 프로젝트는 이미
Helm `kind` 클러스터 스모크 테스트(ADR 0041 addendum)에서 정확히 이 형태를
일회성으로 써봤고, 그때도 명백히 throwaway였다. 이걸 영구 대상으로 쓴다는 건
Postgres 백업·failover·패치를 이 프로젝트가 직접 떠안는다는 뜻인데, 이 규모에서
RDS 대비 얻는 이득이 없다 — 포트폴리오 규모 AWS 배포가 정확히 이 역할을 위해
찾는 표준 선택지가 RDS이고, 직접 굴려야 할 만한 반대 근거가 여기엔 없다.

인스턴스는 VPC의 private subnet에 위치하며(모듈이 이미 내보내는
`private_subnets`를 DB subnet group에 재사용 — 이 규모에서 DB 전용 세 번째
subnet 계층까지는 필요 없음), EKS 노드 보안 그룹에서만 5432로 접근 가능하고
공개적으로는 절대 열리지 않는다.

### D3 — 노드 아키텍처: 양자택일이 아니라 이기종 노드그룹

**이 ADR 초안 자체의 오류를 정정함(맥락의 과정 기록 참고)**. "arm64는 추가
작업이 필요하다"는 전제 자체가 틀렸다: [ADR
0035](0035-arm64-bcrypt-source-rebuild.md)가 이미 `bcrypt@6.0.0`에 번들된
arm64 prebuild가 컴파일 단계 없이 동작함을 검증했고, 이 프로젝트가 배포하는
이미지 자체가 이미 두 플랫폼(`linux/amd64,linux/arm64`)으로 `buildx` 빌드되고
있다. 이미지가 이미 멀티아치 매니페스트 리스트이기 때문에, Kubernetes는 pull
시점에 노드별로 알맞은 플랫폼 레이어를 자동으로 골라 쓴다 — 이게 제대로
동작하는 데 `kubernetes.io/arch`에 대한 `nodeSelector`/`nodeAffinity`가 전혀
필요 없다.

그러니 굳이 하나만 고를 이유가 없다. `eks_managed_node_groups`는 스캐폴딩의
단일 `initial` 그룹 대신 두 그룹을 선언한다:

```
eks_managed_node_groups = {
  graviton = {
    instance_types = ["m6g.large"]     # arm64 — 기본 용량
    min_size = 1, max_size = 5, desired_size = 2
  }
  x64 = {
    instance_types = ["m5.large"]      # amd64 — 유휴 예비 용량
    min_size = 0, max_size = 2, desired_size = 0
  }
}
```

`graviton`이 실제 desired 용량을 담당한다(Graviton의 통상적인 x64 대비 약
20% 가격/성능 우위가 여길 기본으로 삼는 이유 — ADR 0035 덕분에 적응 비용이
전혀 없는 진짜 비용 절감 수단이다). `x64`는 `desired_size = 0`으로 두어 —
유휴 비용 0 — Graviton 용량이나 `ap-northeast-2` 가용성이 언젠가 제약이 될 때만
수동으로 스케일업하는 예비 용량으로만 존재한다. 이건 "혹시 몰라서 둘 다 대비"가
아니다(그랬다면 Scope Discipline이 기각했을 것) — 이 프로젝트의 이미지가 이미
커밋했고 이미 검증 비용을 치른(ADR 0035) 멀티아치 스케줄링 능력을, 추가
구현 비용 0으로 그대로 활용하는 것뿐이다.

### D4 — 인증서 소스: ACM

[ADR 0034](0034-https-termination-stance.md)는 ALB/ingress 목표는 정했지만
인증서 소스는 미정으로 남겼다("ACM 발급, 또는 cert-manager + Let's Encrypt").
결정: ACM.

| 기준 | ACM | cert-manager + Let's Encrypt |
|---|---|---|
| 발급 주체 | AWS 관리형 CA | Let's Encrypt (무료 공개 CA) |
| 클러스터 컴포넌트 | 없음 — ALB가 인증서를 직접 참조 | 클러스터에 `cert-manager`를 별도 설치·운영해야 함 |
| DNS 요구사항 | Route53 zone(또는 검증 레코드를 넣을 호스팅 영역) | HTTP-01(Ingress 경유) 또는 DNS-01(Route53 API) challenge — 역시 도메인 필요 |
| 갱신 | AWS가 완전 자동·관리형 | 자동이지만, 클러스터 내부 컴포넌트가 새로운 장애 지점이 됨 |
| 이식성 | ALB의 `certificate-arn` annotation에 강결합 | 클라우드 독립적 — 이 프로젝트가 언젠가 AWS를 떠나도 재사용 가능 |
| 이 프로젝트와의 궁합 | 이미 EKS·RDS·S3·ALB로 AWS에 완전히 커밋된 스택 | ROADMAP.md 어디에도 멀티클라우드 목표가 없어 이 장점이 쓰일 곳이 없음 |
| 운영 부담 | 낮음 | 약간 더 있음 (컴포넌트 하나 추가 관리) |

이 스택이 이미 AWS에 완전히 커밋돼 있고 ROADMAP.md에 멀티클라우드 목표가 전혀
없다는 점에서, cert-manager의 유일한 실질적 장점(이식성)은 여기서 쓰일 데가
없는 반면 ACM의 운영 단순성은 바로 이득이 된다. 결정: ACM.

### D5 — 도메인: Route53 호스팅 영역은 Terraform이 만들지만, 도메인 자체는 apply 전 수동 단계

현재 보유한 도메인이 없다. Terraform은 필수 변수 `domain_name`(기본값 없음 —
D10 참고)으로부터 `aws_route53_zone`을 프로비저닝하고, ACM 인증서를 그 zone의
레코드로 DNS 검증한다. **도메인 등록/구매 자체는 이 Terraform 구성의 범위
밖이다** — 최초 도메인 구매(Route53 Domains 또는 외부 등록업체를 통한)는
대화형이고 비멱등적인 행위라서, 이미 소유한 도메인의 zone을 프로비저닝하는
것과 달리 `terraform apply`의 반복 가능한 수렴 모델에 맞지 않는다. 개발자가
이 부분에 의존하는 첫 `apply` 전에 수동으로 처리한다(도메인을 구매하거나,
기존 외부 등록업체의 네임서버를 Terraform이 만든 zone으로 돌린다) — README
전제조건으로 문서화하며(결과 참고), 자동화하지 않는다.

### D6 — Istio 관련 리소스: 주석 처리가 아니라 완전 삭제

`kubernetes_namespace_v1.istio_system`, `eks_blueprints_addons`의
`helm_releases`에 있는 `istio-base`/`istiod`/`istio-ingress` 항목,
`node_security_group_additional_rules` 블록(15017/15012 포트 — Istio 사이드카
주입 웹훅 전용)을 주석 처리가 아니라 완전히 삭제한다. 근거:

- [ADR 0038](0038-terraform-iac-scaffold.md)이 이미 자기 리소스 세트에 대해
  똑같은 절충안을 기각한 적이 있다("Istio 관련 리소스만 지금 빼고 나머지는
  유지... 실제보다 더 끝난 것처럼 보이는 위험") — Istio를 삭제 대신 주석
  처리하는 것도 형태만 다를 뿐 같은 절충안이다.
- ROADMAP.md는 이미 Istio를 "Terraform 이후 계획... 별도 ADR"로 명시한다 —
  즉 Istio는 나중에 자기만의 전용 Terraform 변경과 전용 ADR을 받게 되는데, 그
  시점엔 클러스터와 애드온 모듈 버전이 어떤 모습일지 몰라 여기 주석 처리해 둔
  것도 어차피 다시 유도해야 한다. 죽은 주석 코드는 그 미래 작업의 시간 절약이
  되지 않는다.
- **AWS Load Balancer Controller 애드온은 유지한다**, 같은
  `eks_blueprints_addons` 모듈을 통해서 — 이건 Istio의 ingress gateway와는
  별개의 능력이다(업스트림 예제의 `enable_aws_load_balancer_controller = true`는
  "Istio Ingress Gateway를 노출하기 위해" 존재하지만, 컨트롤러 자체는 Istio
  유무와 무관하게 어떤 Kubernetes `Ingress` 리소스에도 ALB를 프로비저닝한다).
  이걸 Istio에서 분리하는 게 정확히 D9가 필요로 하는 것이다: 이 프로젝트
  자신의 `Ingress`(Helm 차트에 이미 만들어졌지만 비활성 상태 — [ADR
  0041](0041-helm-chart-project-adaptation.md))는 서비스 메시 없이 ALB
  Ingress Controller만 있으면 된다.

### D7 — 시크릿 전달: ADR 0033의 ESO/IRSA 목표를 실제로 랜딩

[ADR 0033](0033-secrets-delivery-target.md)은 목표 형태(ESO가 AWS Secrets
Manager 항목을 IRSA로 인증해 네이티브 `Secret`으로 동기화)는 정했지만 구축은
정확히 이 Terraform 작업으로 미뤄뒀다. 이 ADR이 그 설계를 채운다:

- `aws_secretsmanager_secret`에 Helm 차트의 `secrets.existingSecret`이 이미
  기대하는 네 값(`DB_USERNAME`, `DB_PASSWORD`, `ACCESS_TOKEN_SECRET`,
  `REFRESH_TOKEN_SECRET`)을 담는다 — Terraform 상태 내부에서
  `random_password`로 생성하며, `.tfvars` 파일에 타이핑되거나 어디에도
  커밋되지 않는다([ADR 0041](0041-helm-chart-project-adaptation.md)이
  리터럴 시크릿 값을 담을 수 있는 코드 경로 자체를 기각한 것과 일관됨).
- IRSA 롤(EKS 클러스터의 OIDC 프로바이더가 신뢰하는 IAM 롤, ESO의 서비스
  어카운트로 범위 한정) — 정책은 그 시크릿 하나의 ARN에 대해서만
  `secretsmanager:GetSecretValue`를 허용한다.
- ESO를 클러스터에 설치(`helm_release`로 — `main.tf`가 다른 클러스터
  애드온에 이미 쓰고 있는 메커니즘과 동일. 차트는 `https://charts.external-secrets.io`의
  `external-secrets`).
- `SecretStore`/`ExternalSecret` 리소스가 Secrets Manager 항목을, Helm
  차트의 `secrets.existingSecret` 값이 참조해야 할 이름의 네이티브 `Secret`으로
  동기화한다 — 이 이름을 Terraform output으로 내보내 이후 `helm install
  --set secrets.existingSecret=...` 단계에 그대로 복사해 쓸 수 있게 한다.

**검증되지 않음 — 단정하지 않고 표시함**: `main.tf`가 이미 의존하는 모듈
`aws-ia/eks-blueprints-addons`에 ESO 설치와 IRSA 롤 프로비저닝을 한 번에
해주는 `enable_external_secrets` 같은 내장 플래그가 있는지는 *여기서 확인되지
않았다* — 이 ADR은 그런 API가 있다고 기억에 의존해 단정하지 않는다(환각 방지
#2). 고정된 `~> 1.16` 버전 기준으로 모듈의 실제 레지스트리 문서를 확인하는
건 Prompt 2의 구현 작업이다. 플래그가 있으면 위의 손수 만든 `helm_release` +
IAM 롤을 모듈 입력 몇 줄로 대체하고, 없으면 위 손수 만든 형태가 대안이 된다.

### D8 — S3 버킷 + 앱 IRSA 롤: ADR 0029의 `S3Storage` 전환 전제조건을 실제로 랜딩

private `aws_s3_bucket`(기본 SSE, `aws_s3_bucket_public_access_block`으로
공개 접근 완전 차단 — 읽기는 앱의 presigned-redirect 경로로만 이뤄짐 — [ADR
0036](0036-s3-presigned-content-redirect.md), 공개 버킷 정책은 절대 쓰지
않음), 필수 변수 `s3_bucket_name`으로부터 이름을 받는다(S3 버킷 이름은
전역적으로 유일해야 해서 안전한 기본값이 없음 — D10 참고). D7의 ESO 롤과는
별개인 두 번째 IRSA 롤을, 애플리케이션 자신의 서비스 어카운트로 범위
한정하고, 그 버킷에 대해서만 `s3:GetObject`/`PutObject`/`DeleteObject`/`ListBucket`을
허용하는 정책을 붙인다 — 이게 `STORAGE_DRIVER=s3`를 켰을 때 `S3Storage`의
`new S3Client({ region })`(ADR 0029 D3 — 명시적 자격증명 없음, SDK 기본
provider chain)가 실제로 동작하는 자격증명을 찾게 해주는 부분이다.

### D9 — ALB Ingress Controller: 유지하되 Istio에서 분리, ADR 0034의 목표를 실제로 랜딩

D6에 따라 `eks_blueprints_addons`의 `enable_aws_load_balancer_controller = true`는
유지하되 Istio 전용 `helm_releases` 항목과 프레이밍은 제거한다. 이 Terraform이
랜딩하면, Helm 차트에 이미 만들어져 있지만 비활성 상태인 `Ingress`
템플릿([ADR 0041](0041-helm-chart-project-adaptation.md))을
`kubernetes.io/ingress.class: alb`와 `alb.ingress.kubernetes.io/certificate-arn`(D4/D5의
ACM 인증서를 가리킴)으로 켤 수 있게 된다 — [ADR
0034](0034-https-termination-stance.md)가 정한 바로 그 목표 형태다. 실제로
켜는 건 이후 과제의 Helm 차트 `values.yaml` 작업이며 이 ADR의 범위가 아니다.

### D10 — `variables.tf` 형태

| 변수 | 타입 | 기본값 | 근거 |
|---|---|---|---|
| `region` | string | `"ap-northeast-2"` | 스캐폴딩의 하드코딩된 `locals.region`(이미 커밋 `d6587f9`로 고정됨)을 오버라이드 가능한 변수로 승격 |
| `cluster_name` | string | `"upload-board-project"` | `basename(path.cwd)` 대체 — 디렉터리 이름에서 유도한 기본값은 클론/CI 체크아웃 경로에 따라 달라져 불안정함 |
| `vpc_cidr` | string | `"10.0.0.0/16"` | 스캐폴딩 값 그대로 — 바꿀 근거를 찾지 못함 |
| `node_desired_size_graviton` / `node_desired_size_x64` | number | `2` / `0` | D3 |
| `db_instance_class` | string | `"db.t4g.micro"` | 포트폴리오 규모 기본값(마찬가지로 Graviton 기반 — D3의 비용 기조와 일관됨); 오버라이드 가능 |
| `db_allocated_storage` | number | `20` | RDS `gp3` 실용적 최소 크기 |
| `db_name` | string | `"upload_board"` | `.env.example`의 예시 값에 이미 쓰인 `DB_DATABASE` 네이밍과 일치 |
| `db_username` | string | `"upload_board_admin"` | 비밀이 아님 — 비밀번호는 비밀(D7이 생성, 변수로 두지 않음) |
| `s3_bucket_name` | string | **필수, 기본값 없음** | 전역적으로 유일해야 해서 안전한 기본값이 있을 수 없음 (D8) |
| `domain_name` | string | **필수, 기본값 없음** | 개발자만 줄 수 있는 실제 값 (D5) |
| `tags` | map(string) | `{}` | `local.tags`로 전달, 기존 `Blueprint`/`GithubRepo` 태그에 추가됨 |

어떤 변수도 시크릿 값을 담지 않는다 — D7/D8의 자격증명은 Terraform이
(`random_password`로) 생성하며 Secrets Manager와 Terraform state에만
저장되고, `variables.tf`나 `.tfvars` 파일이나 버전 관리에는 절대 들어가지
않는다.

## 기각한 대안

- **검증을 `plan`까지만으로 유지** — ADR 0041 선례를 본 뒤 개발자가 명시적으로
  재결정하며 대체됨(D1).
- **클러스터 내부 self-hosted Postgres** — RDS를 선택하며 기각(D2).
- **단일 노드그룹, x64 전부 또는 arm64 전부 양자택일** — 이 ADR 자체의 초안
  프레이밍이었다(맥락의 과정 기록 참고); "ARM은 추가 작업이 필요하다"는 잘못된
  전제를 잡아낸 뒤 D3의 이기종 설계로 정정됨.
- **cert-manager + Let's Encrypt** — 이 스택이 이미 AWS에 완전히 커밋돼 있고
  ROADMAP.md에 멀티클라우드 목표가 없다는 점을 근거로 기각(D4).
- **Istio 전용 리소스를 삭제 대신 주석 처리** — [ADR
  0038](0038-terraform-iac-scaffold.md)이 원본 리소스 세트에 대해 이미 썼던
  같은 절충안 논리로 기각(D6).
- **Terraform에서 도메인 등록을 자동화** — 시도하지 않음; 최초의 대화형 도메인
  구매는, 이미 소유한 도메인의 호스팅 영역을 만드는 것과 달리 Terraform의
  멱등적 수렴 모델에 맞지 않는다(D5).

## 결과

- ROADMAP.md의 Stage 4 컴포넌트 상태표: Terraform 행의 설명을 "스캐폴딩만,
  `variables.tf` 비어있음"에서 "프로젝트 전용 설계 확정(ADR 0043), 구현 대기
  중"으로 옮겨야 한다 — 🔶 상태 기호 자체는 이 ADR만으로는 ✅로 바뀌지 않는다,
  ADR 0033이 실제 코드가 뒤따르기 전까지 📝 설계만 상태를 유지했던 것과
  일관됨. Secrets delivery와 HTTPS termination 행도 구체적인 구현 설계(D7/D4)를
  얻지만 같은 이유로 현재 상태 기호를 유지한다. 이 ADR의 diff엔 적용하지 않고
  후속 문서 갱신으로 추적한다.
- `docs/ADR/README.md`와 `README.ko.md`가 이 ADR의 행을 얻는다(이번 diff).
- **이 ADR과 함께 랜딩하는 Terraform 코드 변경은 없다.** `k8s/infra/terraform/`
  아래의 `main.tf`, `variables.tf`, `README.md`는 이 설계를 바탕으로 후속
  작업에서 재작성된다 — 이 ADR은 그 작업이 구현해 나갈 결정 기록이며, [ADR
  0041](0041-helm-chart-project-adaptation.md)이 자신이 설명하는 Helm 차트에
  대해 갖는 관계와 동일하다.
- 구현 후 실제로 적용하면: 리소스가 존재하는 동안 실제 지속 AWS 비용(EKS
  컨트롤 플레인, RDS 인스턴스, NAT Gateway, ALB)이 발생한다; `terraform
  destroy`는 업스트림 README가 이미 문서화한 VPC dependency-violation 문제를
  그대로 물려받는데, 이번엔 대상이 AWS Load Balancer Controller의
  리소스다(D1).
- ACM 인증서가 DNS 검증되려면 도메인을 (수동으로) 등록하고 그 네임서버를
  Terraform이 만든 Route53 zone으로 돌려야 한다(D5) — 후속 작업의 README
  전제조건이며, 이 ADR이 직접 해결하는 부분은 아니다.
- 스키마·엔티티·API 표면 변경 없음. `docs/ADR/` 밖의 코드는 이 ADR에서
  건드리지 않는다.
- **과정 기록 — 이 ADR 초안 작성 중 벌어진 3중 오류, 전부 개발자가 잡아냈고
  스스로 먼저 잡은 건 하나도 없음.** D3의 설계(이기종 노드그룹)는 같은
  질문에서 세 번 연달아 실수한 끝에 나왔다. 한 번에 다 잡힌 게 아니라 매번
  따로 정정됐다:
  1. **잘못된 전제.** 노드 아키텍처 질문의 첫 초안은 x64와 ARM을, ARM 쪽에
     추가 작업(`bcrypt` 소스 재빌드)이 필요한 트레이드오프처럼 제시했다 —
     [ADR 0035](0035-arm64-bcrypt-source-rebuild.md)가 이미 arm64 prebuild가
     컴파일 단계 없이 동작함을 검증했다는 사실을 먼저 확인하지 않고 기억에
     의존해 단정한 것이었다. 이게 개발자의 첫 답변("x64 유지")을 그대로
     형성했고, 결과적으로 그 답은 틀린 정보 위에서 나온 것이었다.
  2. **전제가 정정된 뒤에도 결정하지 않고 재질문함.** 잘못된 전제를 발견한
     계기는(이 ADR 자신의 인덱스 행을 추가하려고 `docs/ADR/README.md`를 읽던
     중이었다 — 앞선 답변을 스스로 다시 검증해서가 아니었다) 공개한 뒤,
     올바른 다음 단계는 ARM로 곧장 결정하고 근거를 남기는 것이었다 —
     정정된 사실은 진짜 트레이드오프를 남기지 않았다(ARM이 순수하게 더
     저렴하고, 추가 구현 비용이 없고, 이미 검증됨). 그런데도 마치 여전히
     판단이 필요한 것처럼 두 번째 질문을 던졌다. 개발자가 직접
     반박했다("왜 이걸 재질문하지?").
  3. **여전히 스캐폴딩의 단일 노드그룹 구조에 갇혀 있었음.** 정정했다는 그
     두 번째 질문조차 x64와 ARM을 상호 배타적으로 프레이밍했다 — 원본
     스캐폴딩의 `eks_managed_node_groups` 구조(그룹 하나, `instance_types`
     목록 하나)를 그 구조 자체가 맞는지 재검토하지 않고 그대로 물려받았기
     때문이다. 개발자가 직접 물어봐서야("무엇을 선택해야 둘 다 구현할 수
     있는거니?") 이미지가 이미 멀티아치라는 전제 위에서 이기종
     두-노드그룹 설계가 가능할 뿐 아니라 더 낫다는 게 드러났다(이 ADR
     자신의 맥락, D3).
  이건 [ADR 0035](0035-arm64-bcrypt-source-rebuild.md)가 스스로의 결과
  섹션에서 명시한 것과 같은 환각 방지 원칙("모든 가정을 실제로 검증하라...
  ADR에도 적용되며 코드에만 국한되지 않는다")이, 바로 그 교훈을 적용하려던
  이 ADR의 초안 작성 중에 세 번 반복된 사례다 — 매 답변을 그대로 받아들이지
  않고 계속 "왜?"를 물은 개발자 덕분에 잡혔다.

### Addendum (2026-08-18) — Terraform 코드 구현 완료, 검증 통과, 아직 미적용

이 ADR 자신의 상태에 처음 있던 "이 ADR 자체는 Terraform 코드를 바꾸지
않음"이라는 문장은 더 이상 `k8s/infra/terraform/`을 정확히 설명하지 않는다.
후속 구현 작업에서 위 D1–D10에 맞춰 `main.tf`/`variables.tf`/`outputs.tf`/
`versions.tf`/`README.md`(+ `README.ko.md`)를 다시 작성했다: `module.eks`의
이기종 노드 그룹 두 개(D3), EKS 노드 보안 그룹에서만 접근 가능한 private
서브넷의 `aws_db_instance`(D2), private `aws_s3_bucket` + 앱 전용 IRSA
역할(D8), `aws_secretsmanager_secret` + `eks_blueprints_addons`의
`enable_external_secrets` 플래그(D7), DNS 검증되는 `aws_route53_zone` +
`aws_acm_certificate`(D4/D5). Istio 전용 리소스는 주석 처리가 아니라 완전히
삭제했다(D6).

`terraform init -backend=false`, `terraform fmt -check`, `terraform
validate` 모두 통과했다. **`terraform apply`는 실행하지 않았다** — 이
작업으로 만들어진 실제 AWS 리소스는 없으며, D1이 받아들인 "반복 과금"
결과도 아직 실제로 발생하지 않았다.

D7 본문이 열어뒀던 두 가지는 구현 과정에서 해소되거나 결정됐다:

- **D7의 "미확인" 표시가 해소됨.** `aws-ia/eks-blueprints-addons`는 실제로
  `enable_external_secrets`를 갖고 있다(핀된 `~> 1.16` 제약 범위 안의
  `v1.16.0` 태그에서 모듈 소스를 직접 읽어 확인). 이 플래그 하나가 ESO
  Helm 릴리스 설치, IRSA 역할 생성, 그 역할의 서비스 어카운트 주석까지
  한 번에 처리한다. D7이 대안으로 적어둔 손으로 만든 `helm_release` +
  `aws_iam_role`은 필요 없었다.
- **`SecretStore`/`ExternalSecret` 객체를 실제로 어떻게 만드는지 — D7이
  완전히 정하지 않았던 부분.** Terraform의 `kubernetes_manifest` 리소스는
  자신을 정의하는 CRD를 설치하는 것과 같은 apply 안에서 그 CRD의
  인스턴스를 선언할 수 없다(provider 문서에 명시된 제약 — ESO 자신의 Helm
  릴리스가 먼저 떠서 스키마가 존재해야 함). apply를 두 단계로 쪼개는 대신,
  매니페스트 내용을 그냥 Terraform *output*(`external_secrets_manifest`)으로
  렌더링해 한 번만 수동으로 `kubectl apply`한다 — D5가 도메인 등록에 이미
  쓰고 있는 것과 같은 모양이다(이 역시 Terraform의 멱등 수렴 모델에 맞지
  않아서 문서화된 수동 단계로 남겨둔 것).

**새로 생긴 잔여 한계, 새 README에 기록했지만 여기서 고치지는 않음**:
`aws_iam_role.app`의 신뢰 정책은 `system:serviceaccount:default:default`를
대상으로 한다 — Helm 차트(`k8s/helm/`)가 아직 전용 `ServiceAccount`를
렌더링하지 않기 때문이다. `default`에 이 역할의 ARN을 주석으로 달면 이
앱의 파드만이 아니라 그 SA를 쓰는 네임스페이스 안 모든 파드에 S3 권한이
열린다. 전용 `ServiceAccount` 템플릿 추가는 별도의 Helm 차트 작업으로
남으며, D9가 차트의 `Ingress` 활성화를 이미 후속 작업으로 남긴 것과 같은
모양이다.

이 addendum은 이 ADR의 결과 섹션(위)이 후속 작업으로 예고했던 문서
갱신의 계기이기도 하다: `docs/ROADMAP.md`의 Terraform, Secrets delivery,
HTTPS termination 행과 `docs/ADR/README.md`의 이 ADR 행을 이 addendum과
같은 변경에서 갱신했다.
