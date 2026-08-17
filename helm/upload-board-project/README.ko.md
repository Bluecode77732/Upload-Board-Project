# upload-board-project (Helm 차트)

> English: [README.md](README.md)

이 저장소의 백엔드(`Dockerfile`, Docker Hub의 `bluecode1775/sharenpo`)를
Kubernetes용으로 패키징합니다. 차트가 왜 이런 모양인지는
[ADR 0041](../../docs/ADR/0041-helm-chart-project-adaptation.ko.md)을,
스캐폴딩 이력은 [ADR 0037](../../docs/ADR/0037-helm-chart-scaffold.ko.md)을
참고하세요.

**상태**: 템플릿은 렌더링되고 `helm lint --strict` / `helm template`을 통과합니다.
`helm install`은 살아있는 클러스터에 대해 한 번도 실행된 적이 없습니다 —
아직 클러스터 자체가 없습니다(ROADMAP.md > Stage 4). 템플릿 렌더링 이상은
검증되지 않았다고 보세요.

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

`serviceAccount`, `autoscaling`, `httpRoute` 값은 `values.yaml`에 남아있지만
아직 어떤 템플릿도 소비하지 않습니다 — ADR 0041의 결과 섹션 참고.

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
