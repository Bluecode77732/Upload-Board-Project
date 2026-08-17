# upload-board-project (Helm 차트)

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
순서, 빈 문자열 env var — 커밋 `0326199`). **여전히 미검증**: 실제 대상
클러스터(AWS/EKS) — 아직 거기엔 아무것도 배포된 적이 없습니다(ROADMAP.md >
Stage 4). `kind` 실행은 차트 자체의 배관이 동작한다는 것만 증명하지, 대상
인프라가 존재한다는 뜻은 아닙니다.

## 설치 전: Secret 먼저 만들기

이 차트는 `Secret` 리소스를 직접 만들지 않고, 비밀값을 `values.yaml`
리터럴로도 받지 않습니다(ADR 0041, ADR 0033의 목표 형태). 먼저 직접
만들어야 합니다:

```bash
kubectl create secret generic upload-board-secrets \
  --from-literal=DB_USERNAME=<db-username> \
  --from-literal=DB_PASSWORD=<db-password> \
  --from-literal=ACCESS_TOKEN_SECRET=<random-string> \
  --from-literal=REFRESH_TOKEN_SECRET=<random-string>
```

값을 나중에 갱신하려면 `--dry-run=client -o yaml | kubectl apply -f -`로 다시
실행하세요.

그다음 차트가 그 이름을 참조하도록 지정합니다:

```bash
helm install upload-board . \
  --set secrets.existingSecret=upload-board-secrets \
  --set env.DB_HOST=<postgres-host> \
  --set env.DB_DATABASE=<postgres-db> \
  --set env.BASE_URL=https://<your-host>
```

`secrets.existingSecret`은 `required`로 지정돼 있어, 설정하지 않으면 pod가
env var 누락으로 crash-loop에 빠지는 대신 설치 자체가 명확한 에러로 즉시
실패합니다.

## 각 템플릿이 하는 일

| 템플릿 | 종류 | 비고 |
|---|---|---|
| `deployment.yml` | Deployment | 이미지, 포트 3000, `/health/live`+`/health/ready` probe(ADR 0031), non-root `securityContext`(ADR 0030) |
| `service.yaml` | Service | `ClusterIP`, 포트 3000 |
| `configmap.yaml` | ConfigMap | `values.yaml`의 `env:` 블록 아래 모든 키 |
| `migration-job.yml` | Job (Helm hook) | pre-install/pre-upgrade 시점에 `migration:run` 실행, `docker-compose.yml`의 `migrate` 서비스를 본뜸(ADR 0032) |
| `ingress.yaml` | Ingress | 기본 비활성(`ingress.enabled: false`) — TLS는 여기서 종료, 앱 내부에서는 안 함(ADR 0034) |

`values.yaml`엔 실제로 템플릿이 읽는 키만 남아 있습니다 — 어떤 템플릿도 소비하지
않던 `serviceAccount`/`autoscaling`/`httpRoute`/`nameOverride`/`fullnameOverride`
스캐폴딩 잔재는 제거했습니다. 나중에 ServiceAccount·HPA·Gateway API
`HTTPRoute`를 추가하려면 새 템플릿과 `values.yaml` 블록을 함께 다시 넣어야지,
값만 되살려선 안 됩니다.

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
