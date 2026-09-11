# sharenpo (Helm 차트)

> English: [README.md](README.md)

이 저장소의 백엔드(`Dockerfile`, Docker Hub의 `bluecode1775/sharenpo`)를
Kubernetes용으로 패키징합니다. 이 차트가 별도 `helm/` 폴더가 아니라 `k8s/`
아래에 있는 이유는
[ADR 0042](../../docs/ADR/0042-k8s-helm-directory-consolidation.ko.md)를,
차트가 왜 이런 모양인지는
[ADR 0041](../../docs/ADR/0041-helm-chart-project-adaptation.ko.md)을,
스캐폴딩 이력은 [ADR 0037](../../docs/ADR/0037-helm-chart-scaffold.ko.md)을
참고하세요.

**상태**: 로컬 임시 `kind` 클러스터에 대해 `helm install --wait`로 종단 간 검증
완료(2026-08-17) — Docker Hub의 `bluecode1775/sharenpo:latest`(ADR 0039의 SSL
수정 이전 이미지)가 아니라 현재 소스로 새로 빌드한 이미지, 임시
`postgres:16`, 그리고 `/health/live`/`/health/ready`/`/doc` 모두 Service를
통해 `200`을 응답했습니다. 이 실행에서 실제 버그 2개를 발견해 고쳤습니다(hook
순서, 빈 문자열 env var — 커밋 `0326199`).
**2026-08-17에 실제 배포 시작 → 2026-08-27에 안정화 → 2026-08-28에 철거**: 릴리스
`upload-board`가 `k8s/infra/terraform/cluster/`가 만든 실제 AWS/EKS 클러스터에서
동작했습니다(revision 5, `STATUS: deployed`) — 전체 경위는
[ROADMAP.md](../../docs/ROADMAP.md) §9(2026-08-27 항목) 참고, RDS 인스턴스의
`rds.force_ssl`이 요구해서 필요했던 `DB_SSL`/`DB_SSL_CA` 수정도 포함됩니다(ADR
0039). 클러스터 내부에서만 접근 가능한 채로 유지됐습니다(`ingress.enabled:
false` — 끝까지 켠 적 없음). 배포가 end-to-end로 검증된 뒤, 과금을 멈추려고
밑단 AWS 인프라를 전부 destroy했습니다(ROADMAP.md §9, 2026-08-28 항목) —
**지금은 아무것도 안 돌고 있습니다**. 이 차트 자체 내용은 영향 없고,
`bash k8s/infra/terraform/deploy.sh all`(ADR 0046)로 처음부터 다시 같은 배포를
재현할 수 있습니다.

## 설치 전: Secret 먼저 만들기

이 차트는 `Secret` 리소스를 직접 만들지 않고, 비밀값을 `values.yaml`
리터럴로도 받지 않습니다(ADR 0041, ADR 0033의 목표 형태). 먼저 직접
만들어야 합니다:

```bash
kubectl create secret generic sharenpo-secrets \
  --from-literal=DB_USERNAME=<db-username> \
  --from-literal=DB_PASSWORD=<db-password> \
  --from-literal=ACCESS_TOKEN_SECRET=<random-string> \
  --from-literal=REFRESH_TOKEN_SECRET=<random-string>
```

값을 나중에 갱신하려면 `--dry-run=client -o yaml | kubectl apply -f -`로 다시
실행하세요.

그다음 차트가 그 이름을 참조하도록 지정합니다:

```bash
helm install sharenpo . \
  --set secrets.existingSecret=sharenpo-secrets \
  --set env.DB_HOST=<postgres-host> \
  --set env.DB_DATABASE=<postgres-db> \
  --set env.BASE_URL=https://<your-host>
```

`secrets.existingSecret`은 `required`로 지정돼 있어, 설정하지 않으면 pod가
env var 누락으로 crash-loop에 빠지는 대신 설치 자체가 명확한 에러로 즉시
실패합니다.

실제 AWS 배포용으로는 `values-prod.yaml`이 반복되는 `--set env.X=Y` 나열을
정리해둔 파일입니다(2026-08-27, 첫 실제 배포로 어떤 값이 실제로 필요한지
확인된 뒤 추가 — ROADMAP.md §9 참고). 릴리스 이름은 `sharenpo`입니다
(2026-09-03 확정, ROADMAP.md §7 — `deploy.sh`의 `HELM_RELEASE` 기본값,
`values-prod.yaml`의 `serviceAccount.create: true`, `app-infra/main.tf`의
IRSA trust policy 넷 다 같은 이름으로 고정돼 있습니다; 이전 이름으로
실제 배포됐던 라이브 릴리스는 `upload-board`였습니다 — 위 "상태" 참고).
**맨 `helm upgrade`가 아니라 `deploy.sh`를 쓰세요**:

```bash
bash k8s/infra/terraform/deploy.sh helm
```

`values-prod.yaml`은 더 이상 그 자체로 신뢰할 수 있는 `image.tag`를 고정해두지
않습니다(2026-09-04, [ROADMAP.md](../../docs/ROADMAP.md) §7) — `deploy.sh helm`이
해당 브랜치의 현재 발행된 이미지를 직접 조회해서(기본값 `dev`, `main`을 배포하려면
`deploy.sh helm main`) 이 파일 위에 `--set image.tag=...`로 얹어줍니다.
`helm upgrade sharenpo . -f values-prod.yaml`을 직접 실행하면 이 조회를 건너뛰고
`values-prod.yaml`에 그때 적혀 있던 태그를 조용히 그대로 배포하는데, 이게 바로 그
항목이 막으려는 낡은 태그 문제입니다 — 특정 이미지를 의도적으로 고정하고 싶을
때만 아래처럼 `--set image.tag=<태그>`를 직접 넘기며 맨 명령을 쓰세요:

```bash
helm upgrade sharenpo . -f values-prod.yaml --set image.tag=<태그>
```

비밀값은 여기 없습니다 — `secrets.existingSecret`은 위에서 만든 Secret의
이름만 가리킬 뿐, Secret 자체는 이 파일과 무관합니다.

오브젝트 이름은 차트 이름이 아니라 **릴리스 이름**(위 예시의 `sharenpo`)에서
옵니다 — `_helpers.tpl`의 `fullname` 헬퍼가 `.Release.Name`이기 때문입니다.
다른 릴리스 이름으로 설치하면 모든 오브젝트 이름이 그에 맞춰 바뀌며,
`Chart.yaml`을 따르는 건 `app.kubernetes.io/name` 라벨과 `helm.sh/chart`뿐입니다.

## 각 템플릿이 하는 일

| 템플릿 | 종류 | 비고 |
|---|---|---|
| `deployment.yml` | Deployment | 이미지, 포트 3000, `/health/live`+`/health/ready` probe(ADR 0031), non-root `securityContext`(ADR 0030) |
| `service.yaml` | Service | `ClusterIP`, 포트 3000 |
| `configmap.yaml` | ConfigMap | `values.yaml`의 `env:` 블록 아래 모든 키 |
| `migration-job.yml` | Job (Helm hook) | pre-install/pre-upgrade 시점에 `migration:run` 실행, `docker-compose.yml`의 `migrate` 서비스를 본뜸(ADR 0032) |
| `ingress.yaml` | Ingress | 기본 비활성(`ingress.enabled: false`) — TLS는 여기서 종료, 앱 내부에서는 안 함(ADR 0034) |
| `serviceaccount.yaml` | ServiceAccount | 기본 비활성(`serviceAccount.create: false` — Deployment는 네임스페이스의 `default` ServiceAccount로 그대로 뜸). S3 IRSA 권한을 네임스페이스의 모든 pod가 아니라 이 앱에만 좁히려면 켠다 — 아래 "IRSA용 전용 ServiceAccount" 참고 |
| `networkpolicy.yaml` | NetworkPolicy | 기본 비활성(`networkPolicy.enabled: false`) — 앱 파드의 인바운드/아웃바운드 트래픽을 제한한다. 아래 "NetworkPolicy" 참고(ADR 0056) |

`values.yaml`엔 실제로 템플릿이 읽는 키만 남아 있습니다 — 어떤 템플릿도 소비하지
않던 `autoscaling`/`httpRoute`/`nameOverride`/`fullnameOverride` 스캐폴딩
잔재는 제거했습니다. `serviceAccount`도 원래 같은 목록에서 제거됐었지만,
구체적인 필요가 생기면서(아래 참고) `ingress.yaml`과 같은 기본-비활성 패턴으로
자기 템플릿을 다시 갖게 됐습니다. HPA나 Gateway API `HTTPRoute`를 나중에
추가하려면 여전히 새 템플릿과 `values.yaml` 블록을 함께 다시 넣어야지, 값만
되살려선 안 됩니다.

## IRSA용 전용 ServiceAccount

`app-infra/`의 `aws_iam_role.app`은 `STORAGE_DRIVER=s3`일 때 S3 접근을
허용하는 IRSA 역할입니다(ADR 0029, ADR 0043 D8). `serviceAccount.create:
true`로 켜면 이 차트가 자체 `ServiceAccount`(`serviceaccount.yaml`)를 만들어
Deployment에 네임스페이스의 `default` 대신 그것을 붙입니다 — 이게 없으면
`default`를 쓰는 네임스페이스의 모든 pod가 거기 annotate된 역할을 이 앱
파드뿐 아니라 다 같이 나눠 쓰게 됩니다.

`values-prod.yaml`은 이미 이걸 켜뒀습니다(`serviceAccount.create: true` +
이 역할의 ARN을 `annotations`에 — 2026-09-03 추가), 그래서 위 실제 배포
명령엔 더 얹을 게 없습니다. 이름은 릴리스 이름인 `sharenpo`로 떨어지는데
(ROADMAP.md §7), 이건 `app-infra/main.tf`의 `aws_iam_role.app` trust
policy와 `deploy.sh`의 `HELM_RELEASE` 기본값이 가리키는 이름과도 같습니다
— 셋 다 이름이 맞아야 IRSA가 실제로 인증됩니다.

`values-prod.yaml` 없이 단독으로 켜려면:

```bash
helm upgrade sharenpo . \
  --reuse-values \
  --set serviceAccount.create=true \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw app_iam_role_arn)
```

이 중 아무것도 아직 실제 AWS에 적용되지 않았습니다 — 현재 상태와, 예전
수동 `kubectl annotate serviceaccount default ...` 우회법이 `app-infra/`의
trust policy 적용 이후 왜 더 이상 안 통하는지는
`k8s/infra/terraform/README.md`의 "Known gap" 참고. migration Job은
`serviceAccount.create`가 켜져 있어도 일부러 계속 `default`로 돕니다 — DB
자격증명만 Secret에서 읽을 뿐 S3를 건드리지 않으므로, 앱의 IRSA 신원을
붙이면 이유 없이 권한만 넓어집니다.

## NetworkPolicy

앱 파드의 트래픽을 제한한다([ADR 0056](../../docs/ADR/0056-networkpolicy-east-west-restriction.ko.md)).
기본 비활성(`networkPolicy.enabled: false`) — `ingress.yaml`/`servicemonitor.yaml`과
같은 이유(DNS/인증서 메커니즘 없음, CRD 없음)는 아니고,
`k8s/infra/terraform/cluster/main.tf`의 `vpc-cni` 애드온이 아직 VPC CNI
Network Policy 강제 에이전트를 켜지 않았기 때문이다 — 지금
`networkPolicy.enabled`을 켜도 리소스는 생성되지만 실제 클러스터엔 강제되지
않는다. `values-prod.yaml`은 이미 켜둬서, Terraform 쪽 강제가 켜지는 순간
차트를 더 건드릴 필요 없이 바로 유효해진다.

인바운드는 같은 네임스페이스의 파드로만 제한한다(다른 네임스페이스의 파드가
이 파드에 직접 접근하는 걸 막는다) — kubelet의 헬스체크 트래픽을 위해 따로
허용 규칙을 파지는 않는데, VPC CNI에서는 파드 IP와 노드 IP가 같은 주소
공간을 공유해서 "노드"만 콕 집어내는 `ipBlock`을 쓸 방법이 없기 때문이다.
AWS의 EKS 문서는 에이전트의 "strict" 모드에서 kubelet 프로브가 자동
예외 처리된다고 하지만, 업스트림에 실제 반례도 등록돼 있다
(`aws/amazon-vpc-cni-k8s#2571`) — 그래서 **실제 클러스터에 이걸 의존하기
전엔 반드시 `/health/live`/`/health/ready`가 여전히 통과하는지 다시
검증**해야 한다. 아래 레시피는 Calico(AWS 자신의 에이전트와는 다른 강제
엔진) 아래에서 정책의 모양이 맞다는 것만 증명한다.

이 단일 Deployment 앱에서 실제로 일을 하는 통제는 아웃바운드 쪽이다: 기본
거부에 DNS(CoreDNS), DB(`networkPolicy.egress.vpcCidr:networkPolicy.egress.dbPort`
— 기본값 `10.0.0.0/16:5432`, `cluster/main.tf`의 `var.vpc_cidr` 기본값과
동일; Terraform을 다른 CIDR로 apply했다면 오버라이드), 그 외 HTTPS(443,
목적지 제한 없음 — S3/AWS API용, S3 VPC 엔드포인트가 없어 CIDR로 좁힐
방법이 없다. ADR 참고)만 명시적으로 허용한다.

### throwaway kind + Calico 클러스터로 검증하기

`kind`의 기본 CNI는 `NetworkPolicy`를 강제하지 않는다 — Calico가 필요하다:

```bash
kind create cluster --name netpol-verify --config - <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  disableDefaultCNI: true
  podSubnet: "192.168.0.0/16"
EOF
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/calico.yaml
# 노드와 calico-node/calico-kube-controllers/coredns가 Ready가 될 때까지 기다린 뒤:
docker build -t sharenpo-netpol-test:local -f Dockerfile .
kind load docker-image sharenpo-netpol-test:local --name netpol-verify
kubectl run postgres --image=postgres:16 --restart=Never \
  --env=POSTGRES_USER=sharenpo --env=POSTGRES_PASSWORD=sharenpo_pw --env=POSTGRES_DB=sharenpo \
  --port=5432 --overrides='{"apiVersion":"v1","metadata":{"labels":{"app":"postgres"}}}'
kubectl expose pod postgres --port=5432 --target-port=5432
kubectl create secret generic test-secrets \
  --from-literal=DB_USERNAME=sharenpo --from-literal=DB_PASSWORD=sharenpo_pw \
  --from-literal=ACCESS_TOKEN_SECRET=<32자 이상, 대소문자+숫자+기호 혼합> \
  --from-literal=REFRESH_TOKEN_SECRET=<32자 이상, 대소문자+숫자+기호 혼합>

helm install netpol-test . \
  --set image.repository=sharenpo-netpol-test --set image.tag=local --set image.pullPolicy=Never \
  --set secrets.existingSecret=test-secrets \
  --set env.DB_HOST=postgres --set env.DB_DATABASE=sharenpo --set env.BASE_URL=http://localhost:3000 \
  --set networkPolicy.enabled=true \
  --set networkPolicy.egress.vpcCidr=$(kubectl get pod postgres -o jsonpath='{.status.podIP}')/32 \
  --wait --timeout=180s
```

이게 성공하면 인바운드 규칙에도 불구하고 kubelet의 프로브가 파드에
도달했다는 뜻이다 — readiness 프로브는 DB 연결까지 확인하므로(ADR 0031),
`--wait` 성공은 DNS+DB 아웃바운드 규칙이 동작하고 migration Job의
pre-install 훅도 끝났다는 것까지 함께 증명한다. 이 제한이 허울뿐이 아니라
실제로 동작하는지 확인하려면:

```bash
# 다른 네임스페이스에서의 인바운드는 막혀야 한다
kubectl create namespace other-ns
kubectl run curl-other -n other-ns --image=curlimages/curl:8.10.1 --restart=Never --rm -i --command -- \
  curl -sS -m 8 http://netpol-test.default.svc.cluster.local:3000/health/live
# 기대 결과: "Connection timed out"

# 이미 허용된 호스트라도 허용 목록에 없는 포트로의 아웃바운드는 막혀야 한다
kubectl run curl-egress --image=curlimages/curl:8.10.1 --restart=Never --rm -i \
  --labels="app.kubernetes.io/name=sharenpo,app.kubernetes.io/instance=netpol-test" --command -- \
  curl -sS -m 8 telnet://$(kubectl get pod postgres -o jsonpath='{.status.podIP}'):9999
# 기대 결과: "Connection timed out"
```

끝나면 정리: `helm uninstall netpol-test && kind delete cluster --name netpol-verify`.

**문제 해결**: 이전 시도가 중간에 끊기거나 실패한 뒤(정리 없이) `helm install`
단계를 다시 실행하면 `release name check failed: cannot reuse a name that is
still in use` 에러가 납니다 — 예전 `netpol-test` 릴리스가 여전히 등록돼 있는
것. 해결: `helm uninstall netpol-test`(상태가 `pending-install`처럼 어정쩡해
보이면 `helm list -A`로 먼저 확인), 제거됐는지 확인한 뒤 `helm install`을
다시 시도.

## Env var

`values.yaml`의 `env:` 블록 아래 모든 키는 `backend/app.module.ts`의 Joi
스키마와 일치해야 합니다 — 어떤 var가 필수이고 어떤 게 선택인지의 근거는
그쪽입니다. `env` 블록의 값들은 ConfigMap으로 들어가고, `DB_USERNAME`/
`DB_PASSWORD`/`ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET`은 대신
`secrets.existingSecret`에서 오며 `values.yaml`에는 반복해서 적지 않습니다.

## 클러스터 없이 검증하기

```bash
helm lint --strict .
helm template . --set secrets.existingSecret=placeholder
```
