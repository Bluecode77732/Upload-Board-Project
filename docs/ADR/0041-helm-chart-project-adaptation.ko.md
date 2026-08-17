# ADR 0041: Helm 차트 프로젝트 적응 — ADR 0037의 유예 해제

- 상태: 승인됨
- 날짜: 2026-08-17
- 수정 대상: [ADR 0037](0037-helm-chart-scaffold.ko.md) ("적응 작업을 미룬다"는
  결정만 해제한다 — ADR 0037의 나머지 두 결정("스캐폴딩 랜딩 사실을 기록",
  "배포 가능하다고 서술하지 않는다")은 여전히 유효하고 바뀌지 않는다)
- 관련: [ADR 0029](0029-storage-port-adapter.ko.md)(이 ADR의 `replicaCount`
  기본값이 대응하는 `STORAGE_DRIVER=local` + 다중 replica 문제),
  [ADR 0030](0030-container-non-root-and-arch-stance.ko.md)(non-root uid 1001),
  [ADR 0031](0031-health-and-readiness-endpoints.ko.md)(liveness/readiness
  라우트), [ADR 0032](0032-migration-as-separate-deploy-step.ko.md)(이 차트의
  migration Job 템플릿이 본뜨는 대상), [ADR 0033](0033-secrets-delivery-target.ko.md)(이
  차트가 구현하는 `Secret`/`envFrom` 목표), [ADR 0034](0034-https-termination-stance.ko.md)(Ingress를
  기본 비활성으로 두는 이유)
- English: [0041-helm-chart-project-adaptation.md](0041-helm-chart-project-adaptation.md)

## 배경

ADR 0037은 Helm 차트를 `helm create`의 미수정 스캐폴딩으로 기록하고, "진짜" 차트가
맞게 작성됐는지 검증할 살아있는 Kubernetes 클러스터도 AWS 계정도 아직 없다는
이유로 적응 작업을 의도적으로 미뤘다.

그 이후 두 가지가 바뀌었다.

1. **ADR 0037이 `k8s/`에 대해 세운 전제 자체가 틀렸다는 게 드러났다.** ADR 0037은
   `k8s/`에 이미 손으로 쓴 프로젝트 전용 매니페스트(Service, 두 번째 Deployment,
   rolling-update 전략)가 있고 그게 아직 Helm으로 템플릿화만 안 됐다고 적었다.
   그런데 이 다섯 파일을 직접 열어보니 전부 Helm 차트와 같은 부류의 미수정
   `nginx`/`nginx-app` placeholder 예제였다 — 템플릿화할 실제 원본이 아니었다.
   이 문제는 이 ADR보다 앞서, 별도로 커밋 `48a89f2`에서 바로잡혔다:
   `k8s/pod/pod.yml`, `k8s/deployment/deployment.yml`,
   `k8s/deployment/rolling_update.yml`, `k8s/cluster/deployment.yml`,
   `k8s/cluster/cluster_IP.yml`은 이제 이 프로젝트 고유의 `app: upload-board-api`
   라벨, `bluecode1775/sharenpo:latest` 이미지, 그리고 `Dockerfile`의
   `EXPOSE 3000`과 맞춘 컨테이너 포트 3000을 쓴다.
2. **`helm lint --strict`와 `helm template`은 살아있는 클러스터가 필요 없다.**
   필수 값 누락, 잘못된 `Secret`/`ConfigMap` 참조, 깨진 Go 템플릿 문법 같은
   실제 오류 클래스를 `helm install`이 실제 API 서버에 대해 한 번도 실행되지
   않아도 잡아낼 수 있다. ADR 0037이 내건 차단 조건("진짜 차트가 맞는지 검증할
   대상 자체가 없다")은 마지막 단계인 `helm install`에만 해당하지, 템플릿을
   작성하고 lint로 점검하는 단계에는 해당하지 않는다.

## 결정

- **ADR 0037의 유예를 해제한다.** `helm/upload-board-project/`의 프로젝트 전용
  적응 작업을 지금 진행하되, `helm lint --strict`와 `helm template`으로만
  검증한다. 살아있는 클러스터에 대한 `helm install` 검증은 여전히 안 된 상태로
  남는다 — 이 ADR은 ADR 0037의 차단 조건을 좁힐 뿐 완전히 없애지는 않는다.
- **`k8s/`는 템플릿 원본이 아니다.** ADR 0037의 전제와 달리 `k8s/`는 `templates/`로
  옮겨올 만한 실제 매니페스트를 가진 적이 없었다. 대신 이 차트는 이 프로젝트의
  진짜 소스 오브 트루스에서 유도한다: `Dockerfile`(이미지 계약 — 포트 3000,
  non-root uid 1001, `/health/live` `HEALTHCHECK`), `docker-compose.yml`(한
  번만 도는 `migrate` 서비스 형태, env 연결), 그리고 `app.module.ts`의 Joi
  스키마(전체 env var 목록과 필수/선택 여부).
- **이번 작업에서 추가되는 차트 내용:**
  - `Chart.yaml` — `helm create` boilerplate를 실제 name/description/version으로
    교체.
  - `Deployment` — 이미지 `bluecode1775/sharenpo`, `containerPort: 3000`,
    liveness probe는 `/health/live`, readiness probe는 `/health/ready`(ADR 0031),
    `securityContext.runAsUser: 1001`로 Dockerfile의 non-root 유저와 일치(ADR 0030).
  - `Service` — `ClusterIP`, 포트 3000.
  - `ConfigMap` — 비밀이 아닌 env var(`ENV`, `BASE_URL`, `CORS_ORIGIN`,
    `TEMP_SWEEP_*`, `STORAGE_DRIVER`, `AWS_REGION`,
    `CONTENT_SIGNED_URL_TTL_SECONDS` 등).
  - `Secret` 소비는 `existingSecret` 참조 방식만 지원 — 차트는 `Secret` 리소스를
    직접 만들지 않고, `values.yaml`에 비밀값을 리터럴로도 받지 않는다. 운영자가
    `helm install`/`upgrade` 전에 별도로(`kubectl create secret generic ...`)
    `Secret`을 만들어두면, 차트는 그 이름을 `envFrom.secretRef.name`으로 연결한다.
    이건 ADR 0033이 이미 목표로 명시한 형태(`envFrom: secretRef`) 그 자체이며,
    ADR 0033이 더 뒤로 미룬 ESO/AWS Secrets Manager 계층까지 만드는 건 아니다.
  - `docker-compose.yml`의 한 번만 도는 `migrate` 서비스(ADR 0032)를 본뜬 migration
    `Job` 템플릿 — 그 ADR이 "K8s Job 🆕"으로 남겨뒀던 부분에 대한 이 차트의 답.
  - `Ingress` 템플릿은 유지하되 **기본값은 비활성**(`ingress.enabled: false`).
    실제로 켜려면 살아있는 클러스터, DNS 이름, 인증서 메커니즘(ACM 또는
    cert-manager)이 필요한데 아직 어느 것도 없다(ADR 0034 그대로 유지).
- **`replicaCount` 기본값을 3에서 1로 낮춘다.** 차트의 기본 `STORAGE_DRIVER`는
  `local`이라, 각 pod의 `file/temp`/`file/upload`는 그 pod만의 임시 디스크다 —
  한 replica로 업로드한 파일이 다른 replica에서는 안 보인다. 이건 ADR 0029가
  스토리지 계층에 대해 이미 기록한 것과 같은 다중 인스턴스 문제이며, 차트
  기본값을 3으로 그대로 두면 스토리지 ADR을 먼저 읽지 않고 `helm install`을
  실행하는 사람에게 이 문제를 조용히 재현시키게 된다. `values.yaml`에는
  `STORAGE_DRIVER=s3`로 전환한 뒤에만 `replicaCount`를 올려도 안전하다는 주석을
  남긴다.
- **`httpRoute`(Gateway API) 스캐폴딩 블록은 손대지 않고 비활성 그대로 둔다.**
  이걸 쓸 Istio는 아직 ADR이 없고 Terraform 이후로 명시적으로 계획돼 있다
  (ROADMAP.md) — 이번 작업에서 관련해 바뀌는 건 없다.

## 기각한 대안

- **지금 바로 살아있는 클러스터까지 검증된 차트를 작성한다**(즉 실제 클러스터에
  `helm install`까지 실행) — ADR 0037과 같은 이유로 기각: 설치해볼 AWS 계정이나
  클러스터가 없고, ADR 0033의 ESO/IRSA 연결도 아직 설계 단계다. 이 ADR은
  ADR 0037의 차단 조건을 좁힐 뿐, 완전히 없애지는 않는다.
- **차트가 직접 `Secret` 리소스를 만들게 한다**, 값은 `--set`이나 커밋되지 않는
  `values-secret.yaml`로 주입 — 기각. 커밋되지 않도록 의도된 값이라도 비밀값을
  리터럴로 담을 수 있는 코드 경로가 존재하는 한, 실수로 `git add -A`를 한 번만
  해도 자격증명이 유출될 위험이 있다(Never Do Group 3). `existingSecret` 전용
  방식은 비밀 자료가 차트나 그 어떤 values 파일에도 전혀 남지 않으며, ADR 0033의
  목표 형태에도 차트 소유 `Secret`보다 더 literal하게 부합한다.
- **살아있는 클러스터가 생길 때까지 유예를 그대로 유지한다** — 기각.
  `helm lint --strict`/`helm template`은 클러스터 없이도 실질적인(부분적이지만)
  검증을 제공한다. 이 시점을 넘어서까지 계속 미루는 건 추가적인 안전을 얻는 게
  아니라, 차트가 아예 렌더링조차 안 되는 기간만 늘릴 뿐이다.

## 결과

- ROADMAP.md의 Stage 4 컴포넌트 상태표: Helm 행의 상태 기호는 🔶로 유지된다(실제
  클러스터에 대한 `helm install` 검증은 여전히 안 됐으므로), 다만 설명 문구는
  "스캐폴딩만"에서 "프로젝트 적응 완료, 살아있는 클러스터 검증은 미완료"로
  옮겨가야 한다 — 이 ADR과 함께 진행할 후속 문서 갱신으로 추적하며, 이 diff에는
  아직 반영하지 않는다.
- 같은 표의 Kubernetes 행("k8s/에 기본 매니페스트가 랜딩됨")은 이 ADR의 배경이
  의존하는 독립적인 `k8s/` 수정(커밋 `48a89f2`)의 부수 효과로, 이제 처음으로
  문자 그대로 정확해졌다 — 이 행의 문구도 예전의 부정확한 설명을 그만 인용하도록
  후속 정리가 필요하다.
- AWS Secrets Manager / External Secrets Operator / IRSA 연결은 ADR 0033이 남겨둔
  자리 그대로다 — Terraform 작업으로 계속 미뤄진다. 이 ADR은 그 경계를 건드리지
  않는다.
- `Ingress`는 기본값 비활성 그대로다. 실제 배포에서 켜려면 여전히 살아있는
  클러스터, DNS, 인증서 메커니즘이 필요하다 — ADR 0034에서 바뀌는 것 없음.
- 스키마·엔티티·API 표면 변경 없음. `helm/`(그리고 이미 별도로 처리된 `k8s/`
  수정) 밖의 코드는 이 ADR에서 건드리지 않는다.
