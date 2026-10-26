# ADR 0068: 배포 식별자를 `values-prod.yaml`에서 gitignore된 오버레이로 옮긴다

- 상태: 승인됨 — 구현 완료. 렌더링된 차트는 그대로이며 클러스터에는 아무것도 적용하지 않았다
- 날짜: 2026-10-26
- 관련: [ADR 0046](0046-deploy-sequence-automation.ko.md) (`deploy.sh`와 `values-prod.yaml` 오버레이), [ADR 0041](0041-helm-chart-project-adaptation.ko.md) (차트)
- English: [0068-deploy-identifiers-gitignored-overlay.md](0068-deploy-identifiers-gitignored-overlay.md)

## 배경

`k8s/helm/values-prod.yaml`은 공개 저장소에 추적되는 파일인데, 특정 AWS 배포 하나를 가리키는 값 네 개가
들어 있었다. `env.DB_HOST`(RDS 주소), `env.S3_BUCKET`(이름에 AWS 계정 번호가 들어 있다),
`serviceAccount.annotations`의 IRSA role ARN, `ingress.annotations`의 ACM 인증서 ARN이다. 2026-10-21에
README에서 비밀 노출을 점검하다 발견했다. 넷 다 자격 증명은 아니다. 계정 번호나 호스트 이름만으로는 접근할
수 없다. 그래도 이 프로젝트가 어느 계정과 어느 데이터베이스를 쓰는지 알려 주며, 저장소를 읽는 사람에게는
도움이 되지 않는다.

`deploy.sh`가 이 파일을 그대로 `helm upgrade`에 넘기므로(`-f values-prod.yaml`) 값을 자리표시자로 바꿔
두기만 할 수는 없다. 2026-10-21의 첫 결정은 그대로 두는 것이었고(README가 알려진 한계로 적었다),
2026-10-26에 개발자가 정리를 요청했다.

## 결정

### D1 — 네 값은 gitignore된 `k8s/helm/values-prod.local.yaml`에 둔다

Helm은 `-f` 파일 사이에서 맵을 병합하므로 오버레이에는 네 키만 적는다. `values-prod.yaml`에서는 이 값들이
자리표시자(`<AWS_ACCOUNT_ID>`, `<RDS_HOST - set in values-prod.local.yaml>`, `<CERTIFICATE_ID>`)다.
`.gitignore`에 오버레이를 올렸다.

### D2 — `deploy.sh helm`은 오버레이가 없으면 실행을 거부하고, 있으면 `values-prod.yaml` 뒤에 얹는다

검사는 `deploy_helm`의 맨 앞에서 한다. Docker Hub 조회와 y/N 질문보다 먼저다. 검사가 없으면 자리표시자가
그대로 배포된다. 파드는 잘못된 DB 호스트를 받고, 존재하지 않는 role의 IRSA 어노테이션이 붙어, 실패가 늦게
드러난다.

### D3 — 추적되는 `values-prod.local.example.yaml`이 형식과 각 값의 출처를 보여 준다

각 값을 만드는 `terraform output`(`db_host`, `acm_certificate_arn`, role `${cluster_name}-app`, `apply`에
넘긴 `s3_bucket_name`)을 적어 두었다.

## 기각한 대안

| 대안 | 기각 이유 |
|---|---|
| 값을 파일에 그대로 둔다(2026-10-21의 결정) | 자격 증명이 아닌 식별자이고 이력에도 이미 있다. 정리 비용은 파일 하나이고 개발자가 요청했다 |
| `deploy.sh`가 `terraform output`을 읽어 `--set`으로 넘긴다 | Helm만 쓰는 경로(README의 "Helm only")에는 읽을 Terraform state가 없다. role ARN은 점이 들어간 어노테이션 키 아래에 있어 `--set`에서 이스케이프가 필요하다 |
| git 이력을 다시 쓴다(`git filter-repo`) | 비밀이 아닌 값 때문에 `main`·`dev` 강제 푸시가 필요하고 다른 모든 클론이 어긋난다. 하지 않았다 |

## 결과

- 2026-10-26에 `helm template`으로 확인했다. `-f values-prod.yaml -f values-prod.local.yaml`의 출력은 변경 전
  파일의 출력과 같다(607줄, diff 없음). `values-prod.yaml`만 쓰면 8줄이 다르고, 네 자리표시자 때문이다.
  `bash -n deploy.sh`는 통과한다. `IMAGE_TAG`를 지정하고 `deploy.sh helm`을 실행하면 오버레이가 없을 때
  에러로 멈추고, 있을 때는 `n`이라고 답하면 질문에서 멈춘다(`helm upgrade`는 한 번도 실행하지 않았다).
  클러스터는 쓰지 않았고 아무것도 적용하지 않았다.
- 실제 값은 git 이력에 남아 있다. 이력에서 지우지 않았다.
- 배포하는 사람은 각자 `values-prod.local.yaml`이 필요하다. 새로 clone하면 없으므로 첫 `deploy.sh helm`은
  만드는 방법을 알려 주는 메시지와 함께 실패한다.
- 맨 `helm upgrade ... -f values-prod.yaml`에는 두 번째 `-f`가 필요하다. Helm README에 적었다.
- ADR 0046의 본문은 쓰인 그대로 두었다. 이 ADR이 그쪽을 가리키는 역할을 한다.
