# ADR 0042: `k8s/`와 `helm/` 통합 — 둘이 아니라 하나의 Kubernetes 디렉터리로

- 상태: 승인됨
- 날짜: 2026-08-17
- 관련: [ADR 0037](0037-helm-chart-scaffold.ko.md)(Helm 차트의 원래 위치였던
  `helm/upload-board-project/`가 여기로 옮겨간다 — 0037의 배경 서술은 그대로
  둔다, 2026-08-11 시점 상황을 기록한 것이므로), [ADR 0041](0041-helm-chart-project-adaptation.ko.md)(이
  ADR이 옮기는 대상 차트; 경로 인용은 링크가 깨지지 않도록 갱신하되 결정
  내용 자체는 손대지 않는다)
- English: [0042-k8s-helm-directory-consolidation.md](0042-k8s-helm-directory-consolidation.md)

## 배경

저장소에는 Kubernetes 관련 콘텐츠를 담은 최상위 형제 디렉터리가 두 개
있었다: `k8s/`(raw 매니페스트 — `pod/pod.yml`, `deployment/deployment.yml`,
`deployment/rolling_update.yml`, `cluster/deployment.yml`,
`cluster/cluster_IP.yml`)와 `helm/upload-board-project/`(ADR 0041이
프로젝트 전용으로 적응시킨 Helm 차트).

ROADMAP.md의 Stage 4 설명은 Helm의 역할을 "**`k8s/` 매니페스트 위에서**
릴리스 패키징/템플릿화"라고 적어, `k8s/`가 `helm/` 템플릿의 원본이어야
한다는 걸 암시했다. 그런데 ADR 0041 자체의 배경 서술이 이미 그 관계가
실제로는 존재한 적이 없었다는 걸 밝혔다: 차트의 템플릿은 `k8s/`가 아니라
`Dockerfile`/`docker-compose.yml`/Joi env 스키마에서 유도됐다. `k8s/`의
다섯 파일이 실제로 무슨 역할을 하는지 확인해보니, 이쪽도 어디에도 연결돼
있지 않았다 — 어떤 CI 잡도 이걸 적용하지 않고, 어떤 compose 서비스도
참조하지 않고, `.github/workflows/ci.yml`은 `k8s/`도 `helm/`도 전혀 건드리지
않는다. ADR 0041 작업의 일환으로 프로젝트 값에 맞게 내용은 고쳤지만
(`app: upload-board-api`, `bluecode1775/sharenpo:latest`, 포트 3000 — 커밋
`48a89f2`), 내용을 고쳤다고 역할이 생기는 건 아니었다: 여전히 Helm 차트의
템플릿이 이미 렌더링하는 것(`Deployment`와 `Service`, `ConfigMap`/`Secret`
연결·migration `Job`·`Ingress` 대응물은 없음)의 더 작은 부분집합을 그대로
중복하는 정적 YAML로 남아 있었다.

같은 대상을 두 디렉터리가 각자 주장하는 이 모양은, 정확히 ADR 0037의 원래
문서 오류를 만들어낸 것과 같은 구조다 — 둘을 함께 확인하도록 강제하는 게
아무것도 없어서 한쪽 서술이 조용히 낡아버린 것.

## 결정

- **`k8s/`의 정적 매니페스트 파일 5개는 앞으로 옮기지 않고 삭제한다.** 이미
  Helm 차트의 템플릿이 다루는 것의 엄격한 부분집합이었고, 그 부분집합을
  템플릿화되지 않은 두 번째 형태로 중복 보관하는 건 안전망이 아니라 부채
  (조용한 드리프트)다.
- **Helm 차트를 `helm/upload-board-project/`에서
  `k8s/helm/upload-board-project/`로 옮긴다.** 이로써 최상위 Kubernetes
  관련 디렉터리는 형제 두 개가 아니라 딱 하나만 남는다. 차트 자체의 내용
  (`Chart.yaml`, `values.yaml`, `templates/*`, `README.md`+`.ko.md`,
  `.helmignore`)은 바뀌지 않으며, 예전 위치를 가리키던 내부 경로 인용만
  갱신한다: `templates/deployment.yml`/`templates/migration-job.yml`의
  `required()` 가드 메시지 두 곳, `templates/NOTES.txt`, `values.yaml`의
  주석 한 줄, 그리고 `README.md`/`README.ko.md`의 상대 경로
  `../../../docs/ADR/...` 링크(디렉터리 한 단계 더 깊어짐).
- **ADR 0037과 ADR 0041의 본문은 다시 쓰지 않는다.** ADR 0037의 배경은
  커밋 `ee75900`이 2026-08-11에 `helm/upload-board-project/`에 무엇을
  추가했는지를 적은 것 — 그건 당시 사실이었고 그대로 역사적 기록으로
  남는다. ADR 0041의 결정과 추가 기록 내용도 바뀌지 않으며, 링크가
  깨지지 않도록 경로 인용(예: 차트 README 링크)만 갱신한다 — 경로 인용은
  기록된 결정 자체가 아니라 정확히 유지해야 할 포인터로 취급한다는
  원칙에 따른 것이다.

## 기각한 대안

- **두 디렉터리를 그대로 둔다** — 기각. `k8s/`의 파일들은 소비하는 곳이
  없었고, Helm 차트가 이미 렌더링하는 것과 같은 Deployment/Service 모양을
  동기화되지 않은 두 번째 서술로 존재하기만 했다 — 정확히 ADR 0037의 사실
  오류가 몇 달 동안 발견되지 않고 남아 있게 만든 바로 그 조건이다.
- **`helm template`의 렌더링 결과물을 `k8s/`에 새 정적 매니페스트로
  추출한다** — 기각. 이러면 ADR 0041이 쌓아온 것(`values.yaml`
  파라미터화, `existingSecret`의 `required()` 가드, ConfigMap과 migration
  Job 사이의 pre-install hook 순서 — 실제 스모크 테스트로 발견해 고친 것,
  ADR 0041의 2026-08-17 추가 기록)이 전부 사라진다. 정적 추출은 통합이
  아니라 기능 다운그레이드다.
- **반대로 `k8s/`의 내용을 `helm/`로 옮긴다**(최상위 이름을 `helm/`로
  유지) — 기각, 기능이 아니라 이름 선택의 문제다: `k8s/`는 "이 저장소의
  Kubernetes 관련 콘텐츠"를 가리키는 더 일반적이고 기존부터 있던 이름이고,
  지금 그 최상위 자리를 두고 경쟁하는 다른 대상이 없다. 반면 향후 Helm이
  아닌 Kubernetes 산출물(예: 일회성 운영 작업용 raw Job 매니페스트)이
  생기면 `helm/`라는 이름의 루트 아래에는 놓일 자리가 마땅치 않다.

## 결과

- `helm/`은 더 이상 최상위 디렉터리로 존재하지 않는다. 그 경로를 가정하는
  외부 참조·북마크·명령(예: `cd helm/upload-board-project`)은
  `k8s/helm/upload-board-project`로 갱신해야 한다.
- `docs/ROADMAP.md`의 Stage 4 컴포넌트 상태표(Kubernetes·Helm 행)와
  `docs/CHANGELOG.md`(과거 항목을 다시 쓰는 게 아니라 새 `[Unreleased]`
  항목 추가)는 새 경로를 인용하도록 갱신한다 — 이 ADR과 함께 진행할 후속
  문서 갱신으로 추적한다.
- `k8s/infra/terraform/`은 건드리지 않는다 — 이 ADR은 매니페스트/차트
  분리에 한정되며, Terraform 스캐폴딩(ADR 0038)은 범위 밖이다.
- 스키마·엔티티·API 표면 변경 없음. `helm lint --strict`와
  `helm template`을 새 경로에서 다시 실행해, 이동 전과 동일하게 통과함을
  확인했다.

### 추가 기록 (2026-08-17) — 한 단계 더 평탄화: `k8s/helm/upload-board-project/`가 아니라 `k8s/helm/`

위 결정은 차트를 `k8s/helm/upload-board-project/`로 옮겨, `k8s/` 아래
`helm/` 아래에 다시 차트 이름을 한 번 더 중첩시켰다. 다시 보니 차트가 이미
Helm 전용 위치에 있는 상태에서 디렉터리 이름을 또 반복하는 건 의미가
없다 — `k8s/helm/`만으로도 "Helm 차트"라는 뜻이 명확하므로, 그 아래
`upload-board-project/` 단계를 추가해도 정보는 늘지 않고 깊이만 늘어난다
(`k8s/infra/terraform/`과는 다르다 — 거기선 `infra/`와 `terraform/`이 각각
서로 다른 이름 역할을 한다).

이제 차트는 **`k8s/helm/`**에 바로 있다(`Chart.yaml`, `values.yaml`,
`templates/`, `README.md`+`.ko.md`, `.helmignore` 전부 위 결정이 둔 위치에서
한 단계 위로; 비어 있던 `charts/` 스캐폴딩 하위 디렉터리 — Helm의 서브차트
의존성 관례용, 여기선 미사용 — 는 옮기지 않고 삭제했다). 이전과 같은 종류의
내부 경로 인용을 다시 갱신했다: `required()` 가드 메시지 두 곳,
`templates/NOTES.txt`, `values.yaml` 주석, README의 상대 ADR 링크(이제
`../../docs/ADR/...`, 위 결정의 `../../../`보다 한 단계 얕음). `helm lint
--strict`/`helm template`도 이 경로에서 다시 검증, 동일한 출력. `Chart.yaml`의
`name: upload-board-project` 필드는 영향받지 않는다 — 차트의 정체성은
디렉터리 이름이 아니라 그 필드에서 온다.
