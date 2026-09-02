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
확인된 뒤 추가 — ROADMAP.md §9 참고):

```bash
helm upgrade upload-board . -f values-prod.yaml
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

`values.yaml`엔 실제로 템플릿이 읽는 키만 남아 있습니다 — 어떤 템플릿도 소비하지
않던 `autoscaling`/`httpRoute`/`nameOverride`/`fullnameOverride` 스캐폴딩
잔재는 제거했습니다. `serviceAccount`도 원래 같은 목록에서 제거됐었지만,
구체적인 필요가 생기면서(아래 참고) `ingress.yaml`과 같은 기본-비활성 패턴으로
자기 템플릿을 다시 갖게 됐습니다. HPA나 Gateway API `HTTPRoute`를 나중에
추가하려면 여전히 새 템플릿과 `values.yaml` 블록을 함께 다시 넣어야지, 값만
되살려선 안 됩니다.

## IRSA용 전용 ServiceAccount

`app-infra/`의 `aws_iam_role.app` IRSA 역할(`STORAGE_DRIVER=s3`일 때 S3 접근)은
현재 `system:serviceaccount:default:default`를 신뢰합니다 —
`k8s/infra/terraform/README.md` "Known gap" 절의 수동
`kubectl annotate serviceaccount default ...` 단계는 이 역할을 이 앱뿐 아니라
**네임스페이스의 모든 pod**에 부여합니다. `serviceAccount.create: true`로
켜면 이 차트가 자체 `ServiceAccount`를 만들어 Deployment에 `default` 대신
그것을 붙입니다:

```bash
helm upgrade sharenpo . \
  --reuse-values \
  --set serviceAccount.create=true \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform -chdir=../infra/terraform/app-infra output -raw app_iam_role_arn)
```

이건 이 gap의 차트 쪽 절반만 닫습니다. `aws_iam_role.app`의 trust policy는
Terraform(`app-infra/`) 쪽에 여전히 `default:default`로 하드코딩돼 있습니다 —
그 trust policy를 새 ServiceAccount 이름(기본값은 릴리스 이름, 예: `sharenpo`
— `values.yaml`의 `serviceAccount.name` 참고)에 맞춰 같이 갱신하지 않으면
`serviceAccount.create`만 켜서는 IRSA가 인증되지 않습니다. trust policy
갱신은 Terraform 쪽 작업이라 이번 차트 변경 범위 밖입니다 — 그게 landing되기
전까지는 계속 수동 `default` annotate를 쓰거나, `serviceAccount.name`을
`default`로 두고 `serviceAccount.create`는 켜지 않으면 됩니다(차트 기본
동작과 동일한 no-op). migration Job은 `serviceAccount.create`가 켜져 있어도
일부러 계속 `default`로 돕니다 — DB 자격증명만 Secret에서 읽을 뿐 S3를
건드리지 않으므로, 앱의 IRSA 신원을 붙이면 이유 없이 권한만 넓어집니다.

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
