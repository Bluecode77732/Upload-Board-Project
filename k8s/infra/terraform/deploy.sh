#!/bin/bash
# Purpose: wraps k8s/infra/terraform/README.md's fixed cluster -> app-infra -> addons ->
#   Helm apply order in one script instead of a developer re-deriving it from prose
#   each time.
# Usage: run by hand from any directory, e.g. `bash k8s/infra/terraform/deploy.sh all`.
# Rationale: docs/ROADMAP.md section 7 "Automate the cluster -> app-infra -> addons ->
#   Helm deploy sequence" recorded 8 order-dependent failure modes hit during the first
#   real apply; this is that automation, scoped to Terraform + Helm only
#   (docs/ADR/0046-deploy-sequence-automation.md).
#
# 이 스크립트는 일부러 "쉬운" 스타일로 짰다: bash 배열, trap 같은 고급 기능 대신
# 반복되는 평범한 명령어를 쓴다. 코드가 조금 길어지더라도, 처음 읽는 사람이 위에서
# 아래로 그대로 따라 읽을 수 있는 쪽을 택했다.
#
# plan/apply 분리(ADR 0046 addendum): 검증용으로 반복 apply할 때, plan이 끝난
# 직후 사람이 자리를 비우면(또는 터미널 세션이 끊기면) plan 계산부터 다시 해야
# 하는 낭비가 있었다. cluster/app-infra/addons에 한해 "plan만 계산해서 저장"과
# "저장된 plan을 나중에 승인·적용"을 별도 명령(`plan`/`apply` 서브커맨드)으로
# 추가했다 -- 기존 cluster/app-infra/addons/all 명령은 손대지 않고 그대로 남겨
# 뒀다(승인 즉시 적용, 한 번에 끝내고 싶을 때 계속 쓸 수 있다). 승인(y 입력)
# 자체는 두 방식 모두 여전히 필요하다 -- 없앤 게 아니라 언제 승인할지 시점만
# 갈라놓았을 뿐이다(-auto-approve와의 차이).

# -e : 명령어 하나라도 실패하면(종료 코드가 0이 아니면) 스크립트를 그 자리에서 멈춘다.
# -u : 정의되지 않은 변수를 쓰면 에러로 처리한다 (오타로 빈 값이 쓰이는 걸 방지).
# -o pipefail : "A | B" 처럼 파이프로 연결했을 때, A가 실패해도 B의 성공 때문에
#               전체가 성공한 것처럼 보이는 걸 막는다.
set -euo pipefail

# 이 스크립트 파일이 들어있는 디렉터리로 이동한다.
# 사용자가 저장소 어디에서 이 스크립트를 실행하든(예: 저장소 루트에서 실행해도)
# 항상 같은 위치(k8s/infra/terraform/)를 기준으로 동작하게 하기 위해서다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 환경변수로 값을 주면 그 값을 쓰고, 안 주면 :- 뒤의 기본값을 쓴다.
# (이 기본값들은 각 상태(cluster/app-infra/addons)의 variables.tf 기본값과 같다)
REGION="${REGION:-ap-northeast-2}"
CLUSTER_NAME="${CLUSTER_NAME:-upload-board-project}"
S3_BUCKET_NAME="${S3_BUCKET_NAME:-}"
DOMAIN_NAME="${DOMAIN_NAME:-}"
HELM_RELEASE="${HELM_RELEASE:-upload-board}"

print_usage() {
  echo "사용법: $(basename "$0") [cluster|app-infra|addons|helm|all]"
  echo "       $(basename "$0") plan [cluster|app-infra|addons]"
  echo "       $(basename "$0") apply [cluster|app-infra|addons]"
  echo ""
  echo "README.md의 'cluster -> app-infra -> addons -> Helm' 순서를 그대로 따라간다."
  echo "모든 terraform apply는 먼저 plan을 보여주고, 사람이 직접 y를 입력해야만"
  echo "진행한다 (-auto-approve는 쓰지 않는다 -- 실제 과금되는 AWS 리소스라서)."
  echo ""
  echo "plan/apply를 따로 실행하고 싶다면(예: plan은 미리 계산해 두고, 승인은"
  echo "나중에 자리로 돌아와서 하고 싶을 때) 'plan'과 'apply' 서브커맨드를 쓴다."
  echo "예: $(basename "$0") plan cluster   (계산해서 저장만 함)"
  echo "    $(basename "$0") apply cluster  (저장된 plan을 나중에 검토·승인·적용)"
  echo "cluster/app-infra/addons/all은 기존처럼 plan 직후 바로 승인받아 한 번에"
  echo "끝내고 싶을 때 그대로 쓸 수 있다 -- 어느 쪽도 승인(y 입력) 자체를"
  echo "생략하지 않는다."
  echo ""
  echo "이 스크립트가 다루지 않는 것 (README.md 참고, 계속 손으로 처리):"
  echo "  - 도메인 구매 / DNS 위임"
  echo "  - ESO 시크릿 1회성 동기화"
  echo "  - default ServiceAccount에 S3 IRSA 역할 어노테이션 달기"
  echo "  - Ingress 활성화"
  echo ""
  echo "환경변수:"
  echo "  REGION            기본값: ap-northeast-2"
  echo "  CLUSTER_NAME      기본값: upload-board-project"
  echo "  S3_BUCKET_NAME    app-infra/all 실행 시 필수 (전역적으로 유일한 버킷 이름)"
  echo "  DOMAIN_NAME       app-infra/all 실행 시 필수 (도메인은 미리 구매돼 있어야 함)"
  echo "  HELM_RELEASE      기본값: upload-board"
}

# 목적: terraform plan을 사람이 직접 읽고 확인한 뒤에만, 바로 그 plan을 적용한다.
# 이유: 과금되는 AWS 리소스라서 확인 없이 자동으로 적용되는 경로가 있으면 안 된다.
# 방법: plan을 임시 파일로 저장 -> 사람에게 보여주고 y/N으로 물음 -> y면 그 파일을
#   그대로 apply(다시 물어보지 않음, 사람이 본 계획과 실제 적용이 항상 같다).
run_terraform_step() {
  local dir="$1"
  shift
  # 여기서부터 "$@"에는 함수를 호출할 때 넘긴 -var=... 같은 값들만 남는다.

  local plan_file
  plan_file="$(mktemp)"

  echo "==> $dir 디렉터리에서 terraform plan을 실행합니다"
  (cd "$dir" && terraform plan -out="$plan_file" "$@")

  # 입력을 받을 수 없는 상황(예: 파이프로 실행됨)이면 read 자체가 실패한다.
  # "|| answer=" 로 그 실패를 흡수해서, 대답이 없을 때도 아래 if에서 "N"과
  # 똑같이 취급되게 만든다 -- set -e 때문에 여기서 스크립트가 조용히 끝나버려
  # plan 파일 정리와 안내 메시지 출력을 건너뛰는 걸 막기 위해서다.
  read -r -p "위 plan을 $dir 에 적용할까요? [y/N] " answer || answer=""
  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    (cd "$dir" && terraform apply "$plan_file")
  else
    echo "$dir 단계에서 중단했습니다." >&2
    rm -f "$plan_file"
    exit 1
  fi

  rm -f "$plan_file"
}

# 목적: app-infra/addons를 apply하기 전에 cluster_name이 이미 적용된 cluster/와
#   같은지 확인한다.
# 이유: 세 state는 region/cluster_name을 terraform_remote_state로 자동 공유하지
#   않는 순수 변수라서, 서로 다른 값을 주면 plan은 성공하면서도 리소스 이름/태그만
#   조용히 어긋난다 (README.md "Before you apply anything" #4).
# 방법: cluster/의 실제 적용된 cluster_name output을 읽어서 지금 쓰려는
#   CLUSTER_NAME과 비교한다. cluster/가 아직 apply되지 않았다면(=output이 없다면)
#   건너뛴다 -- 그 경우는 deploy_cluster가 먼저 실행돼야 한다.
check_cluster_name_matches() {
  local applied_name
  applied_name="$(cd cluster && terraform output -raw cluster_name 2>/dev/null || echo "")"

  if [ -n "$applied_name" ] && [ "$applied_name" != "$CLUSTER_NAME" ]; then
    echo "에러: CLUSTER_NAME=$CLUSTER_NAME 이(가) cluster/ 에 이미 적용된" >&2
    echo "cluster_name 값($applied_name)과 다릅니다." >&2
    echo "region/cluster_name이 어긋나면 plan은 성공해도 리소스 이름/태그가" >&2
    echo "조용히 어긋납니다 (README.md 'Before you apply anything' #4 참고)." >&2
    exit 1
  fi
}

# 목적: terraform plan만 계산해서 고정 경로에 저장한다(apply는 하지 않는다).
# 이유: plan 계산 직후 사람이 바로 이어서 승인하지 못하면(자리 비움, 터미널
#   세션 끊김) 기존에는 plan 계산부터 통째로 다시 해야 했다 -- plan과 승인
#   시점을 분리해서 이 낭비를 없앤다. 승인 자체는 없애지 않는다:
#   apply_saved_plan()에서 여전히 사람이 y를 입력해야 한다.
# 방법: terraform plan -out=<고정 파일>만 실행하고 끝낸다. apply는 절대 하지
#   않는다 -- 이 함수 안에는 apply 호출이 없다.
plan_and_save() {
  local dir="$1"
  local plan_file="$2"
  shift 2

  echo "==> $dir 디렉터리에서 terraform plan을 계산해 $dir/$plan_file 에 저장합니다"
  (cd "$dir" && terraform plan -out="$plan_file" "$@")
  echo "==> 저장 완료. 준비되면 나중에 apply 명령으로 이 plan을 검토하고 적용하세요."
}

# 목적: plan_and_save()가 저장해 둔 plan 파일을 사람에게 다시 보여주고, 승인을
#   받은 뒤에만 그 plan을 그대로 적용한다.
# 이유: plan을 계산한 시점과 승인하는 시점이 서로 떨어져 있을 수 있으므로(같은
#   세션이 아닐 수도 있음), 적용 직전에 반드시 다시 한번 내용을 보여준다 --
#   사람이 보지 못한 내용을 적용하는 경로를 만들지 않기 위해서다(run_terraform_step()
#   과 동일한 불변식, ADR 0046 D3).
# 방법: 저장된 plan 파일이 없으면 에러로 안내하고 중단한다. 있으면 terraform
#   show로 다시 출력 -> read -p로 y 확인 -> 그 파일 그대로 apply -> 파일 삭제.
#   저장된 plan이 오래돼 원격 상태와 어긋나면 terraform apply 자체가 거부하고
#   에러를 낸다(조용히 잘못된 내용이 적용되지 않는다) -- 그 경우 plan부터 다시
#   실행해야 한다.
apply_saved_plan() {
  local dir="$1"
  local plan_file="$2"

  if [ ! -f "$dir/$plan_file" ]; then
    echo "에러: $dir/$plan_file 이(가) 없습니다. 먼저 '$(basename "$0") plan $dir'를 실행하세요." >&2
    exit 1
  fi

  echo "==> $dir 에 저장된 plan을 다시 보여줍니다"
  (cd "$dir" && terraform show "$plan_file")

  read -r -p "위 plan을 $dir 에 적용할까요? [y/N] " answer || answer=""
  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    (cd "$dir" && terraform apply "$plan_file")
    rm -f "$dir/$plan_file"
  else
    echo "$dir 단계에서 중단했습니다. 저장된 plan은 $dir/$plan_file 에 그대로 남아 있습니다." >&2
    exit 1
  fi
}

deploy_cluster() {
  (cd cluster && terraform init -input=false)
  run_terraform_step cluster \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME"
}

# 목적: cluster의 plan만 계산해서 저장한다(적용은 apply_cluster()가 별도로 한다).
# 이유/방법: plan_and_save()의 목적/이유/방법 참고 -- cluster는 2단계 apply 같은
#   특수 사정이 없어 그대로 감싸기만 하면 된다.
plan_cluster() {
  (cd cluster && terraform init -input=false)
  plan_and_save cluster .deploy-plan.tfplan \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME"
}

# 목적: plan_cluster()가 저장해 둔 plan을 검토·승인 후 적용한다.
apply_cluster() {
  apply_saved_plan cluster .deploy-plan.tfplan
}

deploy_app_infra() {
  if [ -z "$S3_BUCKET_NAME" ]; then
    echo "에러: S3_BUCKET_NAME 환경변수가 필요합니다 (전역적으로 유일한 버킷 이름)." >&2
    exit 1
  fi
  if [ -z "$DOMAIN_NAME" ]; then
    echo "에러: DOMAIN_NAME 환경변수가 필요합니다 (도메인은 미리 구매돼 있어야 함)." >&2
    exit 1
  fi
  check_cluster_name_matches

  (cd app-infra && terraform init -input=false)

  # ACM 2단계 apply: DNS 검증용 Route53 레코드(aws_route53_record.app_cert_validation)는
  # 인증서(aws_acm_certificate.app)의 domain_validation_options 값을 for_each로
  # 순회하는데, 이 값은 인증서가 먼저 실제로 만들어져야만 알 수 있다.
  # 그래서 인증서만 먼저 apply하고, 그다음에 나머지 전부를 apply한다.
  echo "==> 1단계: ACM 인증서만 먼저 apply (DNS 검증 레코드가 참조할 값을 만든다)"
  run_terraform_step app-infra \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME" \
    -var="s3_bucket_name=$S3_BUCKET_NAME" \
    -var="domain_name=$DOMAIN_NAME" \
    -target=aws_acm_certificate.app

  # 이 2단계에서 aws_route53_zone.app이 새로 만들어지고, 같은 apply 안에서
  # aws_acm_certificate_validation.app이 DNS 검증 완료까지 대기한다. 즉 이
  # 명령을 실행한 터미널이 "끝날 때까지" 네임서버 값을 얻을 방법이 없다 —
  # terraform output은 apply가 끝나야(또는 최소한 그 리소스 apply가 끝나야)
  # 값을 준다. 그래서 위임을 여기서 자동으로 안내할 수 없고, 대신 이 apply가
  # 오래 걸리기 전에 사람이 다른 터미널에서 조치하도록 미리 경고한다.
  echo ""
  echo "⚠️  주의: 이 단계는 Route53 zone을 새로 만든 뒤 ACM 인증서가 DNS로"
  echo "   검증될 때까지 이 터미널에서 계속 대기합니다. 새 zone의 네임서버로"
  echo "   도메인 등록기관(registrar)의 네임서버를 갱신하기 전까지는 검증이"
  echo "   끝나지 않습니다(destroy 후 재apply라면 예전 네임서버 값은 이제"
  echo "   안 쓰이니 반드시 새 값으로 다시 위임하세요)."
  echo "   이 창이 대기하는 동안, 다른 터미널을 열어 아래로 새 네임서버 값을"
  echo "   먼저 확인하고 등록기관에 즉시 반영하세요:"
  echo "     aws route53 list-hosted-zones-by-name --dns-name $DOMAIN_NAME \\"
  echo "       --query 'HostedZones[0].Id' --output text"
  echo "     aws route53 get-hosted-zone --id <위 명령 결과 ID> \\"
  echo "       --query 'DelegationSet.NameServers' --output json"
  echo ""
  echo "==> 2단계: app-infra 전체 apply"
  run_terraform_step app-infra \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME" \
    -var="s3_bucket_name=$S3_BUCKET_NAME" \
    -var="domain_name=$DOMAIN_NAME"
}

# 목적: app-infra 1단계(ACM 인증서)의 plan만 계산해서 저장한다.
# 이유: 2단계(전체) plan은 인증서가 실제로 존재해야만 계산할 수 있어서(2단계의
#   Route53 검증 레코드가 인증서의 domain_validation_options를 for_each로 도는데,
#   이 값은 인증서가 만들어지기 전엔 알 수 없다) 미리 저장해 둘 수 없다. 그래서
#   여기서는 1단계만 저장하고, 2단계는 apply_app_infra()가 1단계를 적용한 직후
#   그 자리에서 바로 계산+승인+적용까지 이어서 한다(deploy_app_infra()의 2단계와
#   동일한 동작).
# 방법: plan_and_save()로 1단계만 -target=aws_acm_certificate.app로 저장한다.
plan_app_infra() {
  if [ -z "$S3_BUCKET_NAME" ]; then
    echo "에러: S3_BUCKET_NAME 환경변수가 필요합니다 (전역적으로 유일한 버킷 이름)." >&2
    exit 1
  fi
  if [ -z "$DOMAIN_NAME" ]; then
    echo "에러: DOMAIN_NAME 환경변수가 필요합니다 (도메인은 미리 구매돼 있어야 함)." >&2
    exit 1
  fi
  check_cluster_name_matches

  (cd app-infra && terraform init -input=false)

  echo "==> app-infra 1단계(ACM 인증서)만 plan을 계산해 저장합니다."
  echo "    (2단계 전체 plan은 인증서가 실제로 만들어져야 계산할 수 있어서,"
  echo "    apply 시점에 자동으로 이어서 계산됩니다.)"
  plan_and_save app-infra .deploy-plan-acm.tfplan \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME" \
    -var="s3_bucket_name=$S3_BUCKET_NAME" \
    -var="domain_name=$DOMAIN_NAME" \
    -target=aws_acm_certificate.app
}

# 목적: plan_app_infra()가 저장해 둔 1단계 plan을 승인·적용하고, 곧바로 2단계
#   (전체)를 계산+승인+적용까지 이어서 진행한다.
# 이유/방법: plan_app_infra()의 주석 참고 -- 2단계는 구조적으로 미리 저장해 둘
#   수 없는 값이라, deploy_app_infra()의 2단계와 동일하게 그 자리에서 처리한다.
apply_app_infra() {
  apply_saved_plan app-infra .deploy-plan-acm.tfplan

  echo ""
  echo "⚠️  주의: 이 다음 2단계는 Route53 zone을 새로 만든 뒤 ACM 인증서가 DNS로"
  echo "   검증될 때까지 이 터미널에서 계속 대기합니다. 새 zone의 네임서버로"
  echo "   도메인 등록기관(registrar)의 네임서버를 갱신하기 전까지는 검증이"
  echo "   끝나지 않습니다. 이 창이 대기하는 동안, 다른 터미널을 열어 아래로"
  echo "   새 네임서버 값을 먼저 확인하고 등록기관에 즉시 반영하세요:"
  echo "     aws route53 list-hosted-zones-by-name --dns-name $DOMAIN_NAME \\"
  echo "       --query 'HostedZones[0].Id' --output text"
  echo "     aws route53 get-hosted-zone --id <위 명령 결과 ID> \\"
  echo "       --query 'DelegationSet.NameServers' --output json"
  echo ""
  echo "==> app-infra 2단계(전체) apply"
  run_terraform_step app-infra \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME" \
    -var="s3_bucket_name=$S3_BUCKET_NAME" \
    -var="domain_name=$DOMAIN_NAME"
}

deploy_addons() {
  check_cluster_name_matches
  (cd addons && terraform init -input=false)
  run_terraform_step addons \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME"
}

# 목적: addons의 plan만 계산해서 저장한다(적용은 apply_addons()가 별도로 한다).
# 이유/방법: plan_and_save()의 목적/이유/방법 참고 -- addons는 2단계 apply 같은
#   특수 사정이 없어 그대로 감싸기만 하면 된다.
plan_addons() {
  check_cluster_name_matches
  (cd addons && terraform init -input=false)
  plan_and_save addons .deploy-plan.tfplan \
    -var="region=$REGION" \
    -var="cluster_name=$CLUSTER_NAME"
}

# 목적: plan_addons()가 저장해 둔 plan을 검토·승인 후 적용한다.
apply_addons() {
  apply_saved_plan addons .deploy-plan.tfplan
}

deploy_helm() {
  local helm_dir="$SCRIPT_DIR/../../helm"

  echo "==> Helm 배포: 릴리스 이름 $HELM_RELEASE ($helm_dir, values-prod.yaml 사용)"
  echo "    (secrets.existingSecret으로 참조하는 Secret이 이미 만들어져 있어야 합니다 -- README.md 참고)"
  # run_terraform_step과 같은 이유로 read 실패를 흡수한다.
  read -r -p "helm upgrade --install 을 실행할까요? [y/N] " answer || answer=""

  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    (cd "$helm_dir" && helm upgrade --install "$HELM_RELEASE" . -f values-prod.yaml)
    (cd "$helm_dir" && helm status "$HELM_RELEASE")
  else
    echo "helm 단계에서 중단했습니다." >&2
    exit 1
  fi
}

# 인자를 안 주면 "all"을 실행한다.
command="${1:-all}"
# plan/apply 서브커맨드일 때만 쓰는 두 번째 인자(대상 state 이름).
target="${2:-}"

case "$command" in
  cluster)
    deploy_cluster
    ;;
  app-infra)
    deploy_app_infra
    ;;
  addons)
    deploy_addons
    ;;
  helm)
    deploy_helm
    ;;
  all)
    deploy_cluster
    deploy_app_infra
    deploy_addons
    deploy_helm
    ;;
  plan)
    case "$target" in
      cluster) plan_cluster ;;
      app-infra) plan_app_infra ;;
      addons) plan_addons ;;
      *)
        echo "사용법: $(basename "$0") plan [cluster|app-infra|addons]" >&2
        exit 1
        ;;
    esac
    ;;
  apply)
    case "$target" in
      cluster) apply_cluster ;;
      app-infra) apply_app_infra ;;
      addons) apply_addons ;;
      *)
        echo "사용법: $(basename "$0") apply [cluster|app-infra|addons]" >&2
        exit 1
        ;;
    esac
    ;;
  -h | --help)
    print_usage
    ;;
  *)
    print_usage
    exit 1
    ;;
esac
