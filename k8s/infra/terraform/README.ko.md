# sharenpo (Terraform)

> English: [README.md](README.md)

이 저장소의 Helm 차트(`k8s/helm/`)가 배포될 AWS 인프라를 만듭니다: EKS
클러스터, RDS PostgreSQL, S3 버킷, ESO/IRSA 시크릿 파이프라인, 그리고
ALB + ACM 인증서 기반의 ingress 경로까지 포함합니다. 각 리소스가 왜 여기
있는지, 어떤 대안이 기각됐는지는
[ADR 0043](../../../docs/ADR/0043-terraform-project-adaptation.ko.md)을,
이 디렉터리의 스캐폴딩 이력은
[ADR 0038](../../../docs/ADR/0038-terraform-iac-scaffold.ko.md)을,
아래 구성이 왜 단일 root 모듈이 아니라 3개의 독립적으로 apply 가능한
state로 나뉘어 있는지는
[ADR 0044](../../../docs/ADR/0044-terraform-three-state-split.ko.md)를
참고하세요.

**상태**: **미적용 — 원래 스캐폴드가 안 만들어진 게 아니라, 완전히 destroy된
것입니다.** 세 state 전부와 앱 자체(Helm)까지 2026-08-25~27에 실제 AWS에
apply돼서 end-to-end로 정상 동작까지 확인됐습니다(그 실제 RDS를 상대로 발견·
수정된 TLS 검증 결함은 ADR 0039의 Addendum에 기록돼 있음). 배포가 검증된 뒤
2026-08-28에 AWS 과금을 멈추려고 전부 destroy했습니다 — 이 스택에서 나온 EKS
클러스터, RDS 인스턴스, S3 버킷, Route53 존, NAT 게이트웨이, EC2 인스턴스
어느 것도 지금 존재하지 않습니다(`aws eks/rds/ec2/elb` describe 호출이 전부
빈 값/not-found로 확인됨). 세 state 디렉터리 모두 `terraform validate`,
`terraform fmt -check`는 여전히 통과합니다.

이 상태 설명도 스냅샷일 뿐 확정된 사실이 아닙니다 — 나중에 다시 apply하면
몇 분 안에 이 문단이 틀린 말이 됩니다. 이 문단을 나중에 다시 읽는 사람은
그대로 믿지 말고 `terraform plan`으로 재확인하세요. apply할 땐 `apply` 전에
반드시 `terraform plan`을 돌려 읽고, `destroy`는 함부로 하지 마세요 — RDS
인스턴스가 `skip_final_snapshot = true`, `deletion_protection = false`
상태라 이를 교체하거나 파괴하는 작업은 데이터를 함께 지우고 최종 스냅샷도
남기지 않습니다(그래서 이번 destroy도 즉흥적으로가 아니라 확인을 거쳐
결정한 것입니다). ADR 0043과 0044의 Addendum은 여전히 apply한 적 없다고 적고
있는데, ADR은 작성 시점의 사실을 기록하므로 그대로 두었습니다 — 더 자세한
경위와 보류된 식별자 개명 건은
[ROADMAP.ko.md 7절](../../../docs/ROADMAP.ko.md#7-미일정--미결-사항)을 보세요
(ADR 0043 D1).

## 3개의 state, 하나의 apply 순서

```
k8s/infra/terraform/
├── cluster/       module.vpc + module.eks
├── app-infra/      RDS + S3/IRSA + Secrets Manager + Route53/ACM
└── addons/         module.eks_blueprints_addons (ALB Controller + ESO)
```

각 디렉터리는 독립된 Terraform root 모듈이고 각자 로컬 state 파일
(`terraform.tfstate`, gitignore됨)을 가집니다 — 전체를 한 번에 apply하는
단일 `terraform apply`는 없습니다. apply 순서는 관례가 아니라 데이터 의존
관계로 고정됩니다(ADR 0044 D2):

1. **`cluster/`** 먼저 — 다른 두 state에 대한 의존이 없습니다.
2. **`app-infra/`** 다음 — RDS 보안 그룹과 S3 IRSA 역할의 신뢰 정책을 위해
   `cluster/`의 출력값(VPC/서브넷 ID, EKS 노드 보안 그룹, OIDC 프로바이더)을
   `terraform_remote_state`로 읽습니다.
3. **`addons/`** 마지막 — 둘 다를 읽는 유일한 state입니다: `cluster/`에서
   EKS 연결 정보를, `app-infra/`에서 Secrets Manager ARN을
   (`external_secrets_secrets_manager_arns`) 읽습니다. `app-infra/`가
   존재하기 전에는 이 state를 먼저 apply할 수 없는 이유입니다.

각 state 자신의 `terraform.tfstate`, 그리고 `app-infra/`/`addons/`가 다른
state의 출력값을 읽는 `terraform_remote_state`도 Terraform 기본값인 로컬
파일이 아니라 네이티브 락 + SSE-S3 암호화를 쓰는 S3 버킷에 저장됩니다
([ADR 0057](../../../docs/ADR/0057-terraform-state-backend-s3-native-lock.ko.md),
ADR 0044 D3의 원래 "local, 두 번째 개발자나 CI 파이프라인이 필요해지면
재검토"라는 입장을 수정함 — 2026-09-09 보안 점검에서 `app-infra/`가 생성한
시크릿이 로컬 state 파일에 평문으로 남는다는 사실을 발견해서, 더 일찍
전환할 가치가 생겼습니다). DynamoDB 테이블도, KMS 키도 없습니다 — S3의
네이티브 `use_lockfile`(Terraform 1.11에서 GA)과 무료 SSE-S3만으로 락과
암호화를 둘 다 해결합니다 — 이유는 ADR을 참고하세요(이 AWS 계정에는 사람
주체가 1명뿐이라 KMS의 접근 분리 가치가 아직 적용되지 않습니다 — 언제
재검토할지는 D6에 정해 둠). 아래 명령은 표시된 디렉터리 안에서 각각
실행하세요; `terraform init`도 세 곳에서 각각 따로 실행해야 하고, 이제
매번 `-backend-config="bucket=<value>"`가 필요합니다(아래 부트스트랩 단계
참고).

**이 변경 이후 첫 `apply` 전 1회성 부트스트랩**: `backend "s3" {}` 블록이
가리키는 S3 버킷은 `terraform init`이 쓰기 전에 먼저 존재해야 합니다 —
Terraform이 자기 자신의 backend를 만들어주지는 않습니다. 이건 수동으로
한 번만 하는 작업입니다(일부러 네 번째 Terraform root 모듈로 만들지
않았습니다 — ADR 0057 기각된 대안), apply마다 반복하지 않습니다:

```sh
aws s3api create-bucket --bucket <전역적으로-유일한-tfstate-버킷-이름> \
  --region ap-northeast-2 \
  --create-bucket-configuration LocationConstraint=ap-northeast-2
aws s3api put-bucket-versioning --bucket <그-버킷-이름> \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket <그-버킷-이름> \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

그다음 세 디렉터리 각각에서 `terraform init -backend-config="bucket=<그-버킷-이름>"`을
실행하세요(또는 `deploy.sh`를 쓴다면 `TFSTATE_BUCKET_NAME=<그-버킷-이름>`을
설정 — 아래 모든 `deploy.sh` 명령이 이미 이 값을 기대합니다). 이 버킷은
계속 유지되어야 합니다 — 아래 EKS/RDS 스택처럼 검증 후 지우는 대상이
아닙니다(왜 그렇게 하지 않기로 했는지는 ADR 0057 기각된 대안 참고).

## 아무거나 `apply`하기 전에 준비할 것

1. **DNS를 걸 수 있는 도메인.** `app-infra/`는 `var.domain_name`으로
   Route53 호스팅 영역을 만들고 그 안에서 ACM 인증서를 DNS 검증하지만,
   도메인 자체를 구매/등록하지는 않습니다(ADR 0043 D5) — 최초 도메인 구매는
   대화형이고 되풀이 가능하지 않은 작업이라 Terraform의 모델에 맞지 않기
   때문입니다. 먼저 도메인을 구매한 뒤(Route53 Domains나 임의의
   등록기관), 이 설정이 만드는 영역에 위임하세요(`route53_zone_name_servers`
   출력값을 등록기관의 네임서버로 지정). 그 출력값을 얻기 위해 먼저 한 번
   apply한 뒤 위임해도 됩니다.
   ⚠️ **이 위임은 최초 1회만이 아니라, `app-infra/`를 `terraform destroy` 후
   재apply할 때마다 매번 다시 해야 합니다** — 같은 도메인이어도 새로 만들어진
   hosted zone마다 AWS가 완전히 새로운 네임서버 4개를 발급합니다. `app-infra/`
   디렉터리 안에서 `terraform output route53_zone_name_servers`를(`-raw`
   없이 — 이 출력값은 리스트라 `-raw`는 문자열 타입 출력에만 쓸 수 있음) 다시
   실행해 새 값을 확인하고, 등록기관에 그 새 값으로 갱신하세요 — 예전 apply
   때 쓰던 값은 더 이상 어디도 가리키지 않습니다. 이걸 빠뜨리면 ACM 인증서
   검증이 DNS 문제라는 뚜렷한 에러 없이 그냥 멈추거나 실패합니다.
   **Windows에서는 `app-infra` apply가 아직 실행 중일 때 이 `terraform
   output`이 대개 실패합니다**, `Error: Failed to read state file ... The
   process cannot access the file because another process has locked a
   portion of the file`라는 에러와 함께 — Windows의 파일 잠금이
   Linux/macOS보다 엄격해서, 실행 중인 `apply`가 그 동안 내내
   `terraform.tfstate`를 독점 잠금하고 있기 때문입니다(애초에 이 apply가
   아직 안 끝난 이유가 바로 이것입니다 — 자신의 ACM 검증 대기가 통과하려면
   먼저 네임서버 위임이 끝나야 합니다). 대신 AWS에 직접 물어보세요 — 로컬
   state 파일을 전혀 안 건드립니다:
   ```sh
   aws route53 list-hosted-zones-by-name --dns-name <본인-도메인> \
     --query 'HostedZones[0].Id' --output text
   aws route53 get-hosted-zone --id <위 결과 Id> \
     --query 'DelegationSet.NameServers' --output json
   ```
2. **전역적으로 유일한 S3 버킷 이름** — `app-infra/`의
   `var.s3_bucket_name`에 넣을 값으로, 버킷 이름은 계정을 넘어 AWS
   전체에서 충돌합니다.
3. **Terraform state 저장용으로 별도의, 전역적으로 유일한 S3 버킷**
   (`TFSTATE_BUCKET_NAME` / `-backend-config="bucket=..."` /
   `var.tfstate_bucket_name`) — 위 1회성 부트스트랩 단계 참고
   ([ADR 0057](../../../docs/ADR/0057-terraform-state-backend-s3-native-lock.ko.md)).
   위 `s3_bucket_name`과 같은 버킷이면 안 됩니다(그건 앱이 업로드한
   미디어용이지 Terraform state용이 아닙니다).
4. **필요한 권한을 가진 AWS 자격증명**(EKS/RDS/S3/IAM/Route53/ACM 생성
   권한)과 로컬에 설치된 `aws`/`kubectl`/`helm` CLI — `addons/`의
   `kubernetes`/`helm` provider가 내부적으로 `aws eks get-token`을
   실행합니다.
5. **`region`/`cluster_name`은 세 state의 `.tfvars`/`-var` 값이 모두
   일치해야 합니다.** 이 값들은 `terraform_remote_state`로 자동 공유되지
   않는 순수 변수입니다 — `cluster/`에 준 것과 다른 `cluster_name`을
   `app-infra/`에 주면 plan은 성공하지만 리소스 이름/태그가 서로 어긋난
   구성이 됩니다.

## 배포

**빠른 배포 커맨드 - 순서대로 실행** (처음부터 전체 배포하는 경우; 각 단계가 실제로
뭘 하는지는 아래 "스크립트 진입점"부터 읽으세요):

```sh
cd k8s/infra/terraform
export TFSTATE_BUCKET_NAME=<전역적으로-유일한-tfstate-버킷-이름>  # 위에서 1회성 부트스트랩한 값

# 1. cluster
bash deploy.sh cluster

# 2. app-infra (도메인이 미리 구매돼 있어야 함; 이 apply는 실행 도중 NS 위임을
#    기다리며 멈춤 — 실행 전에 아래 "apply 전에 확인할 것" 먼저 읽으세요)
S3_BUCKET_NAME=<전역적으로-유일한-버킷-이름> DOMAIN_NAME=<도메인> \
  bash deploy.sh app-infra

# 3. addons
bash deploy.sh addons

# 4. kubectl이 새 클러스터를 보도록 설정
eval "$(terraform -chdir=cluster output -raw configure_kubectl)"

# 5. 1회성: 앱의 DB/S3 시크릿을 클러스터에 동기화 (deploy.sh가 자동화하지
#    않음 — 이유는 아래 "세 apply 모두 끝난 뒤" 참고)
terraform -chdir=app-infra output -raw external_secrets_manifest | kubectl apply -f -

# 6. helm (기본값은 dev 최신 이미지; main을 배포하려면 뒤에 "main" 추가)
bash deploy.sh helm
```

`deploy.sh` 안의 모든 `plan`/`apply`는 여전히 멈춰서 명시적으로 `y`를 물어봅니다 —
이 순서는 어떤 승인 게이트도 건너뛰지 않습니다, 그저 커맨드 순서만 정리한 것입니다.

**스크립트 진입점**: `k8s/infra/terraform/deploy.sh`가 아래 3-state apply 순서와
`helm upgrade --install`을 하나의 스크립트로 감쌉니다 — 모든 apply에 plan-then-confirm
게이트가 걸려 있고 `-auto-approve`는 없습니다
([ADR 0046](../../../docs/ADR/0046-deploy-sequence-automation.md)). `bash deploy.sh
all`을 실행하거나(또는 `cluster`/`app-infra`/`addons`/`helm` 개별 실행; 환경변수는
`--help` 참고). 도메인 구매/NS 위임, ESO 시크릿 동기화, `Ingress` 활성화는 다루지
**않습니다** — 이들은 이 문서 아래쪽에 나오는 대로 여전히 수동입니다. 앱의 S3 IRSA
역할은 2026-09-03부터 자동으로 배선됩니다 — `deploy.sh`의 `HELM_RELEASE` 기본값이
`sharenpo`로 바뀌어 `values-prod.yaml`의 `serviceAccount.create: true`,
`app-infra/main.tf`의 trust policy와 모두 맞아떨어지므로, `deploy.sh
helm`/`deploy.sh all` 위에 따로 얹는 수동 어노테이션 단계가 필요 없습니다(이게 실제로
동작하려면 아직 한 번 필요한 Terraform apply는 아래 "Known gap" 참고).

**어느 브랜치의 이미지가 배포되는가** (2026-09-04): `deploy.sh helm`/`deploy.sh all`은
더 이상 `values-prod.yaml`에 고정된 태그를 그대로 믿지 않습니다 — 실행할 때마다 브랜치
기준으로 이미지를 새로 조회합니다. 기본값은 `dev`(지금까지 이 프로젝트의 모든 실제
배포와 일치)이고, `main`을 배포하려면 두 번째 인자로 브랜치를 넘깁니다:

```sh
bash deploy.sh helm main   # main의 최신 발행 이미지 배포
bash deploy.sh helm        # dev의 최신 발행 이미지 배포 (기본값)
```

이건 실행할 때마다 적용되는 것이지, 한 번 정해지면 계속 유지되는 게 아닙니다 —
`main`으로 merge했다고 해서 다음번 `bash deploy.sh helm`(인자 없음)이 자동으로 바뀌지
않습니다, 매번 `main`을 직접 타이핑해야 합니다. 한 세션에서 여러 명령을 반복 실행할
땐 아래처럼 한 번만 설정해두는 게 더 편합니다:

```sh
export DEPLOY_BRANCH=main   # 이 셸 세션 동안만
bash deploy.sh helm         # 이제 인자 없이도 main을 배포
```

두 방식 모두 그 브랜치의 현재 HEAD 커밋을 확인하고 Docker Hub에 매칭되는 이미지
태그가 있는지 진행 전에 확인합니다 — 이미지가 없으면(그 브랜치에서 아직 아무것도
발행된 적 없거나 CI가 아직 도는 중) 조용히 낡은 걸로 진행하는 대신 명확한 에러로
중단합니다. `IMAGE_TAG=<태그>`는 두 브랜치의 HEAD가 아닌 것(예: 예전 sha로 롤백)을
쓸 때만의 raw override로 남아 있습니다. 프론트엔드 이미지(ADR 0060)와 admin 이미지(ADR 0062)도
같은 태그를 씁니다 — 조회는 `bluecode1775/sharenpo`, `bluecode1775/sharenpo-frontend`,
`bluecode1775/sharenpo-admin`을 모두 확인하고, helm 단계는 그 태그를 `image.tag`,
`frontend.image.tag`, `admin.image.tag`로 함께 넘깁니다. `IMAGE_TAG`를 직접 지정하면 세 이미지
모두 확인 없이 그대로 쓰므로, 프론트엔드나 admin 이미지가 없던 시점의 sha로 롤백하면 그
파드가 이미지를 받지 못합니다 — 그런 롤백은 helm을 직접 실행하세요. 아래 수동 순서는 스크립트가 자동화하는
대상이자, 각 단계가 실제로 무엇을 하는지 보는 참고 자료로 남겨둡니다. 이 순서는
최초 배포든, 전체 `terraform destroy`(아래) 이후의 완전 재배포든 똑같이 적용됩니다:

**plan/apply 분리** (ADR 0046 addendum, 2026-09-02): `cluster`/`app-infra`/`addons`에
한해 `bash deploy.sh plan <state>`는 plan을 계산해 고정된 gitignore 경로에 저장만
하고 종료합니다 — apply는 하지 않습니다. `bash deploy.sh apply <state>`는 저장된
plan을 다시 보여주고 여전히 명시적 `y` 확인을 받은 뒤에만 적용합니다. plan 계산과
승인이 바로 이어지지 않을 때(예: `plan` 직후 터미널 앞에 계속 있는 대신 나중에 따로
검토하고 싶을 때) 이 방식을 씁니다 — 위의 `cluster`/`app-infra`/`addons`/`all`
명령은 그대로이며, 한 번에 끝내고 싶을 때는 여전히 더 간단한 선택지입니다. 어느
쪽이든 승인은 필요합니다 — 분리는 "언제 승인하는가"만 "언제 plan을 계산했는가"에서
떼어놓을 뿐, 승인 자체를 없애지 않습니다.

```sh
# 1. cluster/
cd cluster
terraform init -backend-config="bucket=<전역적으로-유일한-tfstate-버킷-이름>"
terraform apply

# 2. app-infra/ — terraform_remote_state로 cluster/의 state를 읽는다
cd ../app-infra
terraform init -backend-config="bucket=<전역적으로-유일한-tfstate-버킷-이름>"
# 아래 apply는 Route53 zone을 새로 만들고, 같은 실행 안에서 ACM이 그 zone을
# 상대로 DNS 검증을 마칠 때까지 대기한다 — 등록기관 네임서버가 이 새 zone을
# 가리키기 전까지는 계속 멈춰 있는다. zone은 이 apply가 만들기 전엔 존재하지
# 않아서 네임서버 값도 미리는 조회할 수 없다 — 이 apply를 먼저 시작하고,
# ACM 검증 대기에 들어가면 그때 다른 터미널을 열어 새 네임서버 값을 조회해서,
# 이쪽이 대기하는 동안 위임하세요:
#   aws route53 list-hosted-zones-by-name --dns-name <본인-도메인> \
#     --query 'HostedZones[0].Id' --output text
#   aws route53 get-hosted-zone --id <위 결과 Id> \
#     --query 'DelegationSet.NameServers' --output json
# 이 값들은 이 zone이 (재)생성될 때마다 매번 새로 발급됩니다 —
# `terraform destroy` 후 재apply하면 예전 네임서버 값은 더 이상 아무 데도
# 안 가리키니 등록기관에서 다시 교체해야 합니다.
terraform apply \
  -var="s3_bucket_name=<전역적으로-유일한-버킷-이름>" \
  -var="domain_name=<본인-도메인>" \
  -var="tfstate_bucket_name=<전역적으로-유일한-tfstate-버킷-이름>"

# 3. addons/ — cluster/와 app-infra/의 state를 모두 읽는다
cd ../addons
terraform init -backend-config="bucket=<전역적으로-유일한-tfstate-버킷-이름>"
terraform apply -var="tfstate_bucket_name=<전역적으로-유일한-tfstate-버킷-이름>"
```

세 state 어느 변수도 비밀값을 직접 받지 않습니다 — Helm 차트의
`secrets.existingSecret`이 필요로 하는 네 값(`DB_USERNAME`, `DB_PASSWORD`,
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`)은 `app-infra/`가
`random_password`로 생성하며, AWS Secrets Manager와 그 state의 Terraform
state 파일 안에만 존재합니다(ADR 0043 D7/D8).

## apply 실패 후 잔재 정리

아래는 이 스택을 처음 배포하면서 실제로 겪었던 실패 양상들입니다(ROADMAP.md
§7) — 각각 그냥 재시도만으로는 안 지워지는 특정한 잔재를 남깁니다.

- **`helm install`/`upgrade`가 실패하고 Helm 릴리스가 `failed` 상태로
  남는 경우** (pre-install/pre-upgrade hook — 보통 마이그레이션 `Job` —
  실패, 또는 AWS Load Balancer Controller의 admission webhook이 아직
  준비 안 된 상태에서 다른 차트가 `Service`를 만들려다 겪는 경합 등).
  같은 `install`/`upgrade`를 재시도하면 `cannot reuse a name that is
  still in use`로 또 실패합니다 — Helm은 명시적으로 지우기 전까진 `failed`
  릴리스를 그 이름으로 그대로 남겨둡니다. 근본 원인을 먼저 고친 뒤:
  ```sh
  helm uninstall <릴리스-이름> -n <네임스페이스>
  ```
  재시도 전에 실행하세요. 이건 Terraform이 관리하는 건 전혀 안 건드리고,
  Kubernetes 쪽 Helm 릴리스 기록과 그게 만든 리소스만 지웁니다.
- **`Error`/`Failed`로 남은 Job과 파드** (예: 진짜 수정이 반영되기 전
  몇 번 실패했던 마이그레이션 Job)는 무해하지만 `kubectl get pods`를
  지저분하게 만듭니다. Job을 지우면 그 파드들도 같이 사라집니다:
  ```sh
  kubectl delete job <job-이름> -n <네임스페이스>
  ```
- **EKS 노드그룹이 `CREATE_FAILED`로 멈춘 경우** (잘못된 `ami_type`,
  계정이 실행 못 하는 인스턴스 타입 등)는 AWS 쪽을 수동으로 정리할 필요가
  **없습니다** — 이 모듈의 `eks-managed-node-group` 서브모듈이
  `lifecycle { create_before_destroy = true }`를 쓰기 때문에, 이전 apply의
  정상 노드그룹은 그대로 살아남습니다. `cluster/main.tf`(예: 인스턴스
  타입)를 고치고 `terraform apply`를 다시 실행하면 실패한 노드그룹만
  교체됩니다.
- **`Error: Error acquiring the state lock`** — `terraform apply`가
  중간에 끊겼을 때(예: Ctrl-C) S3 backend의 네이티브 락(`use_lockfile`,
  ADR 0057)이 정상적으로 안 풀리고 state 버킷 안에 `.tflock` 객체로 남는
  경우입니다. 에러 메시지 자체에 lock ID가 찍혀 나오니 그대로 씁니다:
  ```sh
  terraform force-unlock <LOCK_ID>
  ```
  같은 state를 상대로 실제로 돌고 있는 `apply`/`plan`이 없다고 확신할
  때만 실행하세요 — 진짜로 실행 중인 프로세스가 lock을 쥐고 있는데
  강제로 풀면 state 파일이 깨질 수 있습니다.

## 세 state 모두 `apply`한 이후

1. **kubectl을 새 클러스터로 연결** — `cluster/`에서: `terraform output
   -raw configure_kubectl`이 실행할 명령을 출력해 줍니다.
2. **시크릿을 클러스터로 동기화** — Secrets Manager 항목을 네이티브
   `Secret`으로 미러링하는 `SecretStore`/`ExternalSecret` 객체는 커스텀
   리소스(CRD)라서, `addons/`가 설치한 ESO 자신의 Helm 릴리스가 먼저
   실행되어 그 스키마를 알고 있어야 합니다. Terraform의
   `kubernetes_manifest` 리소스는 CRD를 설치하는 것과 같은 apply 안에서 그
   CRD의 인스턴스를 선언할 수 없다는 알려진 제약이 있어서(provider
   문서에 명시됨), 이 단계는 한 번만 수동으로 수행합니다 — ADR 0043 D5가
   도메인 등록에 이미 쓴 것과 같은 모양입니다. `app-infra/`에서
   실행합니다(매니페스트가 참조하는 건 그 state 자신의 Secrets Manager
   시크릿뿐이므로):

   ```sh
   cd app-infra
   terraform output -raw external_secrets_manifest | kubectl apply -f -
   ```

   동기화됐는지 확인: `kubectl get externalsecret,secret
   $(terraform output -raw app_secret_k8s_name)`.
3. **Helm 차트 설치**, `app-infra/`의 출력값을 그대로 연결합니다:

   ```sh
   cd ../../helm
   helm install sharenpo . \
     --set secrets.existingSecret=$(terraform -chdir=../infra/terraform/app-infra output -raw app_secret_k8s_name) \
     --set env.DB_HOST=$(terraform -chdir=../infra/terraform/app-infra output -raw db_host) \
     --set env.DB_DATABASE=$(terraform -chdir=../infra/terraform/app-infra output -raw db_name) \
     --set env.STORAGE_DRIVER=s3 \
     --set env.S3_BUCKET=$(terraform -chdir=../infra/terraform/app-infra output -raw s3_bucket_name) \
     --set env.AWS_REGION=<var.region과 같은 값> \
     --set env.BASE_URL=https://<본인-도메인>
   ```

## 알려진 한계: 앱의 S3 IRSA 배선은 코드상 완성됐지만 아직 한 번도 적용되지 않음

`app-infra/`의 `aws_iam_role.app`(`app_iam_role_arn`으로 출력)은
`STORAGE_DRIVER=s3`를 켰을 때 앱 파드의 AWS SDK 클라이언트가 S3 자격증명을
실제로 얻게 해주는 IRSA 역할입니다(ADR 0029, ADR 0043 D8). 2026-09-03
기준으로, 아래 조각들이 전부 같은 이름 `sharenpo`를 가리키도록 일관되게
맞춰져 있습니다:

- `app-infra/main.tf`의 `local.app_service_account_name` — 이 역할의
  `assume_role_policy` 조건이 `system:serviceaccount:default:sharenpo`를 매칭
- `k8s/helm/`의 `serviceaccount.yaml` 템플릿 + `values-prod.yaml`의
  `serviceAccount.create: true`(이 역할의 ARN은 `DB_HOST`/`S3_BUCKET`과
  같은 방식으로 `annotations`에 하드코딩 — `k8s/helm/README.ko.md`의
  "IRSA용 전용 ServiceAccount" 참고)
- `deploy.sh`의 `HELM_RELEASE` 기본값 — 그래서 차트가 만드는
  ServiceAccount가 `--set` 없이도 같은 이름으로 떨어짐

**이 중 아무것도 아직 적용되지 않았습니다.** `app-infra/`에서
`terraform fmt -check`/`validate`는 통과하고 `values-prod.yaml`을 얹은
`helm template`/`helm lint`도 정상 렌더링되지만, 이 변경에 대해
`terraform plan`/`apply`를 실제로 돌리지는 않았습니다(아래 참고). 지금
설치할 라이브 클러스터 자체도 없습니다 — 2026-09-03에 확인한
`aws eks list-clusters`/`aws rds describe-db-instances`가 둘 다 빈 목록을
반환해, 이 문서 위쪽이 이미 설명하는 "과금을 멈추려고 destroy된" 상태와
일치합니다. `app-infra/`에서 다음 `terraform apply`(`deploy.sh`를 통해서든
직접이든)를 돌리면 새 trust policy가 자동으로 반영되며, 별도로 남는 수동
단계는 없습니다. 예전 수동 우회법 —
`kubectl annotate serviceaccount default eks.amazonaws.com/role-arn=...` —
은 **이 trust policy가 적용되고 나면 더 이상 통하지 않습니다**: 그 역할이
더는 `default` ServiceAccount를 아예 신뢰하지 않으므로, `default`에
annotate해봐야 아무 효과가 없습니다. 만약 라이브 클러스터를 **더 오래된**
버전의 이 Terraform 코드(여전히 `default`를 신뢰하는 trust policy)로
재배포하면서 이 저장소의 최신 Helm 차트/`values-prod.yaml`(더 이상 `default`에
annotate하지 않고 대신 `sharenpo` ServiceAccount를 만들고 annotate함)을
같이 쓰면, 반대 방향으로 IRSA가 깨집니다 — Terraform 쪽과 Helm 쪽은 항상
같은 커밋에서 함께 배포하세요.

## 알려진 한계: NetworkPolicy가 아직 강제되지 않음(vpc-cni Network Policy 에이전트 꺼짐)

`k8s/helm/`의 `templates/networkpolicy.yaml`([ADR
0056](../../../docs/ADR/0056-networkpolicy-east-west-restriction.ko.md))은 앱 파드의
east-west 트래픽을 제한하고, `values-prod.yaml`은 이미 `networkPolicy.enabled: true`로
켜둔 상태입니다. 다만 `cluster/main.tf`의 `vpc-cni` 애드온은 기본 설정 그대로라
(`cluster_addons = { vpc-cni = {} }`) VPC CNI의 Network Policy 강제 에이전트가 켜져
있지 않습니다 — 지금 이대로 실제 EKS 클러스터에 적용해도 `NetworkPolicy` 오브젝트는
생성되지만 강제되지는 않습니다.

강제를 켜는 건 `cluster_addons.vpc-cni.configuration_values`를 바꿔
`ENABLE_NETWORK_POLICY`를 설정하는 작업입니다 — 아직 하지 않았고, 이 ADR의 범위에도
포함되지 않습니다. 실제 클러스터에 그 변경을 적용하기 전에는 AWS 자신의 Network
Policy 에이전트 아래에서 `/health/live`/`/health/ready`가 여전히 통과하는지 반드시
다시 검증하세요: ADR 0056이 이미 돌린 kind+Calico 검증은 정책의 모양이 맞다는 것만
증명합니다 — Calico와 AWS 에이전트는 서로 다른 강제 엔진이고, 실제로 이 CNI에서
NetworkPolicy가 liveness/readiness 프로브를 막은 사례
(`aws/amazon-vpc-cni-k8s#2571`)가 보고돼 있습니다 — kind 결과를 그대로 가져다 쓰지
마세요.

## ALB ingress 켜기

Helm 차트의 `Ingress` 템플릿은 이미 만들어져 있지만 기본은 비활성입니다
(`ingress.enabled: false`, ADR 0041). `addons/`가 apply되어 ALB
Controller가 `Ingress` 객체를 조정할 수 있는 상태가 되고 `app-infra/`가
인증서를 가진 뒤, 다음으로 켤 수 있습니다:

```sh
helm upgrade sharenpo . \
  --reuse-values \
  --set ingress.enabled=true \
  --set frontend.enabled=true \
  --set admin.enabled=true \
  --set ingress.className=alb \
  --set ingress.annotations."kubernetes\.io/ingress\.class"=alb \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/scheme"=internet-facing \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw acm_certificate_arn) \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"=ip \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"<본인-도메인>","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"},{"path":"/","pathType":"Prefix","service":"frontend"},{"path":"/admin","pathType":"Prefix","service":"admin"}]}]'
```

뒤의 두 annotation이 실제로 HTTP→HTTPS 강제 리다이렉트를 만드는 부분입니다(2026-09-13
점검에서 이 레시피에 빠져 있던 걸 발견) — `listen-ports`를 명시하지 않으면 ALB
Controller가 `ssl-redirect`가 리다이렉트할 대상인 80번 포트 리스너 자체를 열지 않으므로,
`ssl-redirect` 하나만으로는 동작하지 않고 둘을 함께 설정해야 합니다. `hosts` 오버라이드도
예전엔 `--set ingress.hosts[0].host=<본인-도메인>` 형태였는데, 같은 2026-09-13 점검에서
찾아 함께 고쳤습니다 — `--set`은 배열 인덱스에 값을 줄 때 그 원소 전체를 병합이 아니라
교체해버려서, `.host`만 오버라이드하면 실제 도메인은 들어가지만 **경로가 하나도 없는**
`Ingress`가 조용히 렌더링됩니다(실제로 렌더링해서 확인함) — ADR 0058이 막으려던 바로 그
"라우팅 규칙이 조용히 사라지는" 실패입니다. `--set-json`은 `hosts[0]` 객체 전체(도메인과
ADR 0058 경로 목록 전부, ADR 0060의 `/` 프론트엔드 규칙, ADR 0062의 `/admin` admin 규칙)를 한 번에 써 넣어 이 문제를 피합니다. 프론트엔드 규칙을 빼면 API는 그대로인데 SPA만 조용히 사라지고, admin 규칙을 빼면 `/admin`이 프론트엔드의 `/` 규칙으로 떨어져 콘솔이 열리지 않습니다.

명령줄에 `--set`을 매번 다시 치는 대신 체크인된 반복 가능한 형태를 쓰려면,
`k8s/helm/values-prod.yaml`에 같은 설정(도메인, ADR 0058 경로 목록 전체, 위와 동일한
annotation들)이 주석 처리된 템플릿으로 이미 준비돼 있습니다 —
`k8s/helm/README.md`의 "Enabling HTTPS (Ingress)" 절 참고.

이게 실제로 무슨 일을 하는지 끝까지 따라가 보면: 이 명령으로 만들어지는 `Ingress`
객체는 ACM 인증서 ARN을 annotation으로 **표시만** 할 뿐, 그 자체로 AWS에 뭔가를
만들지 않습니다. ALB Controller(`addons/`가 클러스터 안에 설치)가
`ingressClassName: alb`인 `Ingress` 객체를 지켜보다가 그 annotation을 읽고, AWS
API를 직접 호출해 인증서가 이미 HTTPS 리스너에 붙은 상태의 진짜 ALB를 만듭니다 —
"ALB부터 만들고 인증서는 따로 붙이는" 두 단계가 아니라 한 번에 됩니다. 그 AWS API
호출 자체가 로드밸런서의 배포이고, "AWS 쪽"에서 별도로 뭔가 더 일어나지 않습니다.
그 이후 런타임에서는, 사용자의 브라우저가 그 ALB에 HTTPS로 접속하고 — ALB →
Service → Pod 구간은 ADR 0034의 트러스트 바운더리에 따라 클러스터 내부망 안에서
평문 HTTP로 남습니다.

## 각 state가 만드는 것

| State | 리소스 | 목적 | ADR 0043 결정 |
|---|---|---|---|
| `cluster/` | `module.vpc` | VPC, public/private 서브넷, 단일 NAT 게이트웨이 | 원래 스캐폴드에서 변경 없음 |
| `cluster/` | `module.eks` | EKS 클러스터, 이기종 관리형 노드 그룹 2개(`graviton` 주력, `x64` 유휴 대기용) | D3 |
| `app-infra/` | `aws_db_instance.db` | RDS PostgreSQL, private 서브넷, EKS 노드에서만 5432로 접근 가능 | D2 |
| `app-infra/` | `aws_s3_bucket.app` + IRSA 역할 | `STORAGE_DRIVER=s3`용 private 버킷, 앱 파드의 S3 자격증명 | D8 |
| `app-infra/` | `aws_secretsmanager_secret.app` | Helm 차트의 `secrets.existingSecret`이 필요로 하는 네 값 | D7 |
| `app-infra/` | `aws_route53_zone.app` + `aws_acm_certificate.app` | ALB ingress용 DNS 영역과 DNS 검증된 TLS 인증서 | D4, D5 |
| `addons/` | `module.eks_blueprints_addons` | AWS Load Balancer Controller + External Secrets Operator(둘 다 모듈 내장 플래그로 설치) | D6, D7, D9 |

**원래 스캐폴드에서 제거됐고, 주석 처리로 남기지 않음**(D6): `istio-system`
네임스페이스, `istio-base`/`istiod`/`istio-ingress` Helm 릴리스, Istio 전용
노드 보안 그룹 규칙(15017/15012 포트). Istio는 나중에 별도의 Terraform
변경으로 예정되어 있고(ROADMAP.md), 그때 가서 이 모듈이 어떤 모양일지 다시
확인하며 새로 작성하는 편이, 필요해질 때까지 죽은 주석 코드를 계속 맞춰
두는 것보다 쌉니다.

## 삭제(Destroy)

apply의 역순: `addons/` 먼저, 그다음 `app-infra/`, 마지막으로 `cluster/`
— 각 state의 `terraform destroy`는 자신이 소유한 리소스만 plan하지만,
`app-infra/`와 `addons/`는 여전히 `cluster/`의 출력값을 `terraform_remote_state`로
실시간 참조하고 있어서, `cluster/`를 먼저 지우면 이미 존재하지 않는
리소스의 state 파일을 읽는 상태가 됩니다.

AWS Load Balancer Controller 애드온은 리소스 삭제를 비동기로 정리합니다.
ALB ingress를 한 번이라도 켰다면, 원래 Istio 예제와 같은 이유로
`addons/`(또는 ALB가 그보다 오래 남아 있었다면 `cluster/`) 안에서
`terraform destroy`가 VPC `DependencyViolation` 오류로 타임아웃할 수
있습니다 — ALB의 보안 그룹이 명령보다 더 오래 살아남을 수 있기 때문입니다.
Helm 릴리스를 먼저 제거하고, AWS 콘솔에서 ALB와 그 보안 그룹이 실제로
사라졌는지 확인한 뒤 위 순서대로 destroy하세요. 실제 릴리스 이름부터
확인하세요 — 이 문서 예시가 쓰는 차트 이름 `sharenpo`와 같을 필요는
없습니다(현재 라이브 배포의 릴리스 이름은 `upload-board`입니다):

```sh
helm list -A
helm uninstall <릴리스-이름> -n <네임스페이스>
```

`app-infra/`의 `s3_bucket_name`/`domain_name`은 기본값이 없어서(전역적으로
유일해야 하는 버킷/도메인 이름엔 안전한 기본값을 둘 수 없음) `destroy`도
`apply` 때와 같은 `-var` 값이 필요합니다. 저장해두는 커맨드에 하드코딩하지
말고, destroy 직전에 state에서 실제 값을 읽으세요 — 재배포 때마다 값이
바뀔 수 있습니다(예: 버킷이 다른 이름으로 재생성되는 경우):

```sh
cd app-infra
terraform output -raw s3_bucket_name                        # -> 버킷 이름
terraform state show aws_route53_zone.app | grep '  name '  # -> 도메인 이름
```

### 단계별 진행 (매번 plan을 검토)

`deploy.sh` 자신이 인터랙티브 plan 검토를 절대 건너뛰지 않는다는 원칙과
같습니다([ADR 0046](../../../docs/ADR/0046-deploy-sequence-automation.md) D3):

```sh
cd addons
terraform destroy -var="tfstate_bucket_name=<tfstate-버킷-이름>"

cd ../app-infra
terraform destroy \
  -var="s3_bucket_name=<위에서 읽은 값>" \
  -var="domain_name=<위에서 읽은 값>" \
  -var="tfstate_bucket_name=<tfstate-버킷-이름>"

cd ../cluster
terraform destroy
```

### state별 한 줄, 검토 없음 (`-auto-approve`)

위 단계별 방식(그리고 `deploy.sh`의 apply 자동화)이 일부러 유지하는 plan
검토를 건너뜁니다. 각 명령이 실행되는 즉시 실제 과금되는 AWS 리소스가
확인 프롬프트도, 스냅샷도 없이 삭제됩니다(`app-infra/`의 RDS 인스턴스는
`skip_final_snapshot = true`). 이미 각 state가 뭘 담고 있는지 확인했고
(예: 직전에 `plan`을 본 상태) 인터랙티브 재확인만 건너뛰고 싶을 때만
쓰세요:

```sh
cd addons       && terraform destroy -auto-approve -var="tfstate_bucket_name=<tfstate-버킷-이름>"
cd ../app-infra && terraform destroy -auto-approve \
  -var="s3_bucket_name=<위에서 읽은 값>" \
  -var="domain_name=<위에서 읽은 값>" \
  -var="tfstate_bucket_name=<tfstate-버킷-이름>"
cd ../cluster   && terraform destroy -auto-approve
```

`app-infra/`(RDS 데이터, Route53 영역, Secrets Manager)는 남긴 채
`cluster/`만 지우는 것이 바로 이 3-state 분리가 존재하는 이유인 구체적
능력입니다(ADR 0044) — 데이터베이스나 DNS 설정을 잃지 않고 EKS/노드
그룹에 대한 과금만 멈출 수 있습니다. 이 경우에도 `addons/`는
`cluster/`의 출력값에 의존하므로 먼저 내려야 합니다.

세 state를 전부 destroy한 뒤 재배포하려면 위 [배포](#배포) 섹션을 참고하세요 —
같은 순서, 같은 `deploy.sh all`이 그대로 적용됩니다.
