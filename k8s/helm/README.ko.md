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
| `ingress.yaml` | Ingress | 기본 비활성(`ingress.enabled: false`) — TLS는 여기서 종료, 앱 내부에서는 안 함(ADR 0034). 경로 규칙은 백엔드 Service에 대해서는 `/` catch-all이 아니라 실제 컨트롤러 prefix의 명시적 allow-list이고, 프론트엔드 Service로 가는 `/` 규칙(`service: frontend`)과 admin Service로 가는 `/admin` 규칙(`service: admin`)이 하나씩 더해진다 — `/health`, `/metrics`, `/doc`은 백엔드 목록에서 의도적으로 빠져 프론트엔드의 `/`로 떨어진다(ADR 0058, ADR 0060, ADR 0062) |
| `serviceaccount.yaml` | ServiceAccount | 기본 비활성(`serviceAccount.create: false` — Deployment는 네임스페이스의 `default` ServiceAccount로 그대로 뜸). S3 IRSA 권한을 네임스페이스의 모든 pod가 아니라 이 앱에만 좁히려면 켠다 — 아래 "IRSA용 전용 ServiceAccount" 참고 |
| `networkpolicy.yaml` | NetworkPolicy | 기본 비활성(`networkPolicy.enabled: false`) — 앱 파드의 인바운드/아웃바운드 트래픽을 제한한다. 아래 "NetworkPolicy" 참고(ADR 0056) |
| `clamav-deployment.yaml` | Deployment | `UploadService`가 업로드를 검사하는 `clamd` 데몬 — 앱 파드마다 하나씩이 아니라 공유되는 단일 replica다(시그니처 DB 중복을 피함, ADR 0059 D6). `ingress`/`networkPolicy`와 달리 항상 렌더링된다 |
| `clamav-service.yaml` | Service | `ClusterIP`, 포트 3310 — `configmap.yaml`이 `values.yaml`의 `env` 맵이 아니라 이 Service 이름에서 `CLAMD_HOST`를 직접 계산한다 |
| `clamav-pvc.yaml` | PersistentVolumeClaim | `clamav.persistence.enabled: true`일 때만 렌더링된다(기본 `false` — 그렇지 않으면 재시작마다 `emptyDir`에 시그니처 DB를 다시 내려받는다) |
| `frontend-deployment.yaml` | Deployment | SPA를 서빙하는 정적 파일 nginx(`frontend/Dockerfile`) — 앱과 별도 파드이며, 백엔드 Service가 절대 고르지 않도록 셀렉터 라벨을 따로 쓴다. 기본 비활성(`frontend.enabled: false`), `values-prod.yaml`이 켠다(ADR 0060) |
| `frontend-service.yaml` | Service | `ClusterIP`, 포트 80. 포트 이름은 `http`가 아니라 `web`이다: `servicemonitor.yaml`이 `sharenpo.labels`를 단 모든 Service에서 `http`라는 이름의 포트를 스크레이프하는데 nginx에는 `/metrics`가 없기 때문이다. Ingress의 `/` 규칙이 가리키는 대상 |
| `admin-deployment.yaml` | Deployment | admin 콘솔을 `/admin/`에서 `alias`로 서빙하는 정적 파일 nginx(`admin/Dockerfile`) — 앱·frontend와 별도 파드이며, 자기만의 셀렉터 라벨을 쓴다. 기본 비활성(`admin.enabled: false`), `values-prod.yaml`이 켠다(ADR 0062) |
| `admin-service.yaml` | Service | `ClusterIP`, 포트 80. `frontend-service.yaml`과 같은 Prometheus 스크레이프 이유로 포트 이름이 `web`이다. Ingress의 `/admin` 규칙이 가리키는 대상 |

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

# clamav egress 규칙(ADR 0059 D6)이 실제로 열려 있어야 한다 — `curl telnet://`이
# 아니라 `nc -zv`를 써야 함(바로 아래 이유 참고)
kubectl run curl-clamav --image=busybox:1.36 --restart=Never --rm -i \
  --labels="app.kubernetes.io/name=sharenpo,app.kubernetes.io/instance=netpol-test" --command -- \
  timeout 5 nc -zv netpol-test-clamav 3310
# 기대 결과: "... 3310 (...) open"
```

**`clamav` 연결 확인에 `curl telnet://host:port`를 쓰지 말 것** — 2026-09-15에
처음 이 방식으로 시도했다가 실제로는 열려 있던 연결을 `curl: (28) Time-out`으로
잘못 보고했고, 나중에 `nc -zv`로 확인해서야 실제로 열려 있었다는 걸 알았다.
`clamd`는 클라이언트가 먼저 말을 걸어야 응답하는 프로토콜이라, curl telnet
모드는 오지 않을 응답을 기다리며 그냥 앉아 있을 뿐이고, 이건 curl 출력만
봐서는 진짜로 막힌 연결과 구분이 안 된다. 이런 raw 프로토콜 포트를 확인할
땐 TCP 핸드셰이크만 보는(프로토콜 가정이 없는) `nc -zv`가 맞는 도구다.

끝나면 정리: `helm uninstall netpol-test && kind delete cluster --name netpol-verify`.

**문제 해결**:
- 이전 시도가 중간에 끊기거나 실패한 뒤(정리 없이) `helm install` 단계를
  다시 실행하면 `release name check failed: cannot reuse a name that is
  still in use` 에러가 납니다 — 예전 `netpol-test` 릴리스가 여전히 등록돼
  있는 것. 해결: `helm uninstall netpol-test`(상태가 `pending-install`처럼
  어정쩡해 보이면 `helm list -A`로 먼저 확인), 제거됐는지 확인한 뒤
  `helm install`을 다시 시도.
- Git Bash(Windows)에서는 `$(kubectl get pod ... -o
  jsonpath='{.status.podIP}')`를 `--set ...=$(...)/32` 인자 안에 바로 넣지
  말 것. pod가 아직 IP를 못 받았으면 이 치환이 조용히 빈 문자열이 되고,
  앞의 `/32`가 MSYS2의 경로 변환에 걸려 `C:/Program Files/Git/32` 같은
  값으로 둔갑해 쿠버네티스 CIDR 검증에서 알아보기 힘든 에러를 냅니다.
  변수에 먼저 담아 출력해서 확인할 것:
  `PG_IP=$(kubectl get pod postgres -o jsonpath='{.status.podIP}'); echo
  "PG_IP=$PG_IP"` — 진짜 IP인지 눈으로 확인한 뒤에 사용.

## HTTPS(Ingress) 활성화

TLS는 ingress/ALB에서만 종료하고 앱 프로세스 안에서는 하지 않는다([ADR
0034](../../docs/ADR/0034-https-termination-stance.ko.md)). `values.yaml`의
`ingress` 블록은 `/` catch-all이 아니라 실제 컨트롤러 prefix의 명시적
allow-list다([ADR 0058](../../docs/ADR/0058-ingress-path-allowlist.ko.md)). 다만 프론트엔드 Service로 가는 `/` 규칙([ADR 0060](../../docs/ADR/0060-frontend-same-alb-path-routing.ko.md))과 admin Service로 가는 `/admin` 규칙([ADR 0062](../../docs/ADR/0062-admin-same-alb-subpath-routing.ko.md)) 두 개는 예외다.
`ingress.enabled`는 계속 `false`다 — 이건 뭔가 빠져서가 아니라 개발자가 확정한
의도적 결정이다([ROADMAP.md](../../docs/ROADMAP.md) > Unscheduled): 스택이
실제로 떠 있던 2026-08-27 당시엔 클러스터·도메인(`sharenpo.cloud`)·실제 ACM
인증서까지 전부 준비돼 있었지만, 외부 테스터가 실제로 필요해질 때까지는 켜지
않기로 했다. 2026-09-13에 다시 확인했고 그대로다.

켜기 전 필요한 선행 조건 두 가지, 지금은 둘 다 미충족이다(Terraform 3-state
전부 destroy 상태):
- `addons/` apply — AWS Load Balancer Controller가 클러스터 안에 떠 있어야
  `Ingress` 객체를 처리할 수 있다.
- `app-infra/` apply — `domain_name`의 ACM 인증서가 `ISSUED` 상태여야 한다
  (`terraform output -raw acm_certificate_arn`).

`values-prod.yaml`엔 실제 도메인, ADR 0058의 경로 목록 전체(Helm은 `-f` 레이어
사이에 배열을 병합하지 않으므로 그대로 재선언), 그리고 HTTP→HTTPS 강제
리다이렉트용 `certificate-arn`/`listen-ports`/`ssl-redirect` annotation까지
전부 주석 처리된 `ingress:` 블록이 이미 준비돼 있다. 위 두 상태가 갖춰지면 그
주석을 해제하고 ARN을 채운 뒤 `enabled: true`로 바꾸면 된다 — 그 시점엔
`--set` 플래그가 따로 필요 없다. 체크인된 파일을 건드리지 않고 한 번만
켜보려면 `k8s/infra/terraform/README.md`의 "Enabling the ALB ingress"
절에 같은 내용의 `helm upgrade --set ...` 형태가 있다.

실제 클러스터 없이 검증하기(지금은 아무 클러스터도 없다):

```bash
helm lint --strict . --set secrets.existingSecret=placeholder --set ingress.enabled=true \
  --set ingress.className=alb --set frontend.enabled=true --set admin.enabled=true \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=arn:aws:acm:ap-northeast-2:074416822640:certificate/placeholder \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"=ip \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"sharenpo.cloud","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"},{"path":"/","pathType":"Prefix","service":"frontend"},{"path":"/admin","pathType":"Prefix","service":"admin"}]}]'
helm template . --set secrets.existingSecret=placeholder --set ingress.enabled=true \
  --set ingress.className=alb --set frontend.enabled=true --set admin.enabled=true \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"=arn:aws:acm:ap-northeast-2:074416822640:certificate/placeholder \
  --set ingress.annotations."alb\.ingress\.kubernetes\.io/target-type"=ip \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}\, {"HTTPS": 443}]' \
  --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443 \
  --set-json 'ingress.hosts=[{"host":"sharenpo.cloud","paths":[{"path":"/auth","pathType":"Prefix"},{"path":"/user","pathType":"Prefix"},{"path":"/post","pathType":"Prefix"},{"path":"/comment","pathType":"Prefix"},{"path":"/file","pathType":"Prefix"},{"path":"/upload","pathType":"Prefix"},{"path":"/audit-log","pathType":"Prefix"},{"path":"/","pathType":"Prefix","service":"frontend"},{"path":"/admin","pathType":"Prefix","service":"admin"}]}]' \
  -s templates/ingress.yaml
```

같은 플래그가 `networkpolicy.yaml`의 ALB 인바운드 허용 규칙(ADR 0056 addendum)도 함께
렌더링한다 — `--set networkPolicy.enabled=true -s templates/networkpolicy.yaml`을 더하면
두 규칙(`podSelector: {}`와 새 `ipBlock`)을 한 번에 볼 수 있다.

렌더링된 `Ingress`에 `ingressClassName: alb`, 호스트, allow-list의 일곱 백엔드 경로와 프론트엔드 `/` 규칙(2026-09-21),
admin `/admin` 규칙(2026-09-23),
annotation이 전부 의도대로 나오는지 확인한다(2026-09-13 검증 — 이 레시피의 이전 초안은
`--set ingress.hosts[0].host=...`를 썼는데, 이건 배열 원소 전체를 교체해버려 경로가 다
사라진다; `--set-json`이라야 실제로 유지된다 — `k8s/infra/terraform/README.md`의 "ALB
ingress 켜기" 절에서도 같은 문제를 발견해 같은 방식으로 고쳤다) — 지금 이 저장소가
검증할 수 있는 최대치다. 실제 ALB Controller가 떠 있는 클러스터에 대한 진짜 `helm
install --wait` 검증은 Terraform을 다시 apply하기 전까지는 범위 밖이다.

**미해결 — 실전 신뢰 전 필수, 지금은 검증할 살아있는 ALB Controller가 없어서 아직 안 함:**
YAML이 올바르게 렌더링되는 것과 ALB가 실제로 그 설정대로 동작하는 것은 별개다.
`addons/`+`app-infra/`를 다시 apply하고 `ingress.enabled`를 실제로 켜고 도메인이 ALB를 가리키게 한 뒤엔, annotation이
먹혔다고 가정하지 말고 다음을 직접 확인한다:
- `aws elbv2 describe-listeners`로 만들어진 ALB에 80번과 443번 리스너가 둘 다 있는지
  (`listen-ports`가 렌더링만 된 게 아니라 실제로 적용됐는지).
- `curl -I http://<도메인>`이 `https://` URL로 `301`/`302`를 반환하는지(`ssl-redirect`가
  실제로 동작하는지).
- 브라우저가 ACM 인증서가 발급된 그 도메인에 대해 경고 없이 인증서를 신뢰하는지
  (`certificate-arn` annotation이 실제로 올바른 인증서를 붙였는지).
- 토큰 없는 `curl https://<도메인>/file`이 HTML이 아니라 API의 401 JSON을 돌려주고,
  `/files`·`/posts/1`·존재하지 않는 경로는 SPA의 HTML을 돌려주는지 — 프론트엔드 `/` 규칙이
  실제로 API prefix들 아래에 놓이는지(ADR 0060, 컨트롤러의 Exact 다음 긴 Prefix 순서는
  라이브에서 확인된 적이 없다). `/health/live`·`/metrics`·`/doc`도 SPA의 HTML(또는 404)이
  나와야 하고 백엔드 응답이 나오면 안 된다.
- `curl https://<도메인>/admin/`이 프론트엔드도 404도 아닌 admin 콘솔 자신의 HTML을
  돌려주는지 — `/admin`이 규칙 집합에 실제로 있는지, 그리고 Exact 다음 긴 Prefix 순서에서
  더 짧은 규칙에 먼저 먹히지 않는지 확인한다(ADR 0062, 이것도 라이브에서 확인된 적 없다).
  슬래시 없는 `curl -I https://<도메인>/admin`은 ALB가 아니라 nginx 자신의 `301`로
  `/admin/`에 리다이렉트되는지 확인한다 — 요청이 실제로 admin 파드까지 도달했는지(중간에서
  재작성되거나 버려지지 않았는지) 확인하는 것이다.
- 타깃 그룹에 healthy 타깃이 등록되는지. `values-prod.yaml`의 주석 처리된 annotation
  블록에 이제 `alb.ingress.kubernetes.io/target-type: ip`가 들어 있다(2026-09-22 추가 —
  컨트롤러 기본값 `instance`는 `NodePort`/`LoadBalancer` Service가 필요한데 이 차트의
  Service는 둘 다 `ClusterIP`다). 다만 이건 렌더링되는 annotation만 고친 것이고, 실제
  ALB가 파드를 healthy로 등록하는지는 별개로 확인해야 한다.
- `networkPolicy.enabled: true`(`values-prod.yaml`이 설정하는 값)와 Ingress가 함께 켜지면
  `networkpolicy.yaml`이 VPC CIDR을 앱 포트에 허용하는 인바운드 규칙을 하나 더
  렌더링한다(ADR 0056 addendum, 위 `target-type` 수정과 같은 시점에 추가 — ALB의 ENI는
  파드가 아니라서 기존의 같은-네임스페이스 전용 규칙으로는 애초에 통과할 수 없었다).
  위 항목과 같은 방식으로 ALB 타깃 그룹이 healthy인지 확인하고, ADR 0056 D2가 이미
  남긴 단서대로 이게 실제로 AWS 자신의 VPC CNI Network Policy 에이전트로 강제되는지(단순
  렌더링이 아니라)도 확인한다 — `kind`+Calico로는 실제 VPC CIDR을 흉내 낼 수 없어서, 이
  규칙은 `helm template` 이상으로 검증할 방법이 없다.
- 실제 HTTPS 연결로 로그인한 뒤 페이지를 새로고침해도 세션이 유지되는지. refresh 쿠키가
  `HttpOnly; Secure; SameSite=Strict; Path=/auth/token`으로 내려오고 `POST /auth/token/refresh`에
  다시 실려 가야 한다 — `Secure` 쿠키는 브라우저 연결이 HTTPS일 때만 동작하므로 다른 곳에서는
  볼 수 없다(ADR 0012, ADR 0034).
- `STORAGE_DRIVER=s3`(`values-prod.yaml`이 설정하는 값)에서 비공개 파일의 미리보기(Blob
  `fetch()` → API의 302 → presigned S3 URL)와 공개/unlisted 파일의 `<img>`/`<video>`가 모두
  브라우저 콘솔에 CSP·CORS 에러 없이 로드되는지. 버킷에 운영 origin에 대한 CORS 규칙이
  있어야 한다. `app-infra/main.tf`에 이제 그 리소스가 있다
  (`aws_s3_bucket_cors_configuration.app`, 2026-09-22 추가, ADR 0036 addendum) — 코드는
  완성됐지만 아직 apply하지 않았고, apply하면 지금 버킷에 있는 규칙(2026-08-16에 손으로
  돌린 스크립트의 localhost 개발 origin 두 개뿐, 운영 origin 없음)을 운영 origin 하나로
  **교체**한다. apply 이후에도 실제 버킷을 상대로 한 로컬 `STORAGE_DRIVER=s3` 테스트가
  필요하면 개발 origin을 다시 손으로 넣어야 한다. 별개로 `frontend/nginx.conf`의 CSP가
  `https://*.amazonaws.com`을 허용해야 한다(ADR 0060 — 브라우저로 확인하기 전까지는 CSP
  의미론에서 추정한 값이다).
- 실제 클라이언트 IP가 rate limiter에 도달하는지(`trust proxy` = `10.0.0.0/16`, ADR 0054
  addendum): 한 클라이언트에서 1분 안에 `POST /auth/signin`을 여섯 번째로 호출하면 429가 나오고,
  다른 IP의 두 번째 클라이언트는 전혀 제한되지 않아야 한다. 모든 방문자가 하나의 버킷을
  공유한다면 앱이 보는 peer가 그 CIDR 안에 있지 않다는 뜻이다.
- 롤아웃과 스크레이프: 세 Deployment 모두 `kubectl rollout status`가 성공하고, 프론트엔드와
  admin Service 각각에는 ready 엔드포인트가 있으며 백엔드 Service에는 그 파드들이 하나도
  없고, Prometheus에는 백엔드 타깃만 있고 프론트엔드·admin 타깃은 없어야 한다(`web` 포트
  이름, ADR 0060, ADR 0062).
- 파드가 EKS에서 곧바로 종료된다(ADR 0061). `values-prod.yaml`로(따라서 `STORAGE_DRIVER=s3`)
  `kubectl rollout restart deployment/<release>`를 실행하고 `kubectl get pods -w`를
  지켜본다: 이전 백엔드 파드는 1~2초 안에 `Terminating`을 벗어나야 한다. 30초를 꽉 채우고
  나가는 파드(차트가 `terminationGracePeriodSeconds`를 설정하지 않으므로 기본값이
  적용된다)는 SIGKILL을 맞은 것이다 — `useProcessExit: true`가 있는데도 프로세스가 끝나지
  못했다는 뜻이니, 종료 훅에 도달하지 못하는 종료 경로를 찾아야 한다. 측정은 로컬 `kind`
  클러스터에서만 했다: 0.4초, 타이머를 남겨 둔 경우 옵션이 없으면 30.6초였다. `S3Client`
  자체는 이미 닫힌 질문이다 — 그 기본 `keepAlive` request agent를 대신한 Docker 전용 시험
  (같은 핸들 모양, ADR 0061 두 번째 Addendum)이 소켓을 일부러 열어 둔 채로도 똑같이 빨리
  종료했다 — 그러니 이 점검은 그 핸들이 아니라 실제 파드에만 있는 다른 무언가가 있는지를
  보는 것에 가깝다.
- 롤링 업데이트 중 ALB 오류가 없다(ADR 0061) — 실패할 가능성이 가장 높은 항목이다. 수정 전에는
  파드가 SIGTERM을 무시하고 SIGKILL까지 계속 돌았는데, 이것이 (추론일 뿐 측정한 것은 아니지만)
  우연히 ALB의 등록 해제 지연보다 길었을 것이다. 이제는 1초 안에 종료하므로, SIGTERM 이후 대상이
  드레인되기 전에 ALB가 그 파드로 보낸 요청이 거절될 수 있다.
  `kubectl rollout restart deployment/<release>`가 도는 동안 바깥에서 허용 목록에 있는 경로로
  초당 한 건쯤 요청을 보내고 — `curl -s -o /dev/null -w '%{http_code}\n'
  https://<domain>/file`은 토큰이 없으면 401이다 — `502`/`503`/`504`를 센다. `401`과 `429`는
  백엔드가 답한 것이다(429는 자체 rate limit이므로 분당 100건 미만을 유지한다). 통과 기준: 셋 다
  없음. 나타나면 앱 컨테이너에 `preStop` sleep을 두고 `terminationGracePeriodSeconds`를 적어도
  그만큼 늘린다. 그 *메커니즘* 자체는 일회용 `kind` Deployment에서 검증했다(차트에는 커밋하지
  않음, ADR 0061 두 번째 Addendum): 유예가 sleep을 다 덮으면 파드가 예상대로 5.7초 만에
  사라졌고, 유예를 일부러 sleep보다 짧게 두어도 kubelet은 막힌 hook을 포기하는 순간 여전히
  SIGTERM을 보냈고 앱은 깔끔하게 종료했다 — 다만 파드가 유예 시간 전체(36.4초)를 다 썼을
  뿐이다. 그러니 여기서 유예가 부족하면 앱이 그대로 SIGKILL당하는 게 아니라 롤아웃 시간이
  드는 것이다 — 적어도 이 `kind`/containerd 버전에서는 그렇다; EKS에서는 확인하지 않았다.
  이 중 무엇도 sleep을 얼마로 둬야 하는지는 말해 주지 않는다 — 그건 아직 측정하지 못한 실제
  ALB의 드레인 지연 숫자가 있어야 정할 수 있으므로, 차트에는 둘 다 지금 없고 여전히 정하지
  않았다.

이 중 어느 것도 `helm lint`/`helm template`로는 확인할 수 없다 — 이 둘은 이 저장소가
렌더링하는 YAML이 올바르다는 것만 증명할 뿐, AWS Load Balancer Controller가 그 설정대로
실제로 동작한다는 것은 증명하지 못한다.

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

프론트엔드 워크로드(ADR 0060)는 `--set frontend.enabled=true`를 줘야만 렌더링되고, Ingress의
`/` 규칙도 그때만 나타난다:

```bash
helm template . --set secrets.existingSecret=placeholder --set frontend.enabled=true \
  --set ingress.enabled=true \
  -s templates/ingress.yaml -s templates/frontend-deployment.yaml -s templates/frontend-service.yaml
```

이미지도 클러스터 없이 검증할 수 있다 — 빌드해서 SPA fallback과 헤더를 확인한다:

```bash
docker build -t sharenpo-frontend:local -f ../../frontend/Dockerfile ../../frontend
docker run --rm -p 8080:8080 sharenpo-frontend:local
# /, /posts/1 → 200 index.html;  /assets/missing.js → 404;  모든 응답에 CSP + nosniff 헤더
```

admin 워크로드(ADR 0062)도 `--set admin.enabled=true`를 줘야만 렌더링되고, Ingress의
`/admin` 규칙도 그때만 나타난다:

```bash
helm template . --set secrets.existingSecret=placeholder --set admin.enabled=true \
  --set ingress.enabled=true \
  -s templates/ingress.yaml -s templates/admin-deployment.yaml -s templates/admin-service.yaml
```

이미지도 마찬가지다 — `/admin/`에서 서빙되므로(`root`가 아니라 `alias`, ADR 0062 D5)
확인 대상 경로가 루트가 아니라 그 prefix 아래다:

```bash
docker build -t sharenpo-admin:local -f ../../admin/Dockerfile ../../admin
docker run --rm -p 8080:8080 sharenpo-admin:local
# /admin(슬래시 없음) → /admin/로 301;  /admin/, /admin/dashboard → 200 index.html;
# /admin/assets/missing.js → 404;  /(admin 밖) → 404;  모든 응답에 CSP + nosniff 헤더
```
