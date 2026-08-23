# 변경 이력

> English version: [CHANGELOG.md](CHANGELOG.md)

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따릅니다. 아직
버전 태그가 없으므로, 이력은 초기 `0.0.1` 개발 라인(package.json 버전) 아래에
커밋 날짜별로 묶었습니다.

> **재구성 안내**: 2026-07-22까지의 항목은 git 이력에서 사후 재구성했습니다(커밋
> 해시 병기). 커밋 메시지가 불충분한 경우 diff가 실제로 보여주는 내용을
> 기술했습니다.

## [Unreleased]

### 변경
- **`frontend/`: 파일 보드를 3열 프리뷰 그리드 + 무한 스크롤로 개편(2026-08-24, 커밋
  `e567277`)** — `/files`는 파일당 텍스트 한 줄만 보여줬기 때문에, 상세 페이지를 열기
  전에는 어떤 파일인지 알 수 없었다. 이제 16:9 프리뷰 타일이 3x3 그리드로 깔리고,
  스크롤하면 3xN으로 이어서 펼쳐진다. 이미 있던 제목 검색([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)의
  `search` 파라미터)은 필터 행의 남는 폭을 모두 쓰도록 넓혔다. **작성자가 밝힌 이유**:
  요즘 기기 성능이면 파일을 실제로 받아오는 것 자체는 무리가 없고, 스크롤로 훑는 편이
  텍스트 목록보다 정보를 빠르게 읽는다 — 다만 프리뷰가 계속 쌓여 성능 저하로 이어져서는
  안 되므로, 과감히 받아오되 한 세션이 쌓을 수 있는 양에는 상한을 두는 쪽이 사용자
  편의에 맞다. 아래의 모든 안전장치가 구현하는 것이 바로 이 균형이며, 단순히 전부
  무조건 로드하지 않은 이유도 여기에 있다.
  `FilePreviewTile.tsx`/`.module.css`(신규)가 타일 하나와 그 지연 로드 수명주기를
  전담한다: 이미지는 타일이 뷰포트에 들어올 때 로드하고, 영상은 "Load preview"를 눌러야
  로드하며, 오디오는 아예 바이트를 받지 않는다(보여줄 프레임이 없으므로 🎵 아이콘 타일을
  유지). 영상의 클릭 게이트는 장식이 아니다 — 썸네일 엔드포인트가 없고 `<img>`/`<video
  src>`는 Bearer 헤더를 실을 수 없어, `private` 파일의 프리뷰는 곧 업로드 상한인 100MB
  까지의 객체 전체를 내려받는 일이기 때문이다([ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md)).
  그래서 private 타일은 `FileDetailPage.tsx`가 이미 하던 것과 똑같이 인증된 blob 경로로
  읽고 언마운트 시 objectURL을 revoke하며(ADR 0025/0026), public/unlisted 타일은 콘텐츠
  URL에서 바로 스트리밍한다. `FileBoard.tsx`의 페이지 크기는 20 → 9로 줄었고(한 페이지가
  정확히 3x3 한 화면), Previous/Next 페이저는 그리드 아래 sentinel을 감시하는
  `IntersectionObserver`로 대체됐다. 자동 로드는 180개(3열 x 60행)에서 멈추고 그
  이후로는 "Load more" 버튼만이 유일한 진행 수단이므로, 무심코 스크롤하는 것만으로
  테이블 전체가 메모리에 올라오지 않는다. 요청마다 부여하는 id 가드는 필터 변경 도중
  도착한 이전 응답이 새 질의 결과 뒤에 잘못 이어 붙는 것을 막는다.
  `DashboardPage.module.css`의 페이지 폭은 720px → 1126px(`index.css`의 `#root` 폭과
  동일)로 넓혔는데, 720px에서는 세 프레임이 각각 227px밖에 되지 않았기 때문이다. 업로드
  폼은 원래 폭을 유지한 채 가운데 정렬해 옆으로 퍼지지 않게 했다. `max-width: 640px`
  단일 열 폴백은 새 그리드가 휴대폰에서 최소한 쓸 수 있게 하는 선까지만 넣은 것으로,
  전면 반응형 작업은 여전히 미해결이다([ROADMAP.ko.md](ROADMAP.ko.md) > 7 참조).
  `frontend/e2e/board.spec.ts`의 페이저 단언은 "Load more" 부재 단언으로 바뀌었다.
  그리드는 `<ul>`/`<li>` 시맨틱과 타일당 `<a>` 하나를 의도적으로 유지했기 때문에,
  `board`/`upload`/`detail.spec.ts`의 기존 `li` / `li a` /
  `getByTitle('Filter the list to this creator')` 선택자는 그대로 동작한다. 백엔드·DB·
  Swagger·에러 계약 변경은 없다 — `take=9`는 `GetFilesDto`가 이미 허용하는 `take` 1–100
  범위 안이므로 [`frontend/docs/API-CONTRACT.ko.md`](../frontend/docs/API-CONTRACT.ko.md)도
  영향을 받지 않는다. `pnpm build`/`pnpm lint` 통과, Playwright e2e 22개 전부 통과.
  실제 브라우저(Playwright MCP)로 직접 확인한 것: 스크롤에 따라 타일 9 → 18 → 24개로
  늘고 끝에서는 추가 요청이 없는 것, private 이미지가 `blob:` objectURL에서 원본 640×360
  으로 렌더되는 것, private 영상이 클릭 후 `readyState 4`(988×480, 10.6초)에 도달하는 것,
  제목 검색이 2건으로 좁혀졌다 되돌아오는 것, 420px에서 단일 열로 떨어지며 가로 오버플로가
  없는 것. 이 라이브 검증 **덕분에** 발견해 같은 작업에서 고친 결함이 둘 있다: 위의 720px
  페이지 폭 상한, 그리고 `<img>`에 `onError`가 없어 바이트가 유실된 파일이 타일의
  `⚠ Preview unavailable` 대신 브라우저 기본 깨진 이미지 상태로 노출되던 문제(영상 분기
  에는 이미 `onError`가 있었다).
- **Terraform 3-state 분리: `k8s/infra/terraform/`를 단일 루트 모듈에서 `cluster/`/
  `app-infra/`/`addons/`로 재구성(결정 2026-08-19, 세 작업에 걸쳐 구현 2026-08-20,
  [ADR 0044](ADR/0044-terraform-three-state-split.ko.md))** — 기존 단일 `main.tf`는
  EKS/VPC(cluster)와 RDS/S3+IRSA/Secrets Manager/Route53+ACM(app-infra)을 하나의
  Terraform state에 묶고 있어, 클러스터를 데이터/시크릿/DNS 계층과 독립적으로
  apply·destroy할 방법이 없었다. 독립적으로 apply 가능한 세 루트 모듈로 분리했다:
  `cluster/`(`module.vpc`+`module.eks`), `app-infra/`(RDS/S3+IRSA/Secrets
  Manager/Route53+ACM, `terraform_remote_state`로 `cluster/`의 output을 읽음, backend
  local), `addons/`(`module.eks_blueprints_addons` — ALB Controller + External
  Secrets Operator, 다른 두 state의 output을 **둘 다** 읽는 유일한 state). Apply 순서:
  `cluster` → `app-infra` → `addons`; destroy는 역순. 분리 구현 과정에서 설계(D5) 목록이
  놓친 output 3개가 드러났다 — 기존 단일 루트 모듈이 `module.*` 직접 참조로 읽던 값이라
  state 경계가 생기면 그 직접 참조가 불가능해지는 경우였다: `vpc_id`/`private_subnets`
  (`app-infra/`의 RDS 서브넷 그룹/보안 그룹을 연결하며 발견, coupling point 1)와
  `cluster_version`(`addons/`의 `eks_blueprints_addons` 입력을 연결하며 발견, coupling
  point 4). 퇴역한 루트 `main.tf`/`variables.tf`/`outputs.tf`/`versions.tf`는 세
  서브디렉터리와 나란히 남기지 않고 삭제했다; `k8s/infra/terraform/README.md`(+`.ko.md`)는
  3단계 apply/destroy 순서에 맞게 다시 썼다. 세 디렉터리 모두 `terraform validate`/
  `fmt -check` 통과 — 실제 AWS에 대한 `apply`는 실행하지 않았다. 후속 점검에서
  `k8s/infra/terraform/.terraform.lock.hcl`(분리 이전 루트의 provider lock 파일)이 그
  삭제에서 빠진 채 고아로 남아있던 것을 발견했다 — 그 디렉터리에 이 파일을 정당화할
  `.tf` 설정이 더 이상 없었고, 파일 자체의 마지막 수정도 ADR 0043보다 이전이었으며,
  내용도 이제 3개 하위 디렉터리 lock 파일로 대체된 옛 aws+kubernetes+helm+random 묶음
  provider 세트였다. 로컬(미추적) 루트 `.terraform/` 캐시와 함께 제거했다.

- **Terraform: 업스트림 EKS/VPC 스캐폴드를 이 프로젝트의 실제 인프라로 적응
  (2026-08-18, [ADR 0043](ADR/0043-terraform-project-adaptation.ko.md))** —
  [ADR 0038](ADR/0038-terraform-iac-scaffold.ko.md) 스캐폴드가 2026-08-11에 들어온 뒤
  손대지 않았던 `k8s/infra/terraform/main.tf`가 업스트림 예제의 Istio 워크스루(주석
  처리가 아니라 완전히 제거)를 대신해 이 프로젝트 자신의 리소스를 프로비저닝하게 됐다:
  이기종 EKS 관리형 노드 그룹 2개(Graviton이 기본 용량, x64는 수동 failover용 유휴
  그룹), EKS 워커 노드에서만 접근 가능한 private 서브넷의 관리형 RDS PostgreSQL, Helm
  차트의 `default` ServiceAccount로 범위를 좁힌 전용 IRSA 역할이 딸린 private S3 버킷,
  AWS Secrets Manager 항목 + External Secrets Operator 설치(`eks_blueprints_addons`의
  `enable_external_secrets`)와 그것이 렌더링하는 1회성 `kubectl apply`용
  `SecretStore`/`ExternalSecret` 매니페스트 output, ALB Ingress 경로용 Route53
  호스팅 영역 + DNS 검증 ACM 인증서. `terraform validate`/`fmt -check` 통과; 실제
  AWS에 대한 `apply`는 실행하지 않았다. 이틀 뒤 위의 3-state 분리로 대체됐다 — 이
  단일 루트 모듈 형태는 프로덕션에 apply된 적이 없다.

- **`k8s/helm/upload-board-project/`를 `k8s/helm/`로 평탄화(2026-08-17, 아래 항목의 당일
  후속 조치, [ADR 0042](ADR/0042-k8s-helm-directory-consolidation.ko.md) 추가 기록)** —
  차트를 `helm/` 아래 `upload-board-project/` 아래에 중첩시키면 "여기가 Helm 차트다"라는
  신호를 정보 증가 없이 두 번 반복하는 셈이다 — 각 구간이 서로 다른 걸 가리키는
  `k8s/infra/terraform/`과는 다르다. `Chart.yaml`, `values.yaml`, `templates/`,
  `README.md`+`.ko.md`, `.helmignore`를 한 단계 위로 옮겼고, 비어 있던 미사용
  서브차트-의존성 스캐폴딩 `charts/`는 옮기지 않고 삭제했다. 경로 인용을 다시
  갱신했다(`required()` 가드 메시지 두 곳, `NOTES.txt`, `values.yaml` 주석, README의 상대
  ADR 링크 — 이제 `../../docs/ADR/...`). `helm lint --strict`/`helm template` 재검증, 출력
  동일. `Chart.yaml`의 `name: upload-board-project` 필드는 영향 없음.

- **`helm/upload-board-project/`를 `k8s/helm/upload-board-project/`로 이동; `k8s/`의 독립
  정적 매니페스트 5개(`k8s/pod/pod.yml`, `k8s/deployment/deployment.yml`,
  `k8s/deployment/rolling_update.yml`, `k8s/cluster/deployment.yml`,
  `k8s/cluster/cluster_IP.yml`) 삭제(2026-08-17,
  [ADR 0042](ADR/0042-k8s-helm-directory-consolidation.ko.md))** — 저장소에는 같은
  대상을 다루는 최상위 형제 디렉터리가 두 개 있었다: `k8s/`의 raw 매니페스트는 소비하는
  곳이 없었고(CI 잡도, compose 참조도 없음) Helm 차트의 템플릿이 이미 렌더링하는 것의
  엄격한 부분집합(`Deployment`/`Service`뿐, `ConfigMap`·`Secret` 연결·migration
  `Job`·`Ingress` 대응물 없음)이었다 — 정확히
  [ADR 0037](ADR/0037-helm-chart-scaffold.ko.md)의 "`k8s/`에 실제 매니페스트가 있다"는
  원래 사실 오류를 만들어낸 것과 같은, 동기화 안 된 중복 서술 패턴이다.
  `helm template`의 출력을 새 정적 파일로 추출하는 대신(그러면 `values.yaml`
  파라미터화, `existingSecret`의 `required()` 가드, 아래 항목에서 고친 pre-install hook
  순서가 전부 사라진다) 최상위 Kubernetes 디렉터리를 하나로 통합했다. 차트 내용은
  바뀌지 않았고 — 예전 위치를 가리키던 내부 경로 인용만 갱신했다(`required()` 가드
  메시지 두 곳, `templates/NOTES.txt`, `values.yaml` 주석 한 줄, `README.md`/
  `README.ko.md`의 상대 ADR 링크, 디렉터리 한 단계 더 깊어짐). `helm lint --strict`/
  `helm template`을 새 경로에서 재검증, 출력 동일. ADR 0037/0041 본문은 손대지 않았다 —
  그 배경/결정 서술은 작성 당시 기준으로 정확하다; ROADMAP.md의 Kubernetes·Helm 행만
  새 경로를 인용하도록 갱신했다.

### 수정
- **`admin/`: 한 탭에서 계정을 전환하면 새로 로그인한 정상 세션이 첫 하드 내비게이션에서
  강제 로그아웃됐다(2026-08-23)** — `admin/src/auth/session-guard.ts`가
  `recordSessionUser`/`clearSessionUser`를 export하고 있었지만 그 파일 밖에 호출부가 하나도
  없었다. 그래서 `sessionStorage`의 `admin:sessionUserId`가 로그인 때 기록되지도, 로그아웃 때
  지워지지도 않았다(`login-page.tsx`는 `setTokens`만, `dashboard`/`users`/`logs`의 로그아웃
  핸들러는 `clearTokens`만 호출). 결국 이전 계정의 id가 다음 계정 세션까지 그대로 남아,
  `assertSessionUser`가 B 계정의 첫 silent refresh를 "다른 탭이 세션을 가져갔다"로 오판했고
  `rejectSession()`이 멀쩡한 세션을 로그인 화면으로 되돌렸다. 이미 있던 두 export를 원래
  의도된 자리에서 호출하도록 고쳤다 — `login-page.tsx`의 `setTokens` 직후
  `recordSessionUser(sub)`, 세 로그아웃 핸들러의 `clearTokens()` 옆에 `clearSessionUser()`.
  `session-guard.ts` 자체는 무수정이다 — 다중 탭 충돌 감지 로직은 원래 옳았고, 빠져 있던 건
  기록의 생명주기뿐이었다. 검토 후 기각한 대안 둘: 공용 `signOut()` 헬퍼 신설(세 핸들러의
  중복은 없어지지만 Scope Discipline 기준 요청되지 않은 리팩터), `auth.store.ts`의
  `setTokens`/`clearTokens` 내부에서 호출(잊을 수 없는 구조지만 `session-guard.ts`가 이미
  스토어를 import하고 있어 순환을 피하려면 세 번째 모듈을 따로 떼어내야 한다).
  테스트는 `admin/src/auth/session-guard.spec.tsx`(신규 — 실제 로그인 폼과 로그아웃 버튼,
  그리고 `session-guard`의 실제 `doRefresh` 경로를 구동)와 `admin/e2e/session.spec.ts`(신규 —
  실제 백엔드를 상대로 한 탭 안에서의 A→B 전환 전체)로 덮었다. 둘 다 수정 전 코드에서 실패하는
  것을 확인했고, e2e는 보고된 증상을 그대로 재현했다. `pnpm test` 19/19, `pnpm e2e` 11/11.
  e2e를 작성하면서 비자명한 전제 하나가 드러났다: 이 결함은 탭에 소유자가 이미 기록된 뒤에만
  재현되므로 전환 전에 A 계정이 하드 내비게이션을 해야 한다 — 그게 없던 첫 초안은 수정 전에도
  통과했다.

- **Helm 차트: 임시 로컬 `kind` 클러스터에 대한 실제 `helm install --wait`로 발견한 진짜 버그
  2개(2026-08-17, 커밋 `0326199`, [ADR 0041](ADR/0041-helm-chart-project-adaptation.ko.md)
  추가 기록)** — 앞서 진행한 `helm lint --strict`/`helm template` 검증으로는 둘 다 못 잡았다,
  실제 API 서버가 리소스를 적용해봐야만 드러나는 문제였기 때문이다. (1) `migration-job.yml`의
  `pre-install` hook이 `envFrom`으로 `ConfigMap`을 읽는데, pre-install hook은 차트의 일반
  (non-hook) 리소스보다 먼저 실행된다 — ConfigMap이 아직 없어서 Job이
  `configmap "..." not found`로 실패했다. ConfigMap도 함께 hook으로 지정하되 더 이른 weight를
  주고, `before-hook-creation` delete policy를 붙여 일반 설치 단계까지 살아남도록 고쳤다.
  (2) `values.yaml`의 선택적 env var(`CORS_ORIGIN`, `SUPERADMIN_EMAIL`, `S3_BUCKET`,
  `AWS_REGION`)가 기본값 `""`였는데, ConfigMap이 이걸 리터럴 빈 문자열로 렌더링했다;
  `backend/app.module.ts`의 `Joi.string()`(`.allow('')` 없음)은 그 var가 없는 건 허용하면서도
  `""`는 거부해서, 앱이 `ConfigModule` 검증 단계에서 crash-loop에 빠졌다. ConfigMap 템플릿은
  이제 빈 값인 키를 렌더링하지 않고 건너뛴다. 두 수정 후 다시 `helm install --wait`(임시
  `postgres:16`, 현재 소스로 빌드한 이미지 — Docker Hub의 `bluecode1775/sharenpo:latest`는
  [ADR 0039](ADR/0039-db-tls-verification-stance.ko.md)의 SSL 수정 이전 이미지라 이 검증엔
  쓸 수 없었음)를 실행하니 성공했고, `/health/live`, `/health/ready`, `/doc` 모두 `Service`를
  통해 `200`을 응답했다. `kind` 클러스터와 로컬 이미지는 이후 모두 폐기했다. 실제 대상
  클러스터(AWS/EKS)는 여전히 미검증 — 이번 검증은 차트 자체의 배관만 증명한다.

- **`docker-compose-test.yml`의 `migrate` 서비스가 실제로는 마이그레이션을 한 번도 실행하지
  않았다 — 마이그레이션이 안 된 DB를 대상으로 앱 전체를 그냥 부팅해버렸다.** 이 파일에 대한
  테스트 실행 기록은 저장소 어디에도 없었다(`docs/CHANGELOG.md`, `docs/ROADMAP.md`,
  `docs/ADR/*sharenpo*`가 걸린 문서, `git log -p`를 모두 확인). 파일 자체의 이력(`4ac830a`,
  `529ae43`)도 파일을 작성하고 이미지 이름을 고친 것뿐, 끝까지 실행해본 적은 없었다. 첫 실제
  기록을 남기기 위해 직접 실행했으며, 실제 개발 스택과 분리하기 위해
  `docker compose -p sharenpo-test -f docker-compose-test.yml`(별도 프로젝트명)를 사용하고
  `DB_PORT=5437`, `api`엔 `-p 3002:3000` 오버라이드를 줘서 5435의 실 개발 DB나 로컬
  `pnpm start:dev`(3000)를 건드리지 않게 했다. 첫 실행 결과: `db`는 healthy로 떴지만
  `migrate`는 exit 1 — `SuperadminSeedService.onApplicationBootstrap`이
  `relation "user_entity" does not exist`로 실패했는데, `migrate`에 `command:` 오버라이드가
  없어 `migration:run` 대신 이미지의 기본 CMD(앱 자체)가 실행됐기 때문이었다. 근본 원인:
  이 파일이 `docker-compose.yml`에서 복사될 때(`4ac830a`)
  `command: ['node', 'node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/data-source.js']`
  줄이 로컬 빌드 전용 필드들과 함께 삭제됐는데, 다른 필드들과 달리 이 줄은 새 DB를 상대로도
  여전히 필요했다. 이 한 줄을 복원했다. 깨끗하게 다시 실행한 결과: `migrate`가 커밋된
  마이그레이션 7개를 모두 적용하고 exit 0으로 종료했고, `api`는 에러 없이 부팅했으며,
  격리된 컨테이너에서 `GET /health/live`, `GET /health/ready`, `GET /doc` 모두 `200`을
  응답했다. 격리 스택은 이후 완전히 정리했다(`down -v`) — 이번 실행에서 남은 것은 없다.
  **사고 기록**: 이 실행을 처음 격리하려던 시도에서 `-p` 프로젝트명을 지정하지 않았는데,
  그 결과 Compose가 `docker-compose-test.yml`의 이름 없는 `db` 서비스를 이미 떠 있던 실제
  개발 스택의 `uploadboardproject-db-1` 컨테이너(동일한 기본 프로젝트명, 동일한 서비스명)로
  매칭시켜 포트 5436으로 재생성해버렸다. 명명된 볼륨(`uploadboardproject_db-data`)은 그대로
  이어져 데이터 손실은 없었다 — 사후에 `docker compose -f docker-compose.yml up -d db`를
  다시 실행해(포트 5435 복구) 사고 전 상태와 테이블/행 개수를 대조해 확인했다 — 다만 이
  때문에 이후 이 세션의 모든 명령에는 예외 없이 `-p sharenpo-test`를 명시했다.

### 알려진 이슈
- **게시된 `bluecode1775/sharenpo:latest` Docker Hub 이미지(2026-08-12 빌드)는 아직도
  [ADR 0039](ADR/0039-db-tls-verification-stance.ko.md) 이전의 SSL 버그를 그대로 담고 있어
  non-SSL DB에 연결할 수 없다 — 정확히 `docker-compose-test.yml`이 실제 업로드 전에 잡아내야
  할 바로 그 상황이다.** `migrate` 커맨드 버그를 고친 직후(위 **수정** 참고) 발견했다: 격리된
  `db`→`migrate`→`api` 스택(`-p sharenpo-test`)이 이제 깨끗하게 부팅된 상태에서, 다음 단계로
  게시된 이미지를 대상으로 실제 기능(회원가입 → 로그인 → `POST /upload/attach` →
  `POST /file` → `GET /file/:id/content`)을 그대로 걸어봤는데 첫 요청부터 실패했다. `api`
  컨테이너가 준비 상태에 도달하지 못하고 계속 재시도했다: `Error: The server does not support
  SSL connections`. 근본 원인: 이 이미지는 커밋 `41c8c2c`(2026-08-12 06:46 UTC, 14:26 UTC
  빌드보다 먼저 반영됨) 기준으로 빌드됐는데, 이 커밋은 `NODE_ENV === 'production'`이면
  `ssl: { rejectUnauthorized: false }`를 강제로 켠다 — Dockerfile의 런타임 스테이지는 항상 이
  조건을 만족시키고(`Dockerfile:53`, `ENV NODE_ENV=production`), 격리 테스트의 평범한
  `postgres:16`은 SSL을 지원하지 않는다. 이 버그는 사흘 뒤 `4f1142b`(2026-08-14, ADR
  0039)에서 이미 소스상으로는 고쳐졌지만, 그 수정은 `dev`에만 있고 이미지는 재빌드된 적이
  없으며, `docker-publish` CI(`.github/workflows/ci.yml`)는 `main` 푸시에만 걸리는데 이
  수정은 아직 `main`에 닿지 않았다. 수정이 실제로 문제를 해결하는지도 확인했다: 현재 `dev`
  기준으로 프로덕션 스테이지를 로컬 빌드하고(`docker build -t bluecode1775/sharenpo:latest
  --target production .`, 로컬 태그만, push 없음) 동일한 격리 스택을 다시 돌리니 DB 연결,
  마이그레이션, 회원가입, 로그인, temp 업로드, `granted_` 승격,
  `GET /file/:id/content`(`302` → presigned S3 URL, [ADR
  0036](ADR/0036-s3-presigned-content-redirect.ko.md))까지 기능 흐름 전체가 성공했다.
  **이번 조사로 고쳐지지 않은 잔여 사항**: 공개된 `bluecode1775/sharenpo:latest` 태그 자체는
  여전히 낡고 고장난 빌드 그대로다 — 고쳐진 공개 이미지에 도달하려면 `dev`에서
  `build-and-push.sh`를 수동 실행하거나 `dev`를 `main`에 병합해 `docker-publish` CI를
  트리거해야 하는데, 둘 다 "테스트" 행위가 아니라서 이번 조사에서는 하지 않았다. 정상 동작
  이미지 검증 중 알게 된 부수 사항: 이 저장소의 `.env`처럼 `STORAGE_DRIVER=s3`인 경우, temp
  업로드·승격 테스트가 샌드박스가 아니라 **실제 운영 `sharenpo` S3 버킷**에 진짜 객체를
  쓴다 — 테스트 컨테이너를 대상으로 `DELETE /file/:id`를 호출해 정리해야 한다.

### 보안
- **프로덕션 DB 연결에서 `rejectUnauthorized: false`를 제거**
  (`backend/app.module.ts`) — `NODE_ENV=production`일 때 TLS 인증서 검증을
  꺼버리던 설정이었다. 이 설정을 도입한 커밋의 메시지("SSL validation on")와
  달리 실제로는 정반대 동작이었다. 손대기 전에 먼저 조사했다
  ([ADR 0039](ADR/0039-db-tls-verification-stance.ko.md) 참고): 개발자에게
  확인한 결과 AWS 수동 연결 검증을 통과시키기 위한 일회성 우회였고, 이
  저장소에서 추적되는 것 중 지금 이 설정에 의존하는 건 없음을 확인했다 —
  Terraform에 데이터베이스 리소스가 없고, `NODE_ENV=production`으로 실제
  DB에 붙는 CI 잡도 없으며, ROADMAP의 AWS 행도 여전히 🆕다. 조사 도중 독립적인
  두 번째 결함도 발견했다: 이 설정이 `NODE_ENV`로 분기하는데 이는 Joi 검증
  스키마에도 없고 이 프로젝트의 관례도 아니다 — `auth.controller.ts`의 쿠키
  `Secure` 플래그가 이미 쓰는 `ENV === 'prod'` 체크가 정석이다. 구체적인
  프로덕션 DB 대상이 아직 없어 대체할 설정의 형태를 잡을 근거가 없으므로
  스텁으로 남기지 않고 완전히 제거했다(Scope Discipline / YAGNI) —
  [ADR 0039](ADR/0039-db-tls-verification-stance.ko.md)가 실제 대상이 생겼을 때의
  정석 패턴(`ssl: { ca: <실제 CA> }`, `ENV`로 게이팅)을 기록해뒀으니 시간에
  쫓겨 다시 검증을 끄는 일은 없을 것이다. dev·CI·Docker 이미지 부팅 시퀀스
  어디도 동작 변화 없음 — 제거된 분기는 그 어느 것도 실행한 적이 없었다.

### 알려진 문제
> 2026-08-15 해소 — 아래 **수정** 참고. `PostDetailPage.tsx`/`CommentThread.tsx`/
> `CommentForm.tsx`(그리고 수정 도중 추가로 발견된 `PostForm.tsx`)의 사용자 노출
> 한국어 문구가 전부 영어로 바뀌었다 — "코드 **주석**은 한국어" 관례는 그대로 유지
> (애초에 그 관례가 문제였던 적은 없다).

- **게시글 상세/댓글 UI(`PostDetailPage.tsx`, `CommentThread.tsx`, `CommentForm.tsx`)의
  사용자 노출 문구가 전부 한국어로 박혀 있다** — 앱의 나머지(`LoginPage`, `UploadForm`,
  `FileBoard`, `FileDetailPage`, `NavBar`)는 전부 영어라 일관성이 깨진다. 2026-08-13,
  게시글/댓글 보드(`f239a6c`/`d542661`에서 랜딩)를 브라우저로 직접 조작하며 QA하던 중
  발견했다. 영향 범위: 버튼 전부(`저장`/`취소`/`수정`/`삭제`/`댓글 작성`), 삭제 확인
  대화상자, 댓글 placeholder·빈 상태·더 보기 문구, 세 파일 전체의
  `messageForError`/`messageForManageError`/`messageForPlaybackError` 분기 전부. 같은
  파일 안에서도 `<label>Title</label>`/`<label>Body</label>`는 영어로 남아있는데 바로
  옆 버튼만 한국어인 걸 보면, 의도적인 로케일 선택이라기보다 이 프로젝트의 "코드
  **주석**은 한국어" 관례(CLAUDE.md > File Creation Convention)와 항상 영어여야 하는
  사용자 노출 문구를 혼동한 것으로 보인다. 기능 자체는 멀쩡하다 — 같은 QA 세션에서
  (한국어) 버튼을 그대로 눌러 댓글 작성/수정/삭제, 게시글 수정 전부 정상 동작을
  확인했다.

### 수정
- **`STORAGE_DRIVER=s3`에서 private 파일의 소유자 본인조차 재생이 완전히 안 되던
  문제 — S3 버킷 CORS 설정으로 해결, 소스 코드 변경 없음.** `FileDetailPage.tsx`의
  private 티어 재생 경로는 `fetch()`+Blob으로 콘텐츠를 직접 가져오는데(`<video>`/
  `<audio>`/`<img>` 태그는 Bearer 토큰을 실어 보낼 수 없어서), 이 프로젝트의
  `sharenpo` S3 버킷에는 **CORS 설정이 아예 없었다** — `GetBucketCorsCommand`가
  `NoSuchCORSConfiguration`을 반환했다 — 그래서 [ADR 0036](ADR/0036-s3-presigned-content-redirect.ko.md)의
  `302` 리다이렉트를 따라간 뒤 브라우저가 JS의 응답 본문 읽기를 거부했다. 이것이
  바로 ADR 0036의 2026-08-15 추가 기록이 "후보 해결책 1"로 남겨둔 잔여 사항이다.
  버킷에 CORS 규칙 하나를 직접 적용했다(`GET`만 허용, 이 백엔드 자체
  `CORS_ORIGIN`에 이미 있는 로컬 개발 origin 두 개로 제한) — 코드 변경이 아니라
  AWS 콘솔/API 수준의 변경이며, 신규 의존성도 없다(이미 설치된
  `@aws-sdk/client-s3`를 재사용). 실제 재검증: 실제 Chromium 세션에서 private
  영상이 소유자에게 진짜로 재생됨을 확인했다(`readyState: 4`, 실제
  `videoWidth`/`videoHeight`, CORS 콘솔 에러 없음) — 단순히 에러 없는 HTTP
  상태만 본 게 아니다. `public`/`unlisted` 재생은 원래부터 영향받지 않았다. 같은
  추가 기록의 잔여 사항 한 가지는 당시 시점엔 남아 있었다 —
  `frontend/e2e/detail.spec.ts:73`의 단언이 리다이렉트 체인의 잘못된 구간을
  검사하고 있던 문제 — 이건 같은 날 별도로 아래에서 고쳤다.
  [ADR 0036](ADR/0036-s3-presigned-content-redirect.ko.md) > 추가 기록 (2026-08-16)
- **`frontend/e2e/detail.spec.ts:73`의 오래된 리다이렉트-구간 단언 — ADR 0036 추가
  기록의 마지막 미해결 항목을 마무리.** `expect(contentResponse.status()).toBe(200)`은
  리다이렉트의 *첫* 홉만 매칭했는데, `STORAGE_DRIVER=s3`(ADR 0036)에서는 이게 정상적으로
  `302`이므로, 이 드라이버에서는 재생이 실제로 되는지와 무관하게 이 단언이 절대
  통과할 수 없었다. `expect([200, 302]).toContain(contentResponse.status())`로 완화하고,
  실제 성공의 진짜 증거는 이미 있던 `video[src^="blob:"]` 단언(타임아웃 15초로 강화)과
  "Network error" 메시지가 없다는 새 단언이 대신 맡도록 했다. `STORAGE_DRIVER=local`과
  `STORAGE_DRIVER=s3` **양쪽 모두**에서 5/5 통과를 확인했다(각 확인마다 `.env`
  오버라이드를 전환하고 백엔드를 재기동한 뒤, 원래 값으로 복원). 프런트엔드
  `pnpm build`/`pnpm lint` 클린.
  [ADR 0036](ADR/0036-s3-presigned-content-redirect.ko.md) > 추가 기록 (2026-08-16)
- **ADR 0040의 mediaType 태그 선택 로직을 실제 브라우저에서 시각적으로 검증
  완료.** 아래 항목은 원래 "렌더링된 태그를 실제 브라우저에서 시각적으로
  확인하지는 못했다(이 세션에는 브라우저 도구가 없음)"고 적혀 있었다. 앱을
  기동해(백엔드+프런트엔드+DB) 실제 Playwright/Chromium 세션으로 확인한 결과:
  새로 올린 이미지는 `<img>`로 렌더링되고(로드 완료, `naturalWidth`/`naturalHeight`
  정상), 새로 올린 mp3는 `<audio controls>`로 렌더링되며 — 둘 다 `<video>`로
  떨어지지 않았고 — API 응답의 `mediaType`도 두 경우 모두 정확했다. 검증만
  진행했고 코드 변경은 없다.
- **`FileDetailPage`/`PostDetailPage`가 업로드된 파일의 실제 종류와 무관하게 항상
  `<video>`로만 재생을 시도했다.** 이미지나 mp3 파일도 `GET /file/:id/content`
  (ADR 0025/0026)로 완전히 접근 가능했지만, 화면에는 제대로 표시·재생되지 않았다 —
  `FileEntity`에도 `FileResponseDto`에도 해당 파일이 세 업로드 종류(`image`/`audio`/
  `video`, ADR 0025 D4/D5) 중 어디에 속하는지 알려주는 필드가 아예 없었기 때문이다.
  `POST /upload/attach`가 타입별 멀티파트 필드를 받을 때는 검증하면서도, 그 결과를
  쓰기 경로 너머까지 저장해 두지 않았던 것이 근본 원인이다. `FileEntity`에 새
  `mediaType` 컬럼(신규 `FileMediaType` enum)을 추가하고, `FileService.uploadFile()`
  내부에서 파일 확장자로 서버가 직접 판정하도록(클라이언트가 보내는 값이 아님,
  `TEMP_FILENAME_PATTERN`이 이미 나열해 둔 동일한 세 확장자 그룹을 그대로 재사용)
  고쳤다. 기존에 이미 존재하던 모든 행은 손으로 작성한 마이그레이션으로 백필했다
  (`ADD`로 nullable 컬럼 추가 → 확장자 기반 `UPDATE` → `SET NOT NULL` — `migration:
  generate`는 백필이 필요하다는 사실 자체를 알 방법이 없다; 이때 자동 생성된 diff에도
  베이스라인 특유의 스퓨리어스 FK/인덱스 재해시 구문이 그대로 섞여 나와, 검토 전에
  제거했다). `FileResponseDto`도 이제 `mediaType`을 실어 보내고, `FileDetailPage.tsx`/
  `PostDetailPage.tsx`는 이 값으로 `<img>`/`<audio controls>`/`<video controls>`를
  고른다 — visibility에 따른 기존 소스 획득 로직(private는 인증된 blob fetch,
  public/unlisted는 직접 `src`)은 그대로 유지했다. 로컬 서버로 엔드투엔드 검증했다
  (이번 확인에 한해서만 `STORAGE_DRIVER=local`로 오버라이드 — 이 환경의 `.env`가
  실제 AWS S3 버킷을 가리키고 있어 거기에 테스트 객체를 쓰지 않으려 피했다): 실제
  jpg/mp3/mp4를 attach→승격 전체 흐름으로 업로드해 `mediaType`이 각각 `image`/
  `audio`/`video`로 정확히 돌아오는 것을 확인했고, 백엔드 `pnpm lint`/`pnpm test`
  (216/216), 프런트엔드 `pnpm build`/`pnpm lint` 모두 클린이다. 다만 렌더링된 태그를
  실제 브라우저에서 시각적으로 확인하지는 못했다(이 세션에는 브라우저 도구가 없음).
  [ADR 0040](ADR/0040-persisted-media-type-for-playback.ko.md)
- **게시글/댓글/게시글 작성 폼 UI의 한국어 하드코딩 문구를 영어로 교체** — 위 "알려진
  문제"를 해소한다. 발견 당시 범위 그대로 `PostDetailPage.tsx`, `CommentThread.tsx`,
  `CommentForm.tsx`를 고쳤고, 여기에 `PostForm.tsx`의 `POST_FILE_TAKEN`/
  `FILE_NOT_FOUND`/`FORBIDDEN_NOT_OWNER` 분기 세 곳도 추가로 고쳤다 —
  `frontend/src/features/posts/` 전체를 한글 문자 기준으로 grep하다 중간에 발견한
  것으로 원래 보고 범위는 아니었지만 같은 결함 종류다(이 파일의 `default:` 분기는
  이미 영어였다 — 같은 주석/UI 문구 혼동이 네 번째 파일에서도 있었던 것). 교체 문구는
  같은 에러코드·확인창 형태에 대해 `UploadForm.tsx`/`FileDetailPage.tsx`가 이미 쓰던
  영어 표현을 그대로 따랐다. `frontend/e2e/navigation.spec.ts`와
  `frontend/e2e/posts.spec.ts`에 옛 한국어 문구를 assertion으로 쓰던 곳이 각각 한 곳씩
  있어 새 문구에 맞게 갱신했다. frontend e2e 전체 재실행 결과 관련 테스트 22/22 통과
  (`detail.spec.ts`의 무관한 사전 실패 1건은 다른 세션이 남긴 로컬
  `STORAGE_DRIVER=s3` 설정 때문에 200 대신 302가 오는 것 — 이번 변경과 무관, 범위
  밖). 백엔드 변경 없음, ADR 불필요(설계 판단 없는 순수 문자열 교체).

### 추가
- **ADR 0041: Helm 차트 프로젝트 적응, ADR 0037의 유예 해제(2026-08-17)** —
  `helm/upload-board-project/`는 더 이상 `nginx`를 패키징하지 않는다. ADR 0037이
  적어둔 "`k8s/` 매니페스트를 먼저 템플릿화한다"는 이유를 확인하려다, `k8s/` 자체가
  여전히 미수정 `nginx`/`nginx-app` placeholder 파일 다섯 개였다는 사실을 발견했다
  (Helm 차트와 같은 부류의 스캐폴딩이지, 템플릿화할 실제 원본이 아니었다) — 이건
  먼저 별도로 바로잡았다(커밋 `48a89f2`): 이제 다섯 파일 모두 `app: upload-board-api`
  라벨, `bluecode1775/sharenpo:latest` 이미지, `Dockerfile`의 `EXPOSE 3000`과 맞춘
  컨테이너 포트 3000을 쓴다. [ADR 0041](ADR/0041-helm-chart-project-adaptation.ko.md)
  (커밋 `3609729`)은 그다음 ADR 0037의 "적응 작업을 미룬다"는 결정을 해제한 걸
  기록한다 — `helm lint --strict`/`helm template`이 살아있는 클러스터 없이도
  템플릿을 검증해주므로, 차트가 더 이상 클러스터가 생기길 기다릴 필요가 없다.
  차트 자체(커밋 `b591825`)는 `k8s/`가 아니라 `Dockerfile`/`docker-compose.yml`/Joi
  env 스키마에서 유도했다: 실제 이미지와 포트, `/health/live`+`/health/ready`
  probe(ADR 0031), non-root `securityContext`(ADR 0030), 비밀이 아닌 env var를 담는
  `ConfigMap`, `existingSecret` 참조 방식만 지원하는 `Secret` 소비 — 차트는 `Secret`을
  직접 만들지도, `values.yaml`에 비밀값을 리터럴로 받지도 않는다(ADR 0033의 목표
  형태) —, `docker-compose.yml`의 한 번만 도는 `migrate` 서비스를 본뜬 migration
  `Job`(ADR 0032), 그리고 기본 비활성인 `Ingress`(TLS는 여기서 종료, 앱 내부에서는
  안 함, ADR 0034). `replicaCount` 기본값은 3에서 1로 낮췄다: 기본
  `STORAGE_DRIVER=local`에서는 각 pod의 `file/temp`/`file/upload`가 그 pod만의
  디스크라, 한 replica로 업로드한 파일이 다른 replica에서는 안 보인다(스토리지
  계층에 대해 [ADR 0029](ADR/0029-storage-port-adapter.ko.md)가 이미 기록한 것과
  같은 다중 인스턴스 문제) — `STORAGE_DRIVER=s3`로 전환한 뒤에만 올려도 안전하다.
  살아있는 클러스터에 대한 `helm install` 검증은 여전히 안 된 상태다 — 아직 클러스터
  자체가 없다. ROADMAP.md의 Stage 4 컴포넌트 상태표도 맞춰 갱신(Helm 행 🔶
  스캐폴딩만 → 🔶 프로젝트 적응 완료; Kubernetes 행의 "기본 매니페스트 랜딩" 설명도
  처음으로 정확해짐).

- **ADR 0037/0038: Helm 차트·Terraform IaC 스캐폴딩 문서화(2026-08-11 랜딩,
  2026-08-15 문서 작성)** — `helm/upload-board-project/`(커밋 `ee75900`)와
  `k8s/infra/terraform/`(커밋 `c661fc4`) 둘 다 CHANGELOG 항목도 ROADMAP 상태표
  갱신도 ADR도 없이 랜딩됐다 — Stage 4의 다른 모든 컴포넌트가 지켜온 관행을
  깬 것이다. 이 항목은 그 공백만 메우며, 코드는 바꾸지 않는다.
  [ADR 0037](ADR/0037-helm-chart-scaffold.ko.md)은 Helm 차트를 있는 그대로
  기록한다: `Chart.yaml`의 description은 여전히 `helm create`의 기본 문구
  그대로, `values.yaml`의 `image.repository`는 placeholder인 `nginx`,
  `templates/`에는 `deployment.yml` 딱 하나뿐 — `k8s/`에 이미 있는 Service·두
  번째 Deployment·rolling-update 매니페스트는 하나도 템플릿화되지 않았다.
  [ADR 0038](ADR/0038-terraform-iac-scaffold.ko.md)은 Terraform 디렉터리를
  AWS `terraform-aws-eks-blueprints`의 "EKS Cluster w/ Istio" 예제의 **원문
  README와 리소스 구성을 그대로** 담고 있다고 기록한다 — 범용 EKS+VPC+Istio
  스택을 프로비저닝할 뿐, 이 프로젝트 자신의 ADR(0029/0033/0034)이 요구하는
  S3 버킷·데이터베이스·시크릿·ingress는 없고 `variables.tf`는 비어 있다. 두
  ADR 모두 이걸 "완료된 배포 가능 작업"이 아니라 "받아들인 시작점 스캐폴딩"
  으로 기록하고, 프로젝트 전용 적응 작업은 이번 문서화에 포함하지 않고
  미래 작업(ROADMAP > 미배정)으로 미룬다. ROADMAP.md의 Stage 4 컴포넌트
  상태표도 맞춰 갱신(Helm/Terraform 행 🆕 → 🔶).

- **`frontend/`: `PostDetailPage`, `CommentThread`, `CommentForm`을 CSS Modules로
  전환·재디자인 — 확정된 스타일 전면 개편의 5개 라우트 페이지 중 마지막**
  ([`frontend/docs/STYLE-PLAN.md`](frontend/docs/STYLE-PLAN.md) 항목 7). 각
  컴포넌트마다 동일 위치에 `*.module.css`를 배치했다(`PostDetailPage.module.css`,
  `CommentThread.module.css`, `CommentForm.module.css`) — 마크업 구조·상태·API 호출은
  그대로 두고 `style={{}}` → `className={styles.x}`만 바꿨다. `PostDetailPage`의
  헤더/수정 폼/플레이어/관리 버튼 영역은 `FileDetailPage.module.css`(항목 5)가 확립한
  상세 페이지 형태를 따랐고, `CommentThread`의 목록 행은 `PostBoard`(항목 6)의 목록
  행과 동일한 카드 처리(`--surface-raised` 배경, 테두리, 둥근 모서리)를 얻었으며,
  `CommentForm`은 이전에 없던 카드 래퍼(패딩/배경/테두리)를 `PostForm`과 맞춰
  새로 얻었다. `PostDetailPage.tsx`에 남아 있던, 이제는 불필요해진 스코프 인라인
  `lineHeight: 1.25` `<h1>` 오버라이드도 함께 제거했다 — 항목 5에서 착륙한 전역 `h1`
  `line-height: 118%` 수정이 이미 그 문제를 해결하며(이 항목이 해당 파일을 전환할 때
  지우도록 그때 남겨둔 항목이었다). 위 "알려진 문제" 항목 및 STYLE-PLAN.md의 범위 밖
  기록에 따라, 세 파일의 한글 하드코딩 UI 문자열은 손대지 않고 그대로 두었다 — 순수
  스타일/마크업 변경이며 문자열 내용은 바뀌지 않았다. `pnpm build`/`pnpm lint` 클린.
  `pnpm test:e2e`로 검증: `PostDetailPage`를 실제로 거치는 `posts.spec.ts`와
  `navigation.spec.ts`는 수정 없이 통과; `detail.spec.ts`의 무관한 기존 실패 1건
  (`FileDetailPage`의 private 재생 어서션이 `200`을 기대하지만, 이 환경의
  `STORAGE_DRIVER=s3` 설정([ADR 0036](ADR/0036-s3-presigned-content-redirect.md))
  때문에 `302`가 반환됨)은 이번 변경과 무관 — 이 작업이 건드린 파일은 그 실패에
  관여하지 않는다.
- **`frontend/`: `PostBoard`, `PostForm`, `FilePicker`를 CSS Modules로 전환·재디자인.**
  확정된 스타일 전면 개편의 4단계
  ([`frontend/docs/STYLE-PLAN.md`](frontend/docs/STYLE-PLAN.md) 항목 6). 각 컴포넌트마다
  동일 위치에 `*.module.css`를 배치했다(`PostBoard.module.css`, `PostForm.module.css`,
  `FilePicker.module.css`) — 마크업 구조·상태·API 호출은 그대로 두고 `style={{}}` →
  `className={styles.x}`만 바꿨다. `PostBoard.module.css`는 (`DashboardPage.module.css`를
  본뜬) `.page` 래퍼와 (`FileBoard.module.css`를 본뜬) 필터/목록/페이지네이션 클래스를 한
  파일에 함께 담았다 — 파일 게시판이 `DashboardPage`+`FileBoard`로 나뉜 것과 달리
  `PostBoard.tsx`는 NavBar·제목·폼·목록을 한 컴포넌트에서 전부 호스팅하기 때문이다.
  `frontend/e2e/*.spec.ts`는 `getByLabel`/`getByRole`의 접근성 이름 매칭에 의존하므로,
  전환 과정에서 라벨 문구·role·버튼/헤딩 이름을 모두 그대로 유지했다 — 새로 수동 검증만
  한 것이 아니라 기존 `posts`/`upload` 스펙을 수정 없이 그대로 돌려 확인했다(`pnpm
  test:e2e`, 둘 다 통과). `pnpm build`/`pnpm lint` 클린. 헤드리스 스크린샷으로 직접
  검증했다(임시 가입 계정, `FilePicker`로 파일을 첨부해 클레임한 업로드, 첨부 유무 각각의
  게시글 작성, 검색 필터 적용, 라이트·다크 테마 전부) — 필터 바, `FilePicker`의 스크롤
  가능한 라디오 목록, 행 레이아웃, 페이지네이션 어디에서도 시각적 회귀가 없었다.
- **`frontend/`: `FileDetailPage`와 `VisibilityBadge`를 CSS Modules로 전환·재디자인하고,
  오래된 제목 겹침 버그를 근본 원인 수준에서 수정.** 확정된 스타일 전면 개편의 3단계
  ([`frontend/docs/STYLE-PLAN.md`](frontend/docs/STYLE-PLAN.md) 항목 5). 두 컴포넌트 모두
  동일 위치에 `*.module.css`를 배치했다(`FileDetailPage.module.css`,
  `VisibilityBadge.module.css`) — 플레이어를 테두리·둥근 모서리 패널로 감쌌고, 공유 링크
  박스와 Manage 패널을 토큰 체계로 재디자인했으며, 앱 전역 `#root { text-align: center }`
  규칙이 이 페이지의 메타 줄과 "Manage" 헤딩을 옆의 좌측 정렬 flex 행(헤더, 컨트롤)과
  어긋나게 가운데 정렬하는 것을 막기 위해 `.page`에 `text-align: left`를 명시했다. 겹침의
  근본 원인: 전역 `h1` 규칙(`index.css`)이 `font-size: 56px`만 지정하고 자체
  `line-height`는 없어서, `:root`의 `line-height: 145%`가 *루트* 폰트 크기(18px ≈ 26px)
  기준으로 계산된 값을 그대로 물려받았다 — 56px 글자에 비해 턱없이 작아 제목이
  줄바꿈되면 줄끼리 겹쳐 보였다. 페이지별 오버라이드가 아니라 전역 `h1` 규칙 자체에
  (`h2`가 이미 쓰던 비율과 맞춰) `line-height: 118%`를 명시해 고쳤다. **수정하다가 함께
  발견한 사실**: `PostDetailPage.tsx:251`은 게시글 상세 페이지가 나올 때 이미 똑같은
  버그를 겪었고 그 하나의 `<h1>`에만 인라인 `lineHeight: 1.25`로 우회해 뒀다 — 전역
  수정으로 이제 그 인라인 오버라이드는 불필요해졌지만, `PostDetailPage`는 5번이 아니라
  7번 항목의 파일이라 일부러 손대지 않았다(STYLE-PLAN.md의 "이번 작업으로 해결된 사항"
  참고). `index.css`에는 `--success-bg`/`--warning`/`--warning-bg` 토큰도 추가했다(기존
  `--danger`/`--danger-bg` 쌍을 그대로 본떠서) — `VisibilityBadge`의 세 상태
  (public/private/unlisted)가 하드코딩된 16진수 대신 토큰 체계를 쓰도록. `pnpm
  build`/`pnpm lint` 클린; 관련 e2e 스펙 전체
  (`detail`/`upload`/`auth`/`board`/`navigation`/`posts`/`smoke`, 22개 중 21개) 통과 —
  유일한 실패는 아래에 적힌 것과 동일한, 기존부터 있던 `detail.spec.ts`의 S3 리다이렉트
  불일치이며 이번 변경과 무관하다. 헤드리스 스크린샷으로 직접 검증했다: 5줄로 줄바꿈되는
  스트레스 테스트용 긴 제목(라이트·다크 모두 겹침 없음), 짧은 제목, 그리고 세 가시성 상태
  전부(private/public/unlisted — 공유 링크 박스와 public/unlisted의 실제 영상 재생 포함).
- **`frontend/`: `LoginPage`와 파일 게시판(`DashboardPage` + `FileBoard` + `UploadForm`)을
  CSS Modules로 전환하고 재디자인.** 확정된 스타일 전면 개편의 2단계
  ([`frontend/docs/STYLE-PLAN.md`](frontend/docs/STYLE-PLAN.md) 항목 3-4), 아래 토큰 기반
  작업 위에 올라간 첫 페이지들이다. 각 컴포넌트마다 동일 위치에 `*.module.css`를
  배치했다(`LoginPage.module.css`, `DashboardPage.module.css`, `FileBoard.module.css`,
  `UploadForm.module.css`) — 마크업 구조·상태·API 호출은 그대로이고 `style={{}}` →
  `className={styles.x}` 치환만 이뤄졌다. `VisibilityBadge.tsx`는 계획대로 5번 항목
  (FileDetailPage)까지 범위 밖으로 남겨 인라인 스타일 그대로 뒀다.
  `frontend/e2e/*.spec.ts`가 `getByLabel`/`getByRole`의 접근성 이름 매칭에 의존하므로,
  전환 과정에서 모든 label 텍스트·role·버튼/헤딩 이름을 동일하게 유지했다. `pnpm
  build`/`pnpm lint` 클린; 관련 `auth`/`board`/`upload`/`navigation`/`smoke` 스펙(관련
  22개 중 21개) 통과 — 유일한 실패(`detail.spec.ts`, private 파일 콘텐츠 요청이 200 대신
  302를 반환)는 이번 변경과 무관하며, `git stash`로 변경 전 코드에서도 동일하게
  재현됨을 확인해 회귀가 아님을 검증했다 — 이미 기록된 S3 presigned-redirect/CORS
  잔여 이슈(ADR 0036)다. 라이트/다크 모드 각각 헤드리스 스크린샷으로 실제 렌더링을
  확인했다.
- **`frontend/`: 토큰 기반 테마 기반 작업 — `ThemeProvider` + 명시적 라이트/다크 토글,
  `NavBar`를 CSS Modules로 전환.** 확정된 스타일 전면 개편의 1단계
  ([`frontend/docs/STYLE-PLAN.md`](frontend/docs/STYLE-PLAN.md), 2026-08-14 결정) — 이후
  페이지별 재디자인 프롬프트가 전부 이 토큰 세트에 의존한다. `index.css`의 기존
  `--accent`/`--bg`/`--text-h` 블록을 병기가 아니라 **교체**했다 — 같은 날 STYLE-PLAN.md가
  확정한 팔레트로: `--brand`/`--brand-hover`/`--brand-contrast`,
  `--surface`/`--surface-raised`, `--text`/`--text-muted`/`--text-heading`, `--success`,
  `--danger`/`--danger-bg`(기존 `--accent` 퍼플을 브랜드 시드로 그대로 유지, 무관한 색상으로
  바꾸지 않음). 신규 `src/theme/` 폴더(`themeContext.ts`/`useTheme.ts`/`ThemeProvider.tsx`,
  fast-refresh를 위해 context/hook/provider를 파일로 분리하는 `src/auth/`의 패턴을 그대로
  따름)가 `<html>`의 `data-theme="light"|"dark"` 속성을 제어한다: 명시적으로 선택하면
  `localStorage`(`ui-theme`)에 영속화되어 `prefers-color-scheme`보다 우선하고, 한 번도
  토글하지 않은 세션은 여전히 OS 설정을 실시간으로 따라간다 — `index.css`의
  `@media (prefers-color-scheme: dark)` 블록에 `:not([data-theme='light'])` 가드를 추가해,
  OS가 다크여도 명시적 라이트 선택이 이를 덮어쓸 수 있게 했다. `NavBar.tsx`가 CSS Module로
  전환된 첫 컴포넌트이며(`NavBar.module.css`) 토글 버튼(☀️/🌙)이 추가됐다 — `main.tsx`에서
  트리에 연결. 이름을 바꾸기 전에 grep으로 다른 파일이 옛 CSS 변수명을 쓰는 곳이 없음을
  확인했으므로 다른 화면의 렌더링은 바뀌지 않았다 — 브라우저에서 직접 검증도 마쳤다(임시
  계정으로 회원가입, 양방향 토글 후 `data-theme` 전환과 NavBar 아래 게시글 목록이 기존과
  픽셀 단위로 동일함을 확인). `pnpm build`/`pnpm lint` 클린, 신규 의존성 없음(CSS Modules는
  Vite 내장). 남은 STYLE-PLAN 페이지(LoginPage, 파일 게시판, FileDetailPage, 게시글 게시판,
  게시글 상세)는 별도의 후속 프롬프트로, 아직 착수하지 않았다.
- **ADR 0036: `GET /file/:id/content`의 S3 presigned URL 리다이렉트 — 같은 변경에서
  설계와 구현을 함께 반영** ([ADR 0036](ADR/0036-s3-presigned-content-redirect.ko.md),
  [ADR 0029](ADR/0029-storage-port-adapter.ko.md)의 `FileStorage` 포트를 확장;
  [ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)/
  [ADR 0026](ADR/0026-file-visibility-implementation.ko.md)의 서빙 방식만 바꿀 뿐 접근
  검사 계약은 그대로 둠). `STORAGE_DRIVER=s3`에서도 이전에는 승인된 파일을 읽을 때마다
  앱 서버가 바이트를 프록시했다(`S3Storage`가 `LocalDiskStorage`와 똑같이 `Readable`을
  파이프하는 형태였음) — S3 어댑터를 도입해 앱 계층에서 덜어내려던 바로 그 대역폭·CPU
  비용 구조가 그대로 남아있던 셈이다. `FileStorage`에
  `getSignedReadUrl(key, contentType): Promise<string | null>`을 추가했다 —
  `LocalDiskStorage`는 항상 `null`(기존 스트리밍/Range/206/416 경로로 폴백, 변경
  없음), `S3Storage`는 presigned `GetObjectCommand` URL을 돌려준다(신규 의존성
  `@aws-sdk/s3-request-presigner`, Apache-2.0, `pnpm audit --prod`로 이 패키지발
  취약점 없음 확인; TTL은 호출마다가 아니라 생성 시점에 `ConfigService`로 한 번만
  읽음). `FileContentController.getContent`는 이제 `resolveContentAccess` 통과
  직후(`public`뿐 아니라 세 가시성 등급 전부) 이 메서드를 호출해, 값이 있으면 `302`
  리다이렉트하고 `stat()`/`createReadStream()`은 아예 건너뛴다 — `null`이면 기존
  흐름 그대로다. 발급한 URL은 캐싱·재사용하지 않는다: 요청마다 접근 판정과 서명을
  새로 한다. TTL(`CONTENT_SIGNED_URL_TTL_SECONDS`, 신규 Joi 항목 + `.env.example` 줄,
  기본값 300)은 임의로 정하지 않고 사용자에게 먼저 물어 확정했다(Documentation
  Authoring Protocol > 질문 단계) — ADR에서 더 긴 대안 세 가지도 검토하고 기각했다.
  고치지 않은 채 명시적으로만 남긴 것: 리다이렉트된 서명 URL은 만료 전까지 요청자의
  JWT/공유 토큰과 무관하게 그 자체로 자격증명 역할을 하므로, private/unlisted
  콘텐츠에 대해 이전의 "바이트 범위 요청마다 재검사"와는 분명히 다른 신뢰 모델이
  된다 — 짧은 TTL과 대역폭 절감이라는 목표를 근거로 받아들였다. 그리고
  `frontend/`·`admin/`의 `<video>`/`<audio>` 요소가 리다이렉트 경계를 넘는 Range
  탐색을 제대로 처리하는지는 미검증으로, 해당 저장소들 자체의 범위로 남겨 뒀다(e2e
  스위트는 로컬 어댑터만 돌리고 `STORAGE_DRIVER=s3`는 돌리지 않으므로 CI로도
  검증되지 않는다). `local-disk.storage.spec.ts`와 `s3.storage.spec.ts` 각각에
  `getSignedReadUrl` 테스트 케이스를 추가했다; `pnpm lint` 클린, 단위 테스트 211개
  전부 통과. `ROADMAP.md`의 S3 컴포넌트 상태 행, `ADR/README.md`, `README.md`의
  `GET /file/:id/content` 설명을 모두 맞춰 갱신했다(EN+KO 전체).
- **CI: `frontend-e2e`/`admin-e2e` Playwright 잡, `frontend/`·`admin/`의 lint/unit
  커버리지 추가** — 둘 다 `pnpm lint`, `pnpm test`, `pnpm e2e` 스크립트가 있었지만 어떤
  CI 잡도 실행한 적이 없어서, 이 두 폴더의 변경 사항은 검증 없이 머지되고 있었습니다.
  `frontend-lint`(oxlint)와 `admin-lint-and-unit`(eslint + vitest)는 각자의 작업
  디렉터리와 `pnpm-lock.yaml`에 범위를 한정합니다(둘 다 pnpm 워크스페이스가 아님).
  `frontend-e2e`/`admin-e2e`는 잡 전용 Postgres 서비스를 대상으로 백엔드를
  빌드+마이그레이션+기동한 뒤(원시 포트 체크 대신 `GET /health/live`를 기다림)
  Playwright를 구동합니다 — `admin-e2e`는 `admin/e2e/seed-superadmin.mjs`로 고정된
  CI 전용 자격 증명을 이용해 superadmin도 시딩합니다(매 실행마다 새로 만들고 버리는
  DB라 안전). 기존 백엔드 잡들에도 `actions/setup-node`의 pnpm 스토어 캐시를 활성화했습니다
  — 캐시 경로를 찾으려면 pnpm이 `PATH`에 있어야 해서 `corepack enable`을 `setup-node`
  앞으로 옮겼습니다.
- **2026-08-12에 추가된 `userId` 필터·CSV 내보내기·검색·정렬에 대한 admin e2e 커버리지** —
  `admin/README.md`의 "Open items"에 테스트가 없다고 기록돼 있던 기능들입니다.
  `logs.spec.ts`에 "View all" 링크의 `userId` 필터(그 해제 버튼 포함) 검증과 CSV 내보내기
  검증(파일을 내려받아 헤더 행과 필터링된 데이터 행을 확인)이 추가됐고, `users.spec.ts`에
  검색창 테스트와 정렬 가능한 헤더 테스트가 추가됐습니다. `pnpm e2e` — 10/10 통과.
- **CI: `docker-publish` 잡 — 프로덕션 이미지를 Docker Hub에 자동 푸시.** `build-and-push.sh`가
  수동으로 하던 일을 자동화했습니다: `main` 푸시에서 테스트 잡들이 통과하면
  `linux/amd64,linux/arm64` 대상으로 프로덕션 스테이지를 buildx로 빌드해
  `bluecode1775/sharenpo`를 `:latest`와 `:{sha}` 태그로 푸시합니다. `--push`를 직접
  사용했습니다(스크립트의 별도 빌드 후 `docker push` 단계는, 빌드 단계에 `--push`/`--output`이
  없어 멀티플랫폼 빌드의 아키텍처별 결과물을 버리게 되므로 — 같은 수정을
  `build-and-push.sh`의 태깅에도 적용해, 이전엔 암묵적이던 `:latest` 태그를 명시했습니다).
  **`ROADMAP.md`가 정한 계획보다 앞서 나간 것**입니다(GitHub Actions CD는 AWS 배포 대상이
  정해질 때까지, 그리고 자체 ADR이 나올 때까지 기다리기로 돼 있었습니다), 그리고
  [ADR 0035](ADR/0035-arm64-bcrypt-source-rebuild.ko.md)가 기록한 기존의 개인용
  `bluecode1775/sharenpo` 푸시와도 별개입니다 — 명시적 요청으로 추가했습니다.
  `ROADMAP.md`의 GitHub Actions 행은 이제 이것을 계획대로 된 일이 아니라 이름 붙인
  예외로 기록합니다.
- **`GET /user` 검색·정렬 추가, `GET /audit-log` 관련 유저 필터 추가** — 둘 다
  `admin/README.md`의 "What was adapted" 표에 "이 백엔드가 지원하지 않아 제거"로
  기록돼 있던 기능입니다(유저 검색은 admin 콘솔의 검색창, 관련 활동 필터는 유저 상세
  패널용). `GetUsersDto`에 `search`(email에 대한 대소문자 구분 없는 부분일치, 와일드카드
  이스케이프), `sortBy`(`createdAt`|`email`|`id`, `USER_SORT_FIELDS`로 화이트리스트),
  `order`를 추가해 `GetFilesDto`의 ADR 0021 형태를 그대로 따랐습니다. `UserService.findAll`은
  단순 `findAndCount()` 호출에서 `createQueryBuilder` 조립으로 바뀌었고, 페이지 경계를
  결정적으로 만들기 위해 `id`를 tiebreaker로 덧붙입니다(`role`은 정렬 후보에서 의도적으로
  제외 — 3단계 문자열 enum은 정렬 의미가 약함). `AuditLogQueryDto`에는 `userId`를
  추가했고, `AuditLogService.findAll`은 `actorId = userId`와 `targetId = userId`를
  OR로 묶어(둘 다 주어지면 각 브랜치에 `action`을 AND) "이 계정과 관련된 모든 기록"을
  한쪽만이 아니라 양쪽 다 답하도록 했습니다. 마이그레이션은 없습니다 — `actorId`/`targetId`에는
  아직 전용 인덱스가 없고(엔티티의 유일한 인덱스는 `(action, createdAt)`) 현재 데이터
  규모에서는 무방하다고 판단했습니다; 실제 트래픽이 생기면 인덱스를 추가하면 됩니다. 새
  ADR은 만들지 않았습니다 — 기존 GET /file parity 선례를 따랐습니다.

- **admin 콘솔이 두 필터를 모두 소비하도록 연결** — `admin/src/pages/users-page.tsx`에
  400ms 디바운스가 걸린 이메일 검색창(`search`에 연결)과, 클릭하면 `sortBy`/`order`를
  ▲/▼ 표시와 함께 토글하는 ID/Email/Created 헤더가 추가됐습니다(`role`은
  `USER_SORT_FIELDS`와 마찬가지로 제외). 유저 상세 패널에는 "Recent activity" 절이
  생겼고(`GET /audit-log?userId={id}&take=5`, actor 또는 target), 하단의 "View all →"
  링크가 `logs-page.tsx`로 연결됩니다. `logs-page.tsx`는 이제 자신의 URL에서
  `useSearchParams`로 `?userId=`를 읽어 필터에 반영하며(기존 `action` 필터와 AND) —
  이 백엔드 필터가 없어서 `admin/README.md`에 "근사하지 않고 제거"로 기록됐던 사용자별
  감사 조각이 복원됐습니다. `actionColor`/`AuditLog`는 같은 작업에서
  `dashboard-page.tsx`, `logs-page.tsx`, `users-page.tsx`에서 `admin/src/lib/audit.ts`로
  분리했습니다 — 새 "Recent activity" 절까지 더하면 동일 로직이 네 번째로 중복될
  참이었습니다. `dashboard-page.tsx`는 별도로 file/post 총계 통계 카드를 얻었습니다
  (`GET /file`/`GET /post`를 `take: 1`로 호출해 튜플의 개수만 읽음). `admin/README.md`와
  그 `.ko.md`가 이전에 제거했던 기능이 돌아온 것을 반영하도록 갱신됐습니다. 백엔드
  파일은 건드리지 않았고, 새 ADR도 없습니다 — 위 항목이 이미 도입한 DTO를 admin
  프런트엔드가 소비하는 것뿐입니다.

- **Docker 이미지 arm64 지원 — `bcrypt`는 이미 잘 동작하고, 컴파일이 필요 없음**
  ([ADR 0035](ADR/0035-arm64-bcrypt-source-rebuild.ko.md), [ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md)의
  "bcrypt prebuilt는 전부 x64" 주장을 정정). ADR 0030이 상정했던 Terraform/노드
  그룹 결정이 아니라, 아키텍처를 통일한 단일 멀티플랫폼 이미지를
  (`docker buildx build --platform linux/amd64,linux/arm64`) 배포하려는 목적에서
  시작됐습니다. 조사 과정에서 pnpm 10이 기본적으로 의존성 설치 스크립트를
  차단한다는 사실을 발견했고(`pnpm install` 자체 출력의
  `Ignored build scripts: ... bcrypt` 경고), ADR 0030의 주장과 합쳐져 처음엔
  arm64에서 겹치는 두 가지 문제로 보였습니다 — `package.json`에
  `pnpm.onlyBuiltDependencies: ["bcrypt"]`를 추가해 스크립트 실행을 승인하고
  arm64에서는 `node-gyp` 컴파일로 폴백하게 했고, 이 항목도 원래 그렇게
  적었습니다. **틀렸습니다.** 실제로 돌려보고 나서야 잡았습니다: `docker run
  --platform linux/arm64 node:24.8.0 sh -c "npm install bcrypt"`의 로그엔
  `node-gyp-build` 실행만 있고 컴파일러 출력이 전혀 없으며, 같은 컨테이너 안에서
  `require('bcrypt').hashSync(...)`가 성공합니다. `bcrypt@6.0.0`은 동작하는
  arm64/glibc prebuilt도 번들하고 있고, 이건 스크립트가 아니라
  `node-gyp-build`가 tarball에서 이미 풀린 파일을 읽어 찾아내는 방식이라 —
  pnpm의 스크립트 차단은 어느 아키텍처에서도 bcrypt에 실질적인 위협이 된 적이
  없습니다. `onlyBuiltDependencies`는 `package.json`에 비용 없는 안전장치로
  남겨뒀지만(번들 prebuilt가 없는 미래 버전/플랫폼을 대비), 지금 당장 고치는
  건 아무것도 없습니다. 위의 독립된 arm64 컨테이너 실행으로 검증했고, 이
  Dockerfile 자체의 `pnpm install`로는 아직 검증하지 않았습니다.

### 변경
- **`Dockerfile`/`docker-compose.yml`: 빌드 속도, 이미지 크기, 로컬 dev 튜닝.**
  `pnpm install --frozen-lockfile`가 이제 BuildKit 캐시 마운트
  (`--mount=type=cache,id=pnpm-store,target=/pnpm-store` + `--store-dir /pnpm-store`) 위에서
  실행되어, lockfile 변경으로 레이어 캐시가 무효화되더라도 pnpm의 콘텐츠 주소 저장소(store)는
  유지되므로 의존성이 바뀔 때마다 레지스트리에서 패키지를 전부 다시 받지 않습니다 — 빌드
  전용이며 런타임에는 영향이 없습니다. production 스테이지는 더 이상 `package.json`을
  복사하지 않습니다: `backend/` 어디에서도 런타임에 이를 읽지 않고(`require`/`readFileSync`
  사용처를 grep으로 확인; Swagger 버전은 `main.ts`에 `'1.0'`으로 하드코딩됨) 죽은 파일이었기
  때문입니다. `docker-compose.yml`의 `db`/`api` 서비스는 로그 증가를 제한합니다(`json-file`
  드라이버, `max-size: 10m`, `max-file: 3`) — 기본 드라이버는 크기 제한이 없어 오래 켜두는
  로컬 dev 컨테이너에서 로그가 무한정 쌓일 수 있었습니다. 스테이지 이름을 `build`/`runtime`에서
  `development`/`production`으로 변경했습니다(순수 라벨 변경 — 다른 파일이 `--target`/
  `--from=`으로 기존 별칭을 참조하지 않음을 확인함). distroless/multi-arch와 compose
  `restart` 정책은 검토했지만 적용하지 않았습니다: 전자는 ADR 0030의 미충족 전제조건으로 이미
  보류된 상태이고, 후자는 편의성과 크래시 루프를 조용히 감추는 것 사이의 실질적인 트레이드오프가
  있어 이번에 임의로 결정하지 않았습니다.

### 수정
- **`ARCHITECTURE.md`(.ko): `GET /user` 행이 여전히 검색/정렬 이전의 `findAndCount()`
  호출을 서술하고 있었습니다** — `d889f73`가 이를 `GetUsersDto`/`createQueryBuilder`
  조립으로 대체한 이후 오래된 상태였습니다. 실제
  `take`/`skip`/`search`/`sortBy`/`order` 형태를 서술하도록 갱신했고, `GET /file` 행과
  동일한 형태로 맞췄습니다(ADR 0021 대응). 이 문서의 다른 오래된 서술(RBAC 이전
  `PATCH`/`DELETE /user` 문구, Module Map에서 빠진 Post/Comment/Storage/Health/
  TempCleanup 모듈)은 이번 범위 밖입니다 — CLAUDE.md의 Known Gaps가 이미
  `ARCHITECTURE.md` 전체 감사를 별도 작업으로 추적하고 있습니다.
- **`admin/`: 제네릭한 "Admin Panel" 브랜딩과 `vercel.json`의 죽은 Chat Project CSP
  도메인** — 2026-07-30에 수정 없이 이식됐던 잔재입니다(`admin/README.md` 적응 표의
  "Deploy config" 행이 `vercel.json`을 의도적으로 손대지 않았다고 기록해 둔 부분).
  `index.html`의 `<title>`을 `"Upload Board Admin"`으로 바꾸고, `<head>`에 연결한 새
  `admin/public/favicon.svg`("UB" 이니셜 마크)를 추가했습니다(색상·레이아웃은 그대로).
  `vercel.json`의 CSP `connect-src`는 더 이상 Chat Project의 실제 Railway 배포 주소
  (`https://chat-project-production-3b22.up.railway.app`)를 가리키지 않습니다 —
  `http://localhost:3000`(이 백엔드의 로컬 개발 기본값, `.env.example`의 `BASE_URL`)으로
  교체했으며, 이는 실제 배포 도메인이 아니라 명시적 플레이스홀더입니다: Stage 4가 아직 이
  백엔드를 어디에 호스팅할지 정하지 않았으므로, 정해지면 다시 갱신해야 합니다. 배포
  대상은 여전히 Vercel로 유지하기로 했으나(개발자와 확인함) 실제 배포는 아직 없습니다.
  `admin/README.md`/`.ko.md`에 두 수정을 기록한 "출처 정리" 절이 추가됐습니다.
- **`Dockerfile`: `pnpm prune --prod`가 무한정 멈추는 문제** — 위 캐시 마운트 변경 때문에
  발생했습니다. `pnpm install`에 붙인 `--mount=type=cache`는 그 RUN 명령에만 존재하는데,
  다음 RUN(`pnpm build && pnpm prune --prod`)에는 더 이상 `/pnpm-store`가 없었고,
  `pnpm prune`이 더 이상 읽을 수 없는 store에서 링크된 `node_modules`를 발견하고는
  "처음부터 지우고 재설치할까요? (Y/n)"라는 대화형 프롬프트로 넘어갔습니다. Docker 빌드에는
  표준 입력이 없으므로 이 프롬프트는 영원히 응답을 받지 못하고 빌드가 멈춥니다(네트워크가
  느려서가 아니라 이것이 앞선 검증 빌드가 끝나지 않았던 진짜 이유이며, 그 과정에서 남은
  orphan BuildKit 세션 두 개를 이후 `docker builder prune`으로 정리해야 했습니다).
  `pnpm prune`에는 store 경로를 지정할 `--store-dir` 옵션이 없어서(`pnpm prune --help`로
  확인) 같은 캐시(`id=pnpm-store`)를 build+prune RUN에도 마운트해 두 단계 모두에서 store가
  보이게 하는 방식으로 고쳤습니다. Dockerfile을 읽는 것만으로는 못 잡고, 실제로
  `docker build`를 실행해서야 발견했습니다.
- **`.dockerignore`가 백엔드와 무관한 콘텐츠 약 926MB를 매 빌드마다 조용히 업로드하고
  있었습니다.** `k8s`가 목록에 없어서 `k8s/infra/terraform/.terraform`(923MB —
  Terraform provider 바이너리와 `vpc` 모듈 자체의 중첩 git 클론. 이전 커밋에서
  `.gitignore`에는 이미 추가됐지만, `.dockerignore`는 `.gitignore`를 읽지 않는 별개의
  메커니즘이라 반영되지 않았음)와 `assets/files/sample.mp4`(3MB, Dockerfile에서
  참조하지 않는 README용 데모 파일)가 매번 빌드 컨텍스트에 포함됐고, 플랫폼별로 컨텍스트를
  전송하는 멀티플랫폼 `buildx build`에서는 그만큼 더 낭비됐습니다. 둘 다 이제
  제외했으며, 최상위 항목 전체를 `du -sh`로 재확인해 그 외에 빠뜨린 큰 항목이 없음을
  확인했습니다.

### 추가
- **`frontend/`: Posts를 홈으로 승격, 파일 보드를 `/files`로 이동 — 게시글/댓글 보드 UI를 위한
  라우팅·타입 기반 작업**(백엔드 Stage 3, ADR 0021/0023/0024). `App.tsx`: `/`는 이제
  `PostBoard` 자리표시자를 렌더링하고, `/posts/:id`는 `PostDetailPage` 자리표시자를
  렌더링하며, 기존 파일 보드(업로드 폼 + `FileBoard`)는 `/`에서 `/files`로 옮겼다.
  `/view/:id`는 변경 없음. 새로 만든 `src/shared/NavBar.tsx`(Posts / My Files / Sign out)가
  기존에 `DashboardPage`에만 있던 화면별 헤더를 대체하며, 이제 인증된 모든 화면에 표시된다.
  `src/api/types.ts`에 `PostResponse`/`PostListResponse`/`CommentResponse`/
  `CommentListResponse`를 추가해 백엔드 DTO를 미러링한다.
  `vite.config.ts`의 dev 프록시에 `/post`/`/comment` 항목을 추가했고, `/file`과 `/post`는
  평범한 문자열 prefix 대신 **정규식으로 앵커링**해야 했다(`^/file($|[/?])`,
  `^/post($|[/?])`) — Vite는 문자열 프록시 키를 `url.startsWith()`로 매칭하는데, 그대로
  두면 새 클라이언트 경로인 `/files`, `/posts/:id`가(그리고 첫 시도에서 e2e가 잡아낸
  `/file?…` 형태의 목록 조회 쿼리까지) SPA 라우터가 아니라 곧장 백엔드로 넘어가 버렸다.
  `frontend/docs/API-CONTRACT.md`(+ko)에 `/post`/`/comment` 라우트를 문서화했고,
  `frontend/README.md`/`CLAUDE.md`(해당하는 곳은 +ko)도 함께 갱신했다. 기존 Playwright
  스펙(`auth`/`board`/`upload`/`detail`)을 파일 보드의 새 위치에 맞게 갱신했고, 라우트
  분리와 프록시 수정을 전담 검증하는 `navigation.spec.ts`를 새로 추가했다. 게시글/댓글 보드
  UI 자체(목록, 작성, 상세, 댓글)는 여전히 후속 작업으로 남아 있다 — 이번 변경은 라우팅·타입
  뿐이다.
- **`frontend/`: 게시글 보드 목록 + 작성 UI**(ADR 0021/0023) — 위 라우팅·타입 기반 작업의
  후속 과제다. `PostBoard`(`/`)는 이제 자리표시자가 아니라 `PostForm`과 실제 게시글 목록을
  호스팅한다: `PostForm`은 title/body와, 새로 만든 `FilePicker`(로그인한 사용자 소유 파일만
  검색, `GET /file?creatorId=`)로 고른 선택적 파일을 받아 `POST /post`를 호출한다 — 200
  재생(replay)과 201 신규 생성을 동일하게 처리하며, `POST_FILE_TAKEN`/`FILE_NOT_FOUND`/
  `FORBIDDEN_NOT_OWNER`/`VALIDATION_FAILED`는 각각 자신만의 메시지로 매핑된다. 목록 자체는
  `FileBoard`의 검색/정렬/작성자 필터/페이지네이션 패턴을 `GET /post`에 그대로 재사용하며,
  행마다 첨부파일 아이콘과 `/posts/:id` 링크가 붙는다. `src/api/types.ts`에 새 export
  `CreatePostRequest`를 추가해 `POST /post` 바디를 타입화했다. 새 `posts.spec.ts` e2e
  스펙(텍스트 전용 게시글, 파일 첨부 게시글, `POST_FILE_TAKEN` 충돌 메시지)으로 검증했고,
  `frontend/README.md`(+ko)도 함께 갱신했다. `PostDetailPage`(게시글 상세 + 댓글 스레드)는
  원래 기반 작업에서 남은 유일한 자리표시자로 남아 있다.
- **`frontend/`: 게시글 상세 페이지 + 댓글 스레드**(ADR 0023) — 위 라우팅 기반 작업의 마지막
  퍼즐 조각이다. `PostDetailPage`(`/posts/:id`)는 더 이상 자리표시자가 아니다. `GET /post/:id`로
  게시글을 불러와 title/body/작성자를 보여주고, 첨부파일이 있으면 `FileDetailPage`와 동일한
  visibility 기반 재생 패턴(public/unlisted는 `<video src>` 직접 재생, private는 인증된
  blob+objectURL fetch)을 그대로 따른다. 작성자 본인(또는 서버가 최종 판정하는 admin)에게는
  인라인 제목/본문 수정(`PATCH /post/:id` — `fileId`는 생성 시점에 고정되어 수정 대상이 아님)과
  삭제(`DELETE /post/:id`, 확인 후 홈으로 이동) 버튼이 노출된다. 새 컴포넌트 두 개: `CommentThread`는
  `GET /post/:id/comment`로 목록을 표시한다 — 백엔드가 스레드 순서를 `createdAt ASC`로 고정하고
  정렬 파라미터를 받지 않으므로, 페이징은 prev/next가 아니라 이어붙이는 "더 보기" 버튼이다 —
  그리고 각 댓글의 작성자 본인(또는 admin)에게 인라인 수정/삭제(`PATCH`/`DELETE /comment/:id`)를
  제공한다. `CommentForm`은 새 댓글을 작성하고(`POST /post/:id/comment`) 재fetch를 트리거한다 —
  이 앱에는 실시간/폴링 인프라가 없기 때문이다. `src/api/types.ts`에
  `UpdatePostRequest`/`CreateCommentRequest`/`UpdateCommentRequest`를 추가했다. `posts.spec.ts`의
  상세 페이지 검증과 `navigation.spec.ts`의 자리표시자 텍스트 검증을 모두 실제 화면에 맞게
  갱신했다 — 전체 스위트 22/22 통과. 작업 중 발견한 작은 레이아웃 버그도 함께 고쳤다: 전역 `h1`
  (`index.css`, 56px, 명시적 `line-height` 없음) 때문에 두 줄로 줄바꿈되는 긴 게시글 제목이 바로
  아래 작성자 문단과 시각적으로 겹치는 문제가 있어, 이 페이지의 제목에만 명시적
  `line-height`/하단 margin을 지정해 해결했다.

### 변경
- **ROADMAP Stage 4 재구성 — 배포는 번호 없음, 배포 직전 작업으로 프로덕션 DevOps 스택
  도입 명시**(문서 전용). 배포는 더 이상 실행 번호를 갖지 않는다: 나머지가 모두 만들어지고
  운영 가능해진 뒤 수행하는 전체 계획의 종착 행위이며, 번호를 붙이면 이 계획이 이미 정리한
  Stage 4/Stage 5 순서 혼동을 다시 부를 뿐이라 — 그냥 *마지막 작업*으로 표기하고 Stage 4 표의
  맨 마지막 행에 둔다. 그 직전에 신규 **"프로덕션 DevOps 스택 도입"** 작업을 명시적 이유와 함께
  추가했다: 업계에서 널리 쓰이는 표준 DevOps 툴체인으로, 실무와 유사한 개발·배포·운영 환경을
  경험하고 향후 서비스 확장에 대응하기 위함이다. 스택과 역할: **AWS**(클라우드/배포 대상),
  **Docker**(컨테이너화 — 이미 반영됨, Stage 1, ADR 0015), **Kubernetes**(오케스트레이션),
  **Helm**(릴리스 패키징), **GitHub Actions**(CI/CD — 이미 반영됨, Stage 1, ADR 0016),
  **Prometheus**(메트릭), **Grafana**(대시보드), **Terraform**(IaC); S3(오브젝트 스토리지)는
  스토리지 포트-어댑터의 구체적 형태로, 기존의 독립 "스토리지 포트-어댑터" 행과 "컨테이너·배포
  하드닝" 행을 여기에 흡수했다. `ROADMAP.md`/`.ko.md`(현재 위치, 6절 실행 순번, Stage 4 헤더 +
  표, Stage 5 완료 노트)와 `CLAUDE.md` 로드맵 요약에 반영. 코드·스키마·계획 범위 변경은 없다 —
  남은 Stage 4 작업의 명칭과 순서만 바뀐다.
- **ROADMAP Stage 4에 구성요소별 상태 하위 표 추가**(`#### 프로덕션 DevOps 스택 — 구성요소
  상태`) — 단일 밀집 도입 행을 구성요소별 한 행씩(Docker, GitHub Actions, S3, 헬스/레디니스,
  마이그레이션 분리 단계, Kubernetes, 시크릿 전달, HTTPS 종단, Helm, Prometheus, Grafana,
  Terraform, AWS)으로 펼치고 정확한 상태 범례(✅ 완료 / 🔶 부분 / 📝 설계만 ADR / 🆕 미착수)를
  2026-08-08 기준으로 표기 — 그간 랜딩한 스토리지 포트-어댑터([ADR 0029](ADR/0029-storage-port-adapter.ko.md)),
  컨테이너·배포 하드닝([ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md)–[ADR 0034](ADR/0034-https-termination-stance.ko.md)),
  기본 Kubernetes 매니페스트(`k8s/`)를 반영. 문서 전용.
- **Istio(서비스 메시)를 DevOps 스택에 추가, Terraform 이후 예정** — Stage 4 상태 표에 신규
  🆕 구성요소 행을 추가하고 모든 스택 목록(현재 위치, 6절 실행 순번, Stage 4 헤더 + 도입 행,
  `CLAUDE.md` 요약)에 명시: Kubernetes 클러스터 위의 서비스 메시(트래픽 관리, 워크로드 간
  mTLS, 메시 텔레메트리를 Prometheus/Grafana로)로, Terraform으로 프로비저닝된 클러스터가
  생긴 뒤 도입 — 향후 다중 서비스 확장을 내다본 것. 착수 시 자체 ADR. 문서 전용.

### 제거
- **`frontend/src/features/admin/AdminPage.tsx`와 그 `/admin` 라우트** (ROADMAP Stage 5
  마지막 작업 — 중복 admin 화면 정리) — 아래 콘솔 적응 작업이 이식된 `admin/` 앱의 이식본이
  "대부분 삭제 가능"하지 **않았음**을 보여줬다: 삭제 가능했던 건 채팅 도메인 잔재뿐이고,
  ADR 0022가 이 콘솔을 이식한 이유 그 자체였던 역할 관리 본체는 실제 라우트에 맞게 깔끔하게
  적응됐다. 이것이 ADR 0022가 미뤄뒀던 선택에 답을 준다 — `admin/`을 유일한 admin 화면으로
  둔다. 그래서 [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)이 라우트를
  예약해 둔 이래 변하지 않은, 자체 백엔드 호출이 전혀 없는 이 17줄짜리 stub은 구현되지 않고
  삭제된다. ADR 0010의 admin 배치 조항을 한 번 더 개정한다 — admin은 이제 `frontend/` 안의
  라우트 구역조차 아니다. 해소 내용은 [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)의
  2026-08-06 추가 기록에 남겼다. 백엔드 파일은 건드리지 않았다; `frontend/CLAUDE.md`의 Admin
  항목도 맞춰 갱신했다. **Stage 5가 이제 완료됐다 — 네 행 모두 끝났다.**

### 추가
- **컨테이너/배포 하드닝 — non-root 이미지, liveness/readiness 엔드포인트,
  마이그레이션의 별도 배포 스텝 분리** ([ADR 0030](ADR/0030-container-non-root-and-arch-stance.ko.md)–
  [ADR 0034](ADR/0034-https-termination-stance.ko.md), [ADR 0015](ADR/0015-docker-and-compose.ko.md)
  개정; ADR 0015가 미뤘던 컨테이너/배포 하드닝, ROADMAP Stage 4 production DevOps stack
  introduction의 일부) — 런타임 이미지는 이제 `CMD` 전에 전용 non-root 사용자(uid/gid
  1001)를 만들고 그 계정으로 전환하며, 새 `GET /health/live`를 호출하는 `HEALTHCHECK`
  지시문을 갖는다(ADR 0030). 새로운 운영용 `HealthModule`(`backend/health/`,
  `TempCleanupModule` 선례를 따름)이 `GET /health/live`(의존성 체크 없이 항상 200)와
  `GET /health/ready`(`DataSource.query('SELECT 1')`로 DB를 ping, 실패 시
  `ServiceUnavailableException`으로 503)를 추가한다 — kubelet/LB 프로브는 Bearer
  토큰을 들고 오지 않으므로 둘 다 설계상 인증 없음(ADR 0031); `backend/app.module.ts`에
  import 한 줄이 추가됐다. `Dockerfile`의 `CMD`는 더 이상 `migration:run`을 실행하지
  않는다 — 대신 `docker-compose.yml`에 이를 실행하는 one-shot `migrate` 서비스가
  추가됐고, `api`는 이제 `migrate: condition: service_completed_successfully`에
  의존해서, 스케일된 `api`가 같은 데이터베이스에 대해 `migration:run`을 경합하는
  일이 구조적으로 없어졌다(ADR 0032). 나머지 두 하드닝 항목은 **설계만 하고 코드
  변경은 없는 ADR**로 남았다: 목표 시크릿 전달 메커니즘은 환경변수로 마운트되는
  네이티브 Kubernetes `Secret`이고, AWS Secrets Manager를 도입한다면 External
  Secrets Operator를 통해 그 상류에 둔다 — 실제 AWS 계정과 아직 존재하지 않는 IAM
  롤이 필요해 Terraform 작업으로 미룬다(ADR 0033); TLS 종단은 Node 프로세스 안이
  아니라 ingress/ALB 레이어에서 하기로 못박았다 — 기존 `secure: ENV === 'prod'`
  refresh 쿠키 게이트(ADR 0012)는 이미 이를 전제하고 있어 코드 변경이 필요 없다
  (ADR 0034). distroless와 멀티아치 빌드는 검토했지만 명시적으로 보류했다(ADR
  0030) — Node 24 distroless 태그가 실제로 존재하는지 검증되지 않았고, 컨테이너의
  쉘을 잃는 것을 대체할 K8s ephemeral-debug-container가 아직 없다 — ROADMAP.md >
  Unscheduled에 기록. `README.md`의 Docker 섹션과 API Endpoints 목록, `ADR/README.md`를
  맞춰 갱신했다; `ARCHITECTURE.md`는 의도적으로 손대지 않았다(CLAUDE.md > Known Gaps에
  이미 별도의 미착수 문서 감사 작업으로 표시돼 있고, 이번 변경이 그 문서가 지금
  서술하는 어떤 내용도 건드리지 않기 때문이다).
- **스토리지 포트-어댑터 — `FileStorage` 인터페이스, `LocalDiskStorage` + `S3Storage`
  어댑터** ([ADR 0029](ADR/0029-storage-port-adapter.ko.md), [ADR 0005](ADR/0005-local-disk-storage.ko.md)
  개정; ROADMAP Stage 4 클라우드 네이티브 인프라 과제의 코드 선행 조각) — 물리 파일
  조작(`saveTemp`, `existsTemp`, `promote`, `stat`, `createReadStream`, `unlink`,
  `listTemp`)이 이제 `FileStorage` 포트(`backend/storage/`)를 거친다. 부팅 시
  `STORAGE_DRIVER`(`'local'` 기본값 | `'s3'`, Joi 검증, `S3_BUCKET`/`AWS_REGION`은
  `s3`일 때만 필수)로 선택한다. `LocalDiskStorage`는 ADR 0005의 디스크 동작을 그대로
  이식했다(temp_/granted_ 상태머신, Range/206/416 스트리밍, 가드가 있는 배치 unlink —
  폐기된 `backend/common/unlink-stored-files.ts`가 이 안으로 흡수됐다). `S3Storage`는
  ISP가 요구하는 두 번째 구현체로, 모킹된 `@aws-sdk/client-s3` 클라이언트(Apache-2.0)에
  대한 단위 테스트로만 검증됐다 — 실제 버킷에 실행된 적은 없다. `UploadModule`의
  Multer는 `diskStorage`에서 `memoryStorage`로 바뀌었고, 버퍼링된 업로드를 포트로
  밀어 넣는 얇은 `UploadService.stageTemp`를 새로 얻었다 — `STORAGE_DRIVER=s3`가
  ADR 0005가 기록해 둔 다중 인스턴스 격차를 승격된 파일 쪽 절반만이 아니라 temp 쓰기
  쪽까지 실제로 닫기 위한 전제조건이다. `FileService`, `FileContentController`,
  `UserService`의 계정 삭제 연쇄, `TempCleanupService`의 고아 스윕(ADR 0018) 모두
  이제 `fs`/`fs/promises`를 직접 쓰는 대신 주입된 `FILE_STORAGE` 토큰을 통해
  읽고 쓴다. `local`이 여전히 기본값이다; 스키마 변경도 API 표면 변경도 없다.
- **`admin/` 콘솔을 이 백엔드의 실제 라우트에 맞게 적응 — 역할 관리 조각**
  (ROADMAP Stage 5 네 번째 작업; [ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)의
  검증된 백로그를 작업 지시서로 삼음, 아래 액세스 토큰 `role` 클레임으로 막힘이 풀림) —
  이식된 Chat Project 콘솔은 숫자 2단계 역할, 페이지네이션 없는 검색/정렬/상태 사용자
  목록, `userId`/날짜 범위/CSV 감사 로그 필터, `ban`/`unban`/`force-logout` 액션을
  대상으로 했는데, 이 API에는 그중 어느 것도 없다. `auth.store.ts`의 `role`은 이제
  문자열 `UserRole`(`'user' | 'admin' | 'superadmin'`)이며 새 액세스 토큰 클레임에서
  디코드된다; `ROLE_RANK`/`ROLE_LABEL` 조회표(`admin/src/auth/role.ts`, 신규)가 모든
  숫자 등급 비교를 대체한다. 역할 변경 컨트롤은 이식된 이진 토글이 아니라 3단계
  `<select>`(user/admin/superadmin)다 — 콘솔이 계층 전체를 조작할 수 있도록 이렇게
  선택했다(ADR 0022가 명시한 콘솔의 목적), actor가 superadmin일 때만, 본인 행과 다른
  superadmin 행을 포함한 모든 행에 렌더링한다(`PATCH /user/:id/role`이 실제로 허용하는
  범위와 일치 — 대상 등급에 상한이 없고 마지막 superadmin 강등만 거부, 400
  `AUTH_LAST_SUPERADMIN`을 자체 메시지로 분기). `users-page.tsx`와 `logs-page.tsx`는
  `GetUsersDto`/`AuditLogQueryDto`가 실제로 반환하는 `take`/`skip`과 `[data, total]`
  튜플을 읽고, 삭제·역할 변경 에러는 동결된 `{ code, message }` 계약으로 분기한다
  (`AUTH_LAST_SUPERADMIN`, 파일 개수를 보여주고 `?deleteFiles=true`로 재시도하기 전
  재확인하는 `USER_HAS_FILES`, `USER_FILES_IN_USE`, 그리고 Delete 버튼의 표시 규칙을
  연결하던 중 이번 작업이 발견한, 같은 날 닫힌 권한 역전 방지 가드에 해당하는
  `FORBIDDEN`). 사용자별 감사 로그 패널은 **근사하지 않고 제거했다** —
  `AuditLogQueryDto`에는 `userId` 필터가 없고, 필터 없는 페이지를 클라이언트에서
  걸러내면 실제 활동이 그 페이지를 넘어설 때 사용자의 오래된 항목을 조용히 빠뜨리게
  된다. 채팅 도메인 화면(`rooms-page.tsx`, `api/apollo.ts`, `api/graphql-operations.ts`,
  `/rooms` 라우트, `main.tsx`의 `ApolloProvider`)은 이 API에 대응물이 없어 통째로
  삭제했고, `@apollo/client`/`graphql`/`rxjs`도 `package.json`에서 함께 뺐다;
  `POST /user/:id/ban|unban|force-logout`과 그 감사 로그 색상도 같은 방식으로
  삭제하며 Stage 5의 모더레이션 존재 여부 행을 "아니오"로 결론지었다.
  `e2e/seed-superadmin.mjs`의 SQL은 이제 문자열 `'superadmin'`을 넣는다(기존
  `role=2, "isAI"=false` — `isAI`는 `UserEntity`의 컬럼이 아니다), `.env` 탐색 경로도
  실제 루트 `.env`를 가리킨다. 백엔드 파일은 건드리지 않았다. 결함별 전체 대응표와
  진행 중 내린 두 가지 판단(감사 패널 제거; 이진 토글 대신 3단계 select):
  `admin/README.ko.md` > "무엇을 적응시켰는가". 두 admin 화면 중 무엇이 살아남을지
  (이 콘솔 대 `frontend/src/features/admin/AdminPage.tsx`)는 Stage 5의 유일하게 남은
  행이다.

### 수정
- **`PATCH`/`DELETE /user/:id`의 권한 역전 취약점** — `UserController`는 행위자가 `admin`
  이상 등급인지만 확인했을 뿐, *대상* 계정의 등급과는 비교하지 않았다. `admin`과
  `superadmin` 둘 다 일반 `user`보다 높은 등급이라는 점만으로는 충분하지 않았는데 두
  핸들러 모두 그 이상을 보지 않았기 때문에, admin이 다른 admin이나 심지어 superadmin을
  수정·삭제할 수 있었다. admin 콘솔의 Delete 버튼 표시 규칙을 실제 `{ code, message }`
  계약에 맞춰 연결하던 중(위 항목) 발견했다. `UserService.update`와 `UserService.remove`는
  이제 대상 id와 함께 행위자의 role도 받아, (이미 존재 확인용으로 필요했던) 대상 행을
  로드하고, 행위자가 동급 이상 등급의 상대에게 작용하려 할 때 403 `FORBIDDEN`으로
  거부한다 — 본인에 대한 작업은 role과 무관하게 계속 허용된다. 이 판단은 `UserController`에서
  서비스 쪽으로 옮겨졌다 — 서비스가 이미 대상 엔티티를 로드하므로 컨트롤러가 같은 검사를
  중복으로 갖고 있을 필요가 없다. 스키마 변경 없음, 새 에러 코드 없음(`FORBIDDEN`은 이번
  수정 이전부터 있었다), 마이그레이션 없음; `admin/README.ko.md` > "무엇을 적응시켰는가"가
  콘솔 Delete 버튼 규칙을 위해 이 제약을 문서화한다.

### 추가
- **액세스 토큰에 `role` 클레임 추가** (ROADMAP 실행순서 #3, Stage 5의 막고 있던 첫 행,
  [ADR 0028](ADR/0028-access-token-role-claim.ko.md); [ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)
  개정) — ADR 0022의 수정 백로그가 기록한 공백을 닫는다: 이식된 `admin/` 콘솔은
  `jwtDecode<{ sub, role }>(accessToken)`을 디코드해 자기 라우트를 게이팅하는데, 이 API의
  액세스 토큰 payload는 `{ sub, type }`뿐이라 `role`이 없어 콘솔이 모든 admin을 거부하고
  있었다. `Payload`(`backend/auth/interface/payload-interface.ts`)는 선택적 `role?: UserRole`을
  얻으며 액세스 토큰에만 채운다(리프레시 토큰은 기존 최소 형태 유지); `AuthService.issueToken`과
  `issueTokenPair`는 `Pick<UserEntity, 'id'>`에서 `Pick<UserEntity, 'id' | 'role'>`로 넓어졌다.
  요청 기반 조회(`GET /user/:id` 또는 신규 `GET /auth/me`) 대신 이 형태를 고른 이유는 이미
  실전에 있는 패턴과 맞기 때문이다 — 프론트엔드는 이미 액세스 토큰을 클라이언트 측에서 디코드해
  `sub`을 읽고 있다 — 그리고 앱 로드나 조용한 재발급마다 왕복이 추가되지 않는다. **서버 측 강제에는
  변경이 없다**: `RolesGuard`/`AuthUser`는 여전히 `JwtStrategy.validate`의 매 요청 실시간 DB
  조회에서 role을 얻지, 토큰 payload에서 얻지 않는다 — 그래서 강등 후 낡은 클레임(액세스 토큰
  TTL로 한정, 로컬 180초)은 클라이언트 UI만 잠깐 어긋나게 할 뿐 검사를 우회하지 못한다. 스키마
  변경, 마이그레이션, 새 엔드포인트, 새 에러 코드 모두 없음.
- **`GET /user` 페이지네이션** (실행순서 #2, [Stage 5](ROADMAP.ko.md#stage-5--운영-화면-admin-콘솔--2026-07-30-추가)에서
  앞당김) — `UserController.findAll`은 `@Query()`를 전혀 받지 않았고, `UserService.findAll()`은
  단순 `findAndCount()`로 전체 행을 반환하고 있었다 — admin 콘솔과 무관하게 갚아야 할 Never Do
  Group 2 위반. 새 `GetUsersDto`(`backend/user/dto/get-users.dto.ts`)는 `GetFilesDto`의
  `take`(1–100, 기본 20)/`skip`(≥0, 기본 0) 경계를 그대로 미러한다([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)
  패턴 재사용, 별도 ADR 불필요). 응답은 기존 `[rows, total]` 튜플 형태를 유지한다 — `findAll()`이
  이미 `findAndCount()` 튜플을 반환하고 있었으므로 이번 변경은 순수 페이지네이션 적용이지 계약
  변경이 아니다 — `GET /file`과 형태를 맞춰 두 목록 엔드포인트의 일관성을 유지한다. 정렬은
  `createdAt DESC, id DESC`(타이브레이커, `GET /file`과 동일)로 내부 고정해 페이지 경계를
  결정적으로 만든다. 검색/정렬은 이번 범위에서 쿼리 파라미터로 노출하지 않는다 — ROADMAP 항목명이
  페이지네이션만 지칭하며, 검색/정렬이 실제로 필요해지면 Stage 5 admin 콘솔 작업에서 열어둔다.
  admin 전용 가드(`RolesGuard` + `@Roles(admin)`)와 `ClassSerializerInterceptor`(password·
  `refreshTokenHash` 제외)는 변경 없음. 스키마 변경, 새 에러 코드, 마이그레이션 없음.
- **파일 가시성 + 미디어 타입 확장 — 설계 게이트, 아직 코드 없음**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)) — 프로젝트의 네 창립 목표를
  다시 정리하니 의도와 실제 코드 사이 공백 둘이 드러났다: 저장된 모든 파일이 공개로만 서빙되어
  비공개/링크공유 선택지가 없고, 업로드 허용 목록이 영상 전용이다. 결정(마이그레이션에 앞선
  평문 게이트, Scope Discipline)은 3-상태 `FileEntity.visibility`(`public`/`private`/`unlisted`,
  **기본 `private`**), 상태별 접근을 강제하는 접근 제어 `GET /file/:id/content` 엔드포인트 —
  그래서 `ServeStaticModule`이 **`file/upload` 노출을 중단**한다(비공개 파일의 바이트가
  `granted_` 경로로 여전히 닿으면 안 된다) —, **회전 가능한** `shareToken`을 통한 `unlisted`
  공유(회전은 서명 URL이 못 주는 유출 대응 수단)에 **선택적** TTL `shareExpiresAt`(기본: 만료
  없음)을 더하고, 허용 미디어를 이미지(jpg/png/webp)+오디오(mp3)+영상(mp4/mov/webm)으로,
  단일 `video` 필드를 **타입별 업로드 필드**(`image`/`audio`/`video`)로 교체해 확장한다.
  [ADR 0005](ADR/0005-local-disk-storage.ko.md)(서빙)와
  [ADR 0003](ADR/0003-two-phase-upload-contract.ko.md)/[ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)
  (업로드 필드 — 이제 소비자 0명이던 Stage F 동결과 달리 **살아 있는 `frontend/` 소비자에 대한
  breaking 변경**)을 부분 개정한다. **ROADMAP Stage 4의 "VOD 재생 접근 제어" 행을 일반화하며
  대체**하고, 배포 대상과 독립적이므로 배포보다 앞당길 수 있다. 이 항목에서는 스키마 변경도
  마이그레이션도 라우트도 착지하지 않는다 — 검토된 마이그레이션과 프론트엔드 반영은 각자의
  후속 과제다(후자는 [ROADMAP.ko.md](ROADMAP.ko.md) > 미배정에서 추적).
- **파일 가시성 + 접근 제어 콘텐츠 엔드포인트 — 구현 완료**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md) D1/D2/D3/D6 +
  [ADR 0026](ADR/0026-file-visibility-implementation.ko.md)) — 위 설계 게이트가 미디어 타입
  확장(D4/D5, 여전히 별도 미착수 과제)을 제외하고 모두 착지했다. `FileEntity`는
  `visibility`(`public`/`private`/`unlisted`, 기본 `private`), `shareToken`,
  `shareExpiresAt`을 얻는다(마이그레이션 `1785571437643-AddFileVisibility`, `migration:generate`
  원본 출력과 라인 단위로 대조 검토). `GET /file/:id/content`가 granted 바이트를 서빙하는 유일한
  경로다 — Range 지원(영상/오디오 탐색)이고, 새 `OptionalJwtAuthGuard`로 가드해 public/unlisted
  접근이 bearer 토큰 없이도 동작한다 — D2의 열린 하위 결정을 병행 public 정적 디렉터리 대신 단일
  엔드포인트로 확정했다. `ServeStaticModule`은 이제 `file/temp`만 루트로 삼으며, `file/upload`는
  더 이상 정적으로 노출되지 않는다. `GET /file`·`GET /file/:id`도 비소유자·비admin 요청자에게
  `private`/`unlisted` 행을 필터링한다(ADR 0025 본문이 전혀 다루지 않은 공백이었고, ADR 0026
  D7로 확정) — 콘텐츠와 메타데이터는 의도적으로 서로 다르게 접근 거부를 알린다(ADR 0026 D8):
  메타데이터는 404 `FILE_NOT_FOUND`(존재를 숨김), 콘텐츠는 403 `FORBIDDEN_NOT_OWNER` 또는 403
  `FILE_SHARE_INVALID`(존재는 확인해 주되 바이트만 거부)로 답한다. 가시성 토글과 공유 토큰
  회전은 새 엔드포인트 대신 기존 `PATCH /file/:id` 쓰기 경로를 재사용한다.
  `FileResponseDto.fileUrl`은 이제 정적 경로 대신 콘텐츠 엔드포인트를 가리키고, `visibility`
  필드는 항상 존재하며, `shareUrl`은 unlisted 파일을 관리할 수 있는 응답자에게만 존재한다. 새
  에러 코드 `FILE_SHARE_INVALID`(403). 테스트 커버리지: 가시성 접근 매트릭스 전체
  (public/private/unlisted × owner/stranger/anonymous/admin), 토큰 회전이 이전 링크를
  무효화하는지, TTL 만료, Range 요청까지 — 유닛(`file.service.spec.ts`)과 실제 HTTP+DB e2e
  (`test/app.e2e-spec.ts`) 양쪽에서 검증했다.
- **미디어 타입 확장 — 타입별 업로드 필드 구현 완료**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md) D4/D5 +
  [ADR 0027](ADR/0027-media-type-expansion-implementation.ko.md)) — 설계 게이트의 나머지
  절반이다. `POST /upload/attach`는 이제 세 멀티파트 필드 중 하나를 받는다 — `image`
  (jpg/jpeg/png/webp), `audio`(mp3), `video`(mp4/mov/webm, 변경 없음) — 각각 자신만의 클래스
  허용 목록을 가지며, `FileFieldsInterceptor`와 `file.fieldname`으로 분기하는 공유
  `fileFilter`로 구현했다. 필드를 하나도 첨부하지 않으면 여전히 400 `UPLOAD_FILE_REQUIRED`이고,
  둘 이상 첨부하면 새 400 `UPLOAD_MULTIPLE_FIELDS`다. `TEMP_FILENAME_PATTERN`
  (`create-uploadFile.dto.ts`)과 `CONTENT_TYPE_BY_EXTENSION`(`file-content.controller.ts`) —
  둘 다 필드가 아니라 확장자로 판단한다 — 을 함께 넓혀서 `POST /file` 승격과
  `GET /file/:id/content` 서빙이 새 클래스에서도 올바르게 동작한다. 스키마 변경은 없다. ADR
  0025 D5가 이미 예고한 대로 살아 있는 `frontend/` 소비자에 대한 breaking 변경이며, 프론트엔드
  반영은 여전히 별도 과제로 남는다. 테스트 커버리지: 이미지·오디오 왕복(첨부 → 승격 → 콘텐츠
  `Content-Type`), 필드에 맞지 않는 타입 거부, 필드 두 개 동시 첨부 거부를
  `test/app.e2e-spec.ts`에 추가했다. 기존 `video` 필드 e2e 케이스는 수정 없이 그대로
  통과한다.
- **파일 가시성 + 미디어 타입 확장의 프론트엔드 반영**
  ([ADR 0025](ADR/0025-file-visibility-and-media-expansion.ko.md)/
  [0026](ADR/0026-file-visibility-implementation.ko.md)/
  [0027](ADR/0027-media-type-expansion-implementation.ko.md)) — 위 백엔드 항목 둘이 남긴
  breaking-change 공백을 닫는다([ROADMAP.md](ROADMAP.md) > 미배정). 파일 보드
  (`frontend/src/features/files/FileBoard.tsx`)는 `GET /file`의 ADR 0021 쿼리 표면
  전체(디바운스된 검색, 정렬 필드/순서, 작성자 ID 필터, 페이지네이션)와 행마다
  `VisibilityBadge`를 얻는다. `FileDetailPage`(`/view/:id`)는 `fileUrl`을 접근 제어된
  콘텐츠 엔드포인트로 읽는다: `public`/`unlisted` 파일은 `<video src>` 직접 재생으로
  스트리밍하고(Range 기반 탐색 유지), `private` 파일은 인증된 Blob으로 가져와 언마운트 시
  해제되는 objectURL로 재생한다(일반 `<video src>`는 Bearer 헤더를 실을 수 없기 때문).
  작성자/admin에게만 보이는 "Manage" 섹션(클라이언트 측 힌트일 뿐 — 모든 쓰기는 서버에서
  다시 검사된다)은 visibility 토글과 unlisted 공유 토큰 회전을 기존 `PATCH /file/:id`
  하나로 처리하며(새 엔드포인트 없음, ADR 0025 D3), 게시글이 참조 중이면 `FILE_IN_USE`를
  드러내는 확인형 `DELETE /file/:id`도 추가했다. `UploadForm`은 단일 `video` 필드를
  백엔드의 필드별 허용 목록을 미러링하는 라디오 선택형 `image`/`audio`/`video` 필드로
  교체하고, 새 `api.postFormWithProgress`(`XMLHttpRequest` 기반 — `fetch`는 업로드 진행률
  이벤트를 제공하지 않기 때문. ADR 0025/0026/0027이 요구하지 않은 이 항목만의 추가 사항)로
  업로드 진행률 표시를 얻는다. `frontend/docs/API-CONTRACT.md`는 이미 목표 계약을
  문서화하고 있었다. 백엔드 변경은 없다.
- **게시판 comment 모듈 — 게시판 도메인 완성**
  ([ADR 0023](ADR/0023-board-domain-schema.ko.md) > 구현 노트) — 스키마 게이트의 후반부이며,
  이로써 **Stage 3**도 완결됐다. `CommentModule`은 ADR이 정한 네 라우트를 `JwtAuthGuard` 뒤에
  두되 **컨트롤러 두 개**로 나눴다. 접두사가 둘로 갈리기 때문이다: 스레드는 글에 매달리고
  (`GET`/`POST /post/:postId/comment`), 이미 존재하는 댓글은 자기 id로 지목된다
  (`PATCH`/`DELETE /comment/:id`). 새 `comment_entity`는 `body`(`text`, DTO에서 ≤1,000으로 제한),
  `creatorId` FK, 그리고 **이 스키마의 유일한 `ON DELETE CASCADE`** 를 가진 `postId` FK로 이뤄진다 —
  당연시한 게 아니라 ADR 0023 D3에서 근거를 밝혔다. 댓글에는 URL도 파일도 없고 글 밖에서는 존재하지
  않으므로, 행을 지우기 전에 읽어야 할 것이 없다. `IDX_comment_entity_postId_createdAt`은 이 테이블의
  유일한 조회 형태를 받쳐 준다. 마이그레이션은
  [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)이 요구하는 대로 라인단위로
  검토했다 — `generate`가 제약 이름 변경 6문장을 뱉었고, 전부 걷어내고 읽을 수 있는 이름을 썼다.
  **스레드는 오래된 순으로 읽는다**(`createdAt ASC` + `id` tiebreaker). 최신순인 파일·게시글 목록과
  반대이며, 정렬은 파라미터로 열지 않고 고정했다. 소유권은 `canManage`(작성자 **또는** admin+)를 그대로
  쓰되 **세 번째 축은 없다**: 글 작성자는 자기 글의 댓글에 아무 권한도 얻지 못한다. 그러려면 이 프로젝트가
  금지하는 `comment.post.creator` reach-through가 필요하기 때문이다. `COMMENT_NOT_FOUND`와
  `COMMENT_DELETE` 감사 액션은 소비자와 함께 들어왔다. 완화하지 않고 그대로 지킨 결정이 둘 있다 —
  `POST` 재제출은 두 번째 댓글을 만들고(행에 유니크한 것이 없어 자연 멱등 키가 없으며, `fileId` 없는
  글과 정확히 같다), `USER_DELETE` 감사 detail에는 `comments=N`을 **넣지 않았다**(연쇄분을 셀 수 없어
  반쪽 집계가 총계처럼 읽히기 때문이다).
- **프론트엔드 Playwright E2E 스펙 — auth, upload, board** — `frontend/e2e/`에 기존
  하네스/스모크 테스트(`playwright.config.ts`, `smoke.spec.ts`) 외에 세 개의 스펙이
  추가되었다: `auth.spec.ts`(LoginPage를 통한 회원가입→로그인→로그아웃,
  `AUTH_EMAIL_TAKEN`/`AUTH_INVALID_CREDENTIALS` 에러 코드 분기 포함), `upload.spec.ts`
  (실제 파일 인풋을 통한 `POST /upload/attach` → `POST /file` 2단계 플로우, 중복 제목 시
  `FILE_TITLE_TAKEN` 포함), `board.spec.ts`(직접 업로드한 파일을 대상으로 한 FileBoard의
  검색/정렬/작성자 필터/페이지네이션, 기본값 `private` visibility 배지 포함). `:5173`의
  Vite 프록시가 바라보는 공유 dev DB는(백엔드 전용 e2e DB와 달리) truncate되지 않으므로,
  매 스펙 실행마다 유니크한 계정(과 유니크한 제목)을 새로 만든다. 모든 어서션은 백엔드의
  원문 `message`가 아니라 앱 자체가 코드로 매핑한 고정 문자열(`messageForError`)을
  기준으로 분기하며, 이는 `docs/API-CONTRACT.md`의 "code로 분기하라" 규칙과 일치한다.
  실제 mp4 파일(`assets/files/sample.mp4`을 복사)이 `frontend/e2e/fixtures/sample.mp4`에
  있다. 작성 과정에서 Playwright의 두 가지 함정을 발견해 `frontend/CLAUDE.md`에 기록해
  두었다 — `<input type="file">`에 동일한 경로를 연속으로 재설정해도 `change` 이벤트가
  안정적으로 발생하지 않는 문제(입력을 먼저 비운 뒤 재설정해 해결), `getByLabel`/
  `getByRole`의 기본 substring + 대소문자 무시 매칭이 이 앱의 마크업과 충돌하는 문제
  (`<label>` 안에 중첩된 `<select>`의 옵션 텍스트가 라벨의 접근성 이름에 섞여 들어가고,
  흔한 단어를 포함한 테스트용 이메일이 엉뚱한 버튼과 매칭됨 — 해당 쿼리에
  `{ exact: true }`를 붙여 해결). 백엔드나 앱 코드 변경은 없다.
- **프론트엔드 Playwright E2E 스펙 — 파일 상세 페이지** — `frontend/e2e/detail.spec.ts`가 `/view/:id`
  (`FileDetailPage`)를 엔드투엔드로 검증한다: private 파일의 인증된 blob 재생과, 그 objectURL이
  다른 페이지로 이동할 때 실제로 해제되는지(`URL.revokeObjectURL`을 `page.addInitScript`로 스파이해
  확인); `public`/`unlisted`로 전환한 뒤 콘텐츠 엔드포인트가 Bearer 토큰도 쿠키도 없이 응답하는지를,
  page의 쿠키나 메모리 속 액세스 토큰과 전혀 무관한 Playwright의 순수 `request` 픽스처로 확인;
  unlisted 공유 토큰을 회전한 뒤 이전 토큰은 403 `FILE_SHARE_INVALID`로 거절되고 새 토큰은 여전히
  재생되는지; 남의 private 파일에 대한 타인의 `/view/:id` 접근이 404 `FILE_NOT_FOUND`로 응답해
  존재 자체를 숨기면서(ADR 0026 D8) Manage 섹션도 렌더링하지 않는지; 그리고 게시글이 참조 중인
  파일의 `DELETE /file/:id`가 `FILE_IN_USE`로 거절되었다가(프론트엔드에 아직 게시글 UI가 없어
  백엔드 API로 직접 붙인 테스트 준비물) 그 게시글을 지우면 성공해 목록에서 사라지는지를 검증한다.
  백엔드 변경은 없다.

### 수정
- **`api.delete`의 성공 경로가 `DELETE /file/:id`의 순수 텍스트 본문에서 예외를 던지던 문제** —
  `frontend/src/api/client.ts`의 공용 `request()`가 204가 아닌 2xx 응답이면 무조건
  `response.json()`을 호출했는데, `DELETE /file/:id`는 `200 text/html`에 순수 문자열
  (`File ${id} deleted.`)을 응답하므로 파싱이 `SyntaxError`로 깨졌다. `FileDetailPage.handleDelete`의
  catch는 이를 일반 실패로 오인해 "Network error. Is the backend running?"를 보여줬고, 그 결과
  백엔드는 이미 파일을 지웠는데도 화면은 목록으로 이동하지 않았다. `detail.spec.ts`의 삭제 플로우
  어서션을 작성하다 발견했다. 이제 `request()`는 응답의 `Content-Type`이 JSON일 때만 파싱하고, 그
  외에는 (기존 204 처리와 동일하게) `undefined`를 반환한다 — `api.delete`를 호출하는 곳 중 반환값을
  쓰는 곳이 없어 다른 JSON 응답 엔드포인트의 동작에는 영향이 없는 순수 버그 수정이다. 백엔드 변경은
  없다 — 삭제에 순수 텍스트 200을 응답하는 백엔드 동작 자체는 그대로다.

### 변경
- **계정 연쇄 삭제가 이제 댓글 → 게시글 → 파일 순서로 지운다**
  ([ADR 0023](ADR/0023-board-domain-schema.ko.md) D5) — `UserService.remove`가 기존
  `dataSource.transaction()` 안에서 그 계정의 댓글을 *어디에 달렸든* `creatorId` 기준으로 게시글보다
  먼저 지운다. 이 순서가 핵심이다: 그 계정이 **남의** 글에 단 댓글은 게시글 FK 연쇄로 닿지 않는데,
  그 연쇄는 소유 게시글이 삭제될 때만 발동하기 때문이다. 자기 글에 남은 댓글은 여전히 그 연쇄가
  가져간다. 확인 플래그는 추가하지 않았다 — `deleteFiles`는 계속 미디어 바이트만 지킨다.
  `PostService.assertPostExists`를 추가해, `CommentService`가 `post_entity`를 직접 조회하지 않고도
  없는 글에 달린 댓글을 404 `POST_NOT_FOUND`로 거절할 수 있게 했다(Tell Don't Ask —
  `FileService.assertAttachableBy`와 같은 형태다).

### 수정
- **계정 연쇄 삭제가 FK 위반 500 대신 409 `USER_FILES_IN_USE`로 답한다**
  ([ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)) — 하루 전 post 모듈이 남긴 알려진
  문제를 닫았고, comment 모듈이 기다리던 게이트를 해제했다. `PATCH /file/:id { userId }`는
  `FileService.assertAttachableBy`가 생성 시점에 강제한 ADR 0023 D1의 같은-작성자 규칙 *이후에*
  파일 소유자를 바꿀 수 있어, 게시글이 남의 파일을 참조하는 상태가 만들어진다. 그러면
  `DELETE /user/:id?deleteFiles=true`가 트랜잭션 안에서 `23503`을 내고,
  [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)이 없애려던 바로 그 불투명한 500으로
  드러났다. 이제 `FileService.deleteFilesOfCreator`가 그 `23503`을 형제 메서드 `deleteFile`이
  `FILE_IN_USE`에 대해 이미 하던 방식 그대로 번역한다 — 파일 행을 지우는 두 경로가 파일 행을
  소유한 클래스 안에서 참조를 같은 방식으로 처리한다. **사전 조회는 하지 않는다.**
  [ADR 0023](ADR/0023-board-domain-schema.ko.md) D4가 세운 두 이유 그대로다: `FileService`가
  `post_entity`를 읽으면 모듈 순환이고, 확인과 삭제 사이에 생성된 게시글은 여전히 제약에 걸린다.
  나머지 두 후보는 기각을 기록으로 남겼다 — 연쇄 확대는 제3자의 게시글을 파괴하는 데다 comment
  과제가 확장할 삭제 순서까지 다시 쓰게 만들고, 복합 FK(`file_entity`의 `UNIQUE (id, creatorId)`를
  `post_entity`가 참조)는 이 성질이 *보장*으로 필요해질 때만 채택할 형태로 해당 ADR에 적어 두었다.
  새 에러 코드는 하나, `USER_FILES_IN_USE`(409)이며 같은 라우트의 `USER_HAS_FILES`와 대칭이다.
  스키마 변경도 마이그레이션도 없다. **의도적으로 두 가지는 그대로 둔다**: post↔file 규칙은 이제
  불변식이 아니라 생성 시점 규칙이고, `PostService.resolveAttachment`의 작성자 동일성 확인은 여전히
  도달 가능하므로 정리해 없애면 안 된다. 이 ADR을 쓰는 과정에서, 이 ADR이 답하지 **않는** 선행 질문
  하나도 드러났다: **`PATCH /file/:id { userId }`가 왜 존재해야 하는지를 논증한 결정이 어디에도 없다**
  — 파일을 통째로 넘기는데 받는 쪽 동의가 없고, ADR 0007은 그 필드의 가드가 생성자 전용이라는 말만
  한다. 이제 ROADMAP > 미배정에서 추적하며, 결합 관계도 함께 적었다: 필드를 제거하면 이 수정의
  `23503` 분기가 도달 불가능한 가드가 되므로, 그 선택은 ADR 0024를 확장하는 게 아니라 대체한다.

### 변경
- **남은 작업의 ROADMAP 실행 순번 고정** (2026-07-31) — 단계별 계획은 작업을 의존
  관계로 묶지만, 준비된 항목 몇 개가 단계를 가로질러 있어 실제 착수 순서를
  [ROADMAP.ko.md](ROADMAP.ko.md) 6절에 고정했다: #1 게시판 post/comment 모듈 →
  #2 `GET /user` 페이지네이션(콘솔과 무관하게 갚아야 할 독립적 Never Do Group 2
  부채라 Stage 5에서 앞당김) → #3 Stage 5 admin 화면 → #4 Stage 4 배포(마지막).
  이로써 Stage 5의 "번호는 의존 순서가 아니다" 부동 위치가 Stage 4 **앞**으로
  확정되고, 페이지네이션 부채가 둘보다 앞으로 당겨진다. 문서 전용 — 코드나 계획
  범위 변경은 없다.

### 추가
- **게시판 post 모듈 — 게시판 도메인의 첫 모듈**
  ([ADR 0023](ADR/0023-board-domain-schema.ko.md) > 구현 노트) — 하루 전 확정한 스키마 게이트의
  전반부를 구현했다. `PostModule`은 `JwtAuthGuard` 뒤에 다섯 개 라우트(`GET /post`,
  `GET /post/:id`, `POST /post`, `PATCH /post/:id`, `DELETE /post/:id`)를 신규 `post_entity`
  위에 올린다: `title`(`FileEntity.title`과 달리 **유니크가 아니다** — 제목을 전 사용자 통틀어 한
  번만 쓸 수 있는 게시판은 기능이 아니라 결함이다), `body`, `creatorId` FK, 그리고 **유니크이면서
  nullable인** `fileId` FK. comment가 post에 의존하지 그 반대가 아니어서 **comment 모듈과 분리**
  했고, 그래서 마이그레이션도 ADR이 적은 한 벌이 아니라 두 벌로 나뉘었다. `comment_entity`는 다음
  과제다. 마이그레이션은 [ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)이 요구한
  대로 라인단위로 검토했다 — `generate`가 `FK_file_entity_creator`와
  `IDX_audit_log_entity_action_createdAt`을 TypeORM 해시 이름으로 바꾸기만 하는 drop/재생성 네
  문장을 뱉었고, 베이스라인의 읽기 쉬운 이름을 지키기 위해 전부 걷어냈다.
  **유니크한 `fileId`가 이 엔드포인트의 멱등 키다** — `title`은 될 수 없는 역할이다. 동일한 본문을
  다시 제출하면 기존 게시글을 200으로 replay하고, 같은 `fileId`에 본문이 다르면 409
  `POST_FILE_TAKEN`이며, 유니크 제약 경합에서 진 동시 제출은 500이 아니라 같은 판정 경로로
  되돌아온다. [ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)의 기법을 재사용하되 한 가지를
  의도적으로 달리했다 — ADR 0019는 조건 없이 replay하지만, 게시글에는 파일 승격에 없는 사용자
  작성 텍스트가 있어서, *다른* 제목·본문에 replay로 답하면 새 글을 쓴 사람에게 남의 옛 글을
  돌려주게 된다. 소유권은 `canManage`를 그대로 재사용했고(작성자 **또는** admin+,
  [ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)), 목록은
  [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)의 조회 계층 — 이스케이프한 ILIKE, 전체
  `Record` 정렬 화이트리스트, `id` tiebreaker — 을 다시 쓰지 않고 재사용했다(이스케이프 헬퍼는
  `backend/common/escape-like-pattern.ts`로 옮겨 두 엔드포인트가 한 벌을 공유한다). 파일 첨부는
  **`canManage`가 아니라 신원 일치만** 본다: `FileService.assertAttachableBy`는 admin이라도 남의
  파일을 첨부하려 하면 거절한다. "게시글은 자기 작성자의 파일만 참조한다"가 곧 계정 연쇄를 FK
  안전하게 만드는 근거이기 때문이다. 신규 에러 코드는 셋(`POST_NOT_FOUND`, `POST_FILE_TAKEN`,
  `FILE_IN_USE`)이며, `COMMENT_NOT_FOUND`는 소비자보다 먼저 만들지 **않았다**.

### 변경
- **게시글이 참조 중인 파일에 대한 `DELETE /file/:id`는 이제 409 `FILE_IN_USE`**
  ([ADR 0023](ADR/0023-board-domain-schema.ko.md) D4) — 새 FK 때문에 삭제가 `23503`을 내는데,
  번역하지 않으면 [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)이 `DELETE /user/:id`에서
  없앤 것과 같은 불투명한 500이 된다. **사전 확인 쿼리는 넣지 않았다.** 이유는 둘이고 서로
  독립적이다: `PostService`가 이미 `FileService`에 소유권을 묻는 상황에서 `FileService`가
  `post_entity`를 읽으면 `forwardRef`가 필요한 모듈 순환이 생기고(이 코드베이스에 선례가 없다),
  확인과 삭제 사이에 생성된 게시글은 어차피 제약에 걸리므로 500이 드물어질 뿐 사라지지 않는다.
  판정 권한은 DB에 둔다. `ON DELETE SET NULL`은 아예 기각했다 — 삭제가 항상 성공하는 대신, 공개된
  게시글에서 영상만 조용히 빠져나간다. 게시글을 지워도 파일은 남는다 — 게시글은 파일의 *참조*이지
  소유자가 아니다.
- **계정 연쇄 삭제가 이제 게시글까지 확인 없이 가져간다**
  ([ADR 0023](ADR/0023-board-domain-schema.ko.md) D5) — `UserService.remove`가 기존
  `dataSource.transaction()` 안에서, 파일 행보다 **먼저**(`FK_post_entity_file`과
  `FK_post_entity_creator` 모두 `ON DELETE NO ACTION`) 계정의 게시글을 지운다. 기준은 직전에 읽은
  id 목록이 아니라 `creatorId`다. `?deleteFiles=true`의 의미는 그대로다 — **파일 행과 저장된
  바이트**의 파괴를 확인하는 플래그이고, 409 `USER_HAS_FILES`도 여전히 파일에 대해서만 뜬다.
  확대는 기각했다 — 그러면 파라미터 이름과 에러 코드가 실제로 통제하는 것보다 좁은 것을 가리키게
  되고, 두 번째 플래그는 동결된 라우트에 쿼리 파라미터를 더하는 일이다
  ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md)). 대가는 감추지 않고 기록한다:
  계정을 지우면 그 글도 확인 절차 없이 사라진다. 감사 detail에 건수가 붙고(`files=N posts=N`),
  `POST_DELETE`가 `AUDIT_ACTIONS`에 추가됐다.
- **`FileService.toResponse`가 public이 됐다** — ADR 0023 D1은 `BASE_URL` 합성이 `FileService`에
  남아 재사용되기를 요구하므로, `PostService`는 첨부 파일 URL을 직접 조립하지 않고 이 메서드에
  위임한다. `PostService`는 `file.creator`를 읽지 않는다(디미터 법칙).

### 알려진 문제
> 2026-07-31 [ADR 0024](ADR/0024-account-cascade-fk-refusal.ko.md)로 해소 — 위 **수정** 참조.
> `23503`은 이제 타입 있는 409이고, `resolveAttachment` 가드는 아래 설명대로 유지된다.

- **파일 소유권 이전이 post↔file 같은-작성자 불변식을 깰 수 있다** — ADR 0023 D1은 게시글이 자기
  작성자의 파일만 참조할 수 있다고 논증하며, 그것이 계정 연쇄를 FK 안전하게 만드는 근거다. 작성
  시점에는 성립하지만 `PATCH /file/:id { userId }`가 사후에 소유권을 넘긴다. 결과는 둘이고, 해결이
  구현 세부가 아니라 결정이므로 둘 다 의도적으로 손대지 않았다: `resolveAttachment`는 replay 전에
  작성자 신원을 확인해 파일의 새 소유자가 이전 소유자의 글을 "재시도" 결과로 받지 않게 한다(소유권
  이전 때문에 도달 가능한 분기이므로 금지된 "도달 불가능한 가드"가 아니다). 그리고
  `DELETE /user/:id?deleteFiles=true`는 그 계정의 파일이 다른 사용자로부터 이전됐고 그 사용자의
  글이 아직 참조 중인 좁은 경우에 여전히 `23503`을 낼 수 있다. 후보 처방 셋과 함께 ROADMAP >
  미배정에 올렸으며, 각각 자체 ADR이 필요하다.

### 변경
- **ROADMAP에 Stage 5 — 운영 화면(admin 콘솔) 추가**
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)) — 2026-07-23 11축 검토로
  확정한 계획에 대한 두 번째 개정이다(첫 번째는 Stage F, ADR 0010). 범위를 늘린 것이 아니라 공백을
  닫은 것이다: ADR 0010은 2026-07-23에 admin이 *어디에* 살지 결정했지만 **그것을 만드는 작업을 어느
  단계도 맡지 않았다.** 그래서 다른 모든 결정 항목이 행을 가진 동안 이 작업만 단계 목록 밖에
  있었다 — admin 콘솔은 게시판 도메인(Stage 3)도 인프라(Stage 4)도 아니기 때문이다. 작업 행은
  다섯 개다: 나머지를 막는 백엔드 결정인 **클라이언트가 자기 역할을 어떻게 아는가**(액세스 토큰이
  `{ sub, type }`이고 `role` 클레임이 없어서 지금은 admin 라우트를 하나도 게이팅할 수 없다 —
  [ADR 0002](ADR/0002-dual-secret-token-pair.ko.md)를 개정하는 ADR이 필요하다), 이식된 `admin/`
  콘솔 적응, **`GET /user` 페이지네이션**(콘솔과 무관하게도 갚아야 할 빚이다 — `findAll()`이
  `@Query()`를 바인딩하지 않고 전체 사용자를 반환하는데, 이는 이 프로젝트 자체 Never Do Group 2
  페이지네이션 규칙의 상시 위반이다), 중복된 admin 화면 정리, 그리고 모더레이션 기능
  (`ban`/`unban`/`force-logout`)을 둘 것인지 결정 — 기본 답은 "두지 않는다"이며, 그중 하나라도
  만드는 것은 UI 적응의 부수 효과가 아니라 자체 ADR을 갖는 신규 백엔드 표면이다. **Stage 5의 번호는
  의존 순서가 아니다** — 그 절에 명시된 유일한 예외다: Stage 4가 아니라 Stage 0(RBAC, 완결)과 자기
  첫 행에만 의존하며, Stage 4보다 **앞으로 당길** 근거도 함께 적어 뒀다. 권한 계층을 Swagger로만
  운영할 수 있는 시스템은 배포된 뒤에 운영하기 어렵기 때문이다.

### 추가
- **`admin/`에 이식한 admin 콘솔 — 수정 기반으로 문서화**
  ([ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)) — 저자의 다른 프로젝트인
  **Chat Project**(NestJS + GraphQL + Redis + Socket.IO)에서 최상위 `admin/` 폴더로 통째로
  가져와 **수정하지 않은 상태로** 커밋했다. **명시한 목적은 둘이며, 둘 다 실제로 무게를
  지탱한다.** *(1) 사용자 권한 계층 관리* — 요구사항.
  [ADR 0013](ADR/0013-rbac-and-audit-log.ko.md)은 RBAC의 메커니즘(`ROLE_RANK` 순위를 가진 3단계,
  superadmin 전용 `PATCH /user/:id/role`, `ROLE_CHANGE` 감사 행)은 냈지만 그것을 운영할 수단은
  내지 않았다. 첫 superadmin은 `SUPERADMIN_EMAIL` 부팅 시딩에서 나오고, 그 이후의 모든
  승격·강등은 직접 요청이나 Swagger 폼이며, 계층을 보호하는 두 불변식 — 마지막 superadmin 강등
  거부(400 `AUTH_LAST_SUPERADMIN`)와 모든 역할 변경이 유발하는 세션 종료(`refreshTokenHash`
  null) — 은 그것을 실행하는 사람에게 보이지 않는다. ADR 0013의 마지막 문장이 이 화면을 미뤄뒀고,
  ADR 0022가 그것에 답한다. *(2) 토큰 절약* — 수단. Chat Project의 콘솔은 **같은** 3단계 계층을
  대상으로 만들어졌기에(ROADMAP은 이 프로젝트의 RBAC 설계를 "Chat-project style"로 기록해 뒀다),
  그 사용자 페이지에 역할 컬럼, 배정 컨트롤, 사용자별 상세 패널, 사용자별 감사 조각이 이미 다
  있다. 여기에 도메인 무관 골격(라우터, 라우트 가드, Zustand 인증 스토어, 단일 비행 무음 갱신
  가드, axios 인터셉터, Playwright·Vitest 하네스)까지 얹힌다. 이를 가져오는 비용은 프롬프트로
  하나씩 다시 생성하는 토큰의 극히 일부다 — 아낀 토큰은 API 차이분에 쓴다. **적응은 역할 관리
  조각에서 시작한다**: `PATCH /user/:id/role`, `GET /user`, `GET /user/:id`, `DELETE /user/:id`,
  `GET /audit-log`, `POST /auth/signin`은 모두 이 API에 실제로 있는 라우트이고, 이식된 등급 값
  `0/1/2`는 `ROLE_RANK`와 정확히 일치한다 — 계층 *모델*은 그대로 이전되고, 그 *인코딩*(숫자 대
  `UserRole` 문자열 enum)과 *가드 규칙*(콘솔은 admin이면 누구에게나 역할 컨트롤을 보여주지만
  엔드포인트는 superadmin 전용)만 이전되지 않는다. **이 폴더는 이 백엔드에 대해
  동작하지 않으며, 아직 동작해야 하는 것도 아니다**: 그 안의 모든 파일이 여전히 Chat
  Project의 API를 대상으로 한다. `admin/README.md`(.ko)가 폴더 현장에서 그 사실을 밝히고,
  검증을 거친 수정 백로그는 ADR 0022에 있다(삭제할 Apollo `/graphql` 계층,
  `refreshaccess`/`signOut` 라우트명, 숫자 대 문자열 역할, 액세스 토큰에 없는 `role` 클레임,
  채팅 도메인 페이지, 여기 없는 ban/force-logout 엔드포인트, `page`/`take` 대 `take`/`skip`,
  `/audit-log/export`, [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)의 삭제 확인 절차,
  `ErrorBody` 코드 분기, 그리고 chat 프로젝트 Railway 호스트로 고정된 `vercel.json` CSP —
  적응 작업이 원본을 기준으로 diff를 뜰 수 있도록 의도적으로 손대지 않았다). 적응은 **별도의
  전용 과제**이며, 백로그의 몇 행은 각자의 결정이 필요한 백엔드 사안이다. **어디에도 연결하지
  않았다**: `admin/`은 린트 glob(`{backend,apps,libs,test}/**/*.ts`), Jest
  `roots`(`["backend"]`), `tsconfig.build.json`, `docker-compose.yml`, CI 전부의 바깥에 있고,
  자체 `package.json`/`node_modules`를 갖는다 — pnpm 워크스페이스가 아니며 `frontend/`가 세운
  선례와 같다. 백엔드 동작·엔드포인트·스키마·환경변수·guard는 아무것도 바뀌지 않았다. 추적되는
  비밀 값도 없다(`admin/.gitignore`가 이미 `.env`, `.env.local`, `e2e/.env`, `node_modules`,
  `dist`를 포함하며 `git check-ignore`로 확인).
- `GET /file` 목록 검색 / 필터 / 정렬 (Stage 3 — 도메인 확장;
  [ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)): 선택적 쿼리 파라미터 네 개를
  모두 `GetFilesDto`에 선언해 추가했고, `[files, totalCount]` 응답 형태는 그대로다.
  **`search`**는 제목을 대소문자 구분 없이 부분일치로 찾는다(`ILIKE '%term%'`). LIKE
  메타문자(`\`, `%`, `_`)를 이스케이프하고 `ESCAPE '\'`를 명시하므로, 검색어에 든 `%`는
  결과를 조용히 넓히는 대신 문자 그대로 매칭된다. 공백뿐인 검색어는 미지정으로 취급하고,
  길이는 100자로 제한한다. **`creatorId`**는 이미 존재하는 creator join을 통해 작성자로
  필터링한다(추가 쿼리 없음). **`sortBy`**(`createdAt` | `title` | `id`)와
  **`order`**(`DESC` | `ASC`)는 `FileService`의 완전한 `Record<FileSortField, string>`를
  통해서만 해석되므로, 클라이언트 문자열이 컬럼명으로 쿼리에 도달하지 않고 정렬 키만
  추가하고 컬럼 매핑을 빠뜨리면 컴파일 에러가 난다. `filePath`는 의도적으로 제공하지 않는다.
  풀텍스트 검색, `pg_trgm`, 복합 `sort=field:dir` 문자열, `creatorEmail` 필터, keyset
  페이지네이션은 모두 ADR에서 검토 후 배제했다.
- 삭제 정책 (Stage 2 — 메커니즘 강화;
  [ADR 0020](ADR/0020-account-deletion-cascade.ko.md)): **soft delete는 채택하지 않는다** —
  삭제는 hard delete로 유지하며, 그 근거는 ADR에 기록했다. `DELETE /user/:id`는 이제 선택적
  `deleteFiles` 확인 값을 받는다. `deleteFiles=true`면 계정을 **그 계정이 소유한 모든 파일과
  함께** 삭제한다(파일 행 → 계정 행을 하나의 `dataSource.transaction` 안에서 지우고, 물리
  파일 unlink는 롤백이 불가능하므로 **커밋 이후에** 수행한다). 확인이 없으면 파일을 보유한
  계정의 삭제를 신규 **409 `USER_HAS_FILES`**로 거절하며, 클라이언트 경고 문구에 쓸 파일
  개수를 메시지에 담는다 — 기존의 FK 위반 **500**(`23503`, 원인을 알 수 없는 "Internal server
  error")을 대체한다. `deleteFiles=false`는 확인하지 않은 것으로 취급한다. 이 플래그를 boolean이
  아니라 검증된 문자열 리터럴(`'true' | 'false'`)로 받은 이유는, 전역 파이프의
  `enableImplicitConversion`이 커스텀 `@Transform`보다 먼저 `"false"`를 truthiness로 `true`로
  바꾸는 것이 실측으로 확인됐기 때문이다 — `delete-user-query.dto.spec.ts`가 이 동작을 고정한다.
  파일이 없는 계정의 삭제는 기존과 완전히 동일하다. `USER_DELETE` 감사 기록에는
  `detail: files=N`이 붙는다. 스키마 변경은 없다(FK는 `ON DELETE NO ACTION` 유지, 연쇄는
  서비스에서 명시적으로 수행). E2E는 거절, 확인된 연쇄 삭제, 잘못된 플래그,
  `deleteFiles=false`를 모두 커버한다.
- 업로드 중복 제출 정책 (Stage 2 — 메커니즘 강화;
  [ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)): `POST /upload/attach`가 발급하는
  파일명을 **1회용 청구 토큰**으로 삼아, 새 저장소도 스키마 변경도 없이 `POST /file`의
  재시도 계약을 확정했다. 이미 청구된 파일명을 다시 제출하면, 그 청구자 본인에게는 기존
  파일을 **replay**한다 — 두 번째 201이 아니라 HTTP **200**으로 원래 리소스를 돌려준다 —
  그 외 사용자에게는 신규 **409 `FILE_ALREADY_CLAIMED`**를 낸다(역할이 아니라 신원만 본다:
  관리자가 타인의 파일명을 다시 제출하는 것은 재시도가 아니라 충돌이다). 형식은 맞지만 뒤를
  받쳐 줄 temp 파일이 없으면(발급된 적 없거나 [ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)
  스윕이 TTL 초과로 회수) 어떤 쓰기보다 먼저 400 `FILE_INVALID_PATH`로 실패한다.
  `POST /upload/attach`는 의도적으로 비멱등을 유지한다 — 호출마다 새 토큰을 발급하고, 청구되지
  않은 토큰은 스윕이 회수한다. `FileService.uploadFile`의 반환 타입은 `{ replayed, file }`로
  바뀌었고, `FileController`가 `@Res({ passthrough: true })`(기존 `AuthController` 패턴)로
  `replayed`를 상태 코드에 반영한다. E2E는 2회 제출, 타 사용자 충돌, 거절되는 두 경로를
  모두 커버한다.
- 미청구 temp 파일 정리 (Stage 2 — 메커니즘 강화;
  [ADR 0018](ADR/0018-orphan-temp-file-cleanup.ko.md)): 새 운영 모듈 `TempCleanupModule`
  (`backend/temp-cleanup/`)이 스케줄 스윕을 돌려, `POST /file`이 끝내 호출되지 않아
  `file/temp`에 남은 미청구 `temp_` 파일을 삭제한다 — 시스템에서 유일하게 관리되지 않던
  리소스 누수(ADR 0003)다. `@nestjs/schedule`(새 런타임 의존성, MIT; `cron@4.4.0`은 pnpm
  아래에서 direct 의존성으로 승격 — `multer` phantom-transitive 선례)을 쓰고, 주기·TTL·
  dry-run·활성 플래그가 모두 config에서 오도록 **명령형** `SchedulerRegistry` 등록을 사용한다.
  안전성: TTL을 넘은 `temp_` 접두 파일만 삭제하고(이중 접두 가드: service 스킵 + 순수 함수
  `selectExpiredTempFiles` 재확인), `granted_`/`file/upload`는 결코 건드리지 않으며,
  `fs/promises`만 사용, unlink 배치 처리, 개별 파일 실패 격리, `ENOENT` no-op, dry-run 모드를
  갖춘다. 설정(Joi + `.env.example`, 모두 기본값 보유): `TEMP_SWEEP_ENABLED`(`true`),
  `TEMP_SWEEP_CRON`(`0 * * * *`, 매시간), `TEMP_SWEEP_TTL_HOURS`(`24`),
  `TEMP_SWEEP_DRY_RUN`(`false`); e2e는 `TEMP_SWEEP_ENABLED=false`로 둔다. `AppModule`에
  `ScheduleModule.forRoot()`를 추가했다. 운영/cross-cutting 모듈을 허용하도록 모듈 정책을
  개정한다.
- 로깅 규약 (Stage 1 — 관측성;
  [ADR 0017](ADR/0017-logging-conventions.ko.md)): `AllExceptionsFilter`에서 Nest 내장
  `Logger`를 사용한다 — 5xx는 클라이언트 응답에서 빠지는(Never Do Group 3) 스택과 함께
  `error`로, 4xx는 `debug`로 기록해 일상적인 인증/검증 실패를 조용히 둔다. `status code
  method url`만 기록하고 본문·헤더·토큰은 절대 기록하지 않는다. 새 코드를 위한 레벨
  규약(`error`/`warn`/`log`/`debug`)을 정립하며, 구조적/JSON 출력과 외부 에러
  추적(Sentry)은 Stage 4로 유예한다. 새 의존성 없음(Nest `Logger`는 내장).
- GitHub Actions CI (Stage 1 — 자동 품질 게이트;
  [ADR 0016](ADR/0016-github-actions-ci.ko.md)): `.github/workflows/ci.yml`가
  `main`/`dev`의 push·PR에서 두 잡으로 실행된다 — `lint-and-unit`(신규 `lint:ci`
  스크립트 = `--fix` 없는 `eslint`, 이어서 `pnpm test`)과 `e2e`(`pg_isready`
  헬스체크를 갖춘 `postgres:16` 서비스 대상 스위트, 환경 변수는 인라인 주입). 툴체인은
  ADR 0014 고정값(`actions/setup-node` + `.nvmrc` + Corepack pnpm)에서 온다. 0-오류
  lint 베이스라인과 단위 + e2e 스위트가 이제 기억이 아니라 매 push/PR에서 강제된다.
- Docker + docker-compose (Stage 1 — 재현성;
  [ADR 0015](ADR/0015-docker-and-compose.ko.md)): 멀티 스테이지 `Dockerfile`(빌드는
  `node:24.8.0`, `pnpm prune --prod`, slim 런타임; `CMD`가 커밋된 마이그레이션을 실행한
  뒤 `node dist/main`)과 `docker-compose.yml`(`db` 서비스 — `postgres:16`, 명명 볼륨,
  헬스체크; `api` 서비스 — 이미지 빌드, db 헬스 대기, `env_file: .env`에 `DB_HOST=db`
  덮어쓰기, `./file` 볼륨). `.dockerignore`가 시크릿·의존성·업로드를 이미지에서 제외한다.
  수동 `upload-board-pg` 컨테이너를 대체하고 e2e의 수동 Postgres 의존을 제거한다. 베이스
  이미지 태그는 ADR 0014의 고정값에서 온다. 검증: 이미지 빌드 성공, slim 런타임에서
  `bcrypt` 네이티브 모듈 동작, `docker compose config` 정상 해석.
- Node/pnpm 툴체인 고정 (Stage 1 — 재현성;
  [ADR 0014](ADR/0014-node-pnpm-version-pinning.ko.md)): `.nvmrc`(`24.8.0`, Node 24
  "Krypton" LTS), `package.json`의 `engines` 하한(`node >=24`, `pnpm >=10` — 권고적,
  `engine-strict`는 계속 끔), `packageManager` `pnpm@10.14.0`(Corepack). 문서화돼 있던
  "버전 미고정" 공백을 해소하고, 곧 도입될 Docker 베이스 이미지 태그와 CI 툴체인에
  단일 출처를 제공한다.
- 백엔드 e2e 스위트 재작성 (Stage 1 — 테스트 신뢰성): `test/app.e2e-spec.ts`(18개
  케이스)와 신규 `test/e2e-utils.ts` 하네스가 실제 HTTP+DB로 요청→응답 전체 경로를
  검증한다 — register/signin, refresh 회전·재사용(`AUTH_REFRESH_REUSED`, ADR 0012),
  RBAC 소유권 403(`FORBIDDEN_NOT_OWNER`/`FORBIDDEN`), 목록 페이지네이션,
  `temp_` → `granted_` 물리 승격. 격리 전략: 일회용 `upload_board_e2e` 데이터베이스를
  실제 마이그레이션으로 만들고 테스트마다 truncate하며 종료 시 drop — 개발용 DB는 전혀
  건드리지 않는다. 존재하지 않는 `GET /`를 치던 기존 Nest 템플릿을 대체한다.
  `test/jest-e2e.json`에는 `backend/*` 모듈 매퍼와 uuid ESM 변환 허용을 추가했고,
  `eslint.config.mjs`는 `test/**`에 한해 `no-unsafe-*` 계열을 완화한다(supertest 응답
  본문 타입이 `any`이기 때문). 로컬 Postgres(5435)가 필요하며, Docker-compose
  프로비저닝은 별도의 미완료 Stage 1 작업으로 남는다.
- RBAC + 감사 로그 ([ADR 0013](ADR/0013-rbac-and-audit-log.ko.md), Stage 0 —
  **Stage 0 완결**): `user`/`admin`/`superadmin` 역할(신규 `user_entity.role`
  컬럼의 문자열 enum, 마이그레이션 `AddUserRoleAndAuditLog`); `RolesGuard` +
  `@Roles`와 `@AuthUser` 데코레이터; 소유권 검사를 "본인/작성자 또는 admin"으로
  확장; superadmin 전용 `PATCH /user/:id/role`(SERIALIZABLE 트랜잭션, 신규
  `AUTH_LAST_SUPERADMIN`으로 마지막 superadmin 강등 거부, 대상자 refresh 세션
  무효화). 신규 append-only `audit_log_entity`(외래 키 없음)가 커밋 후
  `ROLE_CHANGE`/`USER_DELETE`/`FILE_DELETE`를 기록하고 admin 전용 페이지네이션
  `GET /audit-log`로 노출된다. `GET /user`는 이제 admin 전용. `SuperadminSeedService`가
  선택적 `SUPERADMIN_EMAIL` 계정을 부팅 시 승격한다. 신규 의존성 없음.
- Refresh 토큰 httpOnly 쿠키 + 회전/재사용 감지
  ([ADR 0012](ADR/0012-refresh-cookie-rotation.ko.md), Stage F 작업 3 —
  **Stage F 완결**): 리프레시 토큰은 이제 httpOnly 쿠키(`SameSite=Strict`,
  `Path=/auth/token`, prod에서 `Secure`)로만 이동하고, 그 SHA-256이 신규
  nullable 컬럼 `user_entity.refreshTokenHash`에 앵커로
  저장된다(마이그레이션 `AddUserRefreshTokenHash`). 회수된 토큰을 재사용하면
  401 `AUTH_REFRESH_REUSED`(신규 코드)와 함께 세션이 무효화된다. 신규
  `POST /auth/signout`이 앵커와 쿠키를 삭제한다. 신규 런타임 의존성
  `cookie-parser`(MIT).
- 기계 판독 가능한 에러 코드 계약
  ([ADR 0011](ADR/0011-error-code-contract.ko.md), Stage F 작업 2): 동결된
  `ErrorBody` 응답 형태(`statusCode`/`code`/`message`/`timestamp`/`path`,
  `stack`은 dev 전용), 18개 코드의 문자열 enum 카탈로그
  (`backend/common/error-code.ts`), `APP_FILTER`로 등록한 전역
  `AllExceptionsFilter` — 스로우 지점 23곳이 `{ code, message }`를 싣는다.
  클라이언트 분기는 `message`가 아니라 `code`로만.
- [ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md) — 프론트엔드
  분리와 API 표면 동결(2026-07-23; 구조 2026-07-24 개정): 프론트엔드는 이 저장소
  안의 `frontend/` 하위 폴더(백엔드는 루트에 그대로)로 두고 admin은 그 안의
  `/admin` 라우트 구역으로 시작; 비표준 라우트 4건을 리네임한 뒤 API 표면을
  동결; pnpm workspace 모노레포와 즉시 3분리는 기각.
- `frontend/` 하위 폴더 생성 2026-07-24: React 19 + Vite + TypeScript SPA로 API를
  소비(Basic 로그인, 메모리 내 access 토큰, httpOnly refresh 쿠키 회전),
  자체 스코프 `frontend/CLAUDE.md`·`docs/API-CONTRACT.md`와 Vite dev 프록시 포함 —
  인증 플로를 백엔드와 E2E 검증.
- TypeORM 마이그레이션 도입 ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md)):
  `migration:generate`/`run`/`revert`/`show` 스크립트(컴파일된
  `dist/data-source.js` 대상 실행), CLI DataSource `backend/data-source.ts`(환경변수는
  Node 내장 `process.loadEnvFile()` — dotenv 의존성 없음), 베이스라인
  `backend/migrations/1784678400000-InitialSchema.ts`. 새 DB: `pnpm migration:run`;
  수동 생성된 기존 DB: `pnpm migration:run -- --fake` 1회.
  수동 "`synchronize` 임시 전환" 워크플로를 대체하며 RBAC의 선행 조건 해소.
- 문서 세트: `README.md` 재작성, 신규 `ARCHITECTURE.md`, `CHANGELOG.md`,
  `ROADMAP.md`, `CONTRIBUTING.md`, `ADR/`(9건) — 각각 한국어 `.ko.md` 동반.

### 변경
- 백엔드 소스 폴더를 `src/` → `backend/`로 개명 — `frontend/` 하위 폴더와의
  루트 대칭성 목적(ADR 0010 2026-07-24 개정): `nest-cli.json` sourceRoot, Jest
  `roots`/`moduleNameMapper`, lint glob, `tsconfig.build.json`(이제 `frontend`
  제외), e2e import, 모든 `backend/…` 절대 import와 문서 경로를 갱신. 컴파일된
  `dist/` 구조와 `dist/data-source.js` 마이그레이션 경로는 그대로; 백엔드
  build/test(43)/lint와 마이그레이션 재검증 완료.
- **Breaking** — 인증 전송 방식(ADR 0012, 소비자 0명 상태의 사전 결정 Stage F
  작업): `POST /auth/signin`·`POST /auth/signin/local` 응답 body가
  `{ accessToken }`으로 축소(리프레시 토큰은 Set-Cookie 헤더로 이동);
  `POST /auth/token/refresh`는 Bearer 헤더 대신 httpOnly 쿠키를 읽는다.
  브라우저는 refresh/signout에 `credentials: 'include'`가 필요하다.
  `AuthService.parseBearerToken`은 분해 — 순수 `verifyToken` 코어(시크릿 +
  `type` 클레임)는 존속, "Bearer " 분리 래퍼는 제거.
- **Breaking** — API 표면 동결에 앞선 라우트 정규화
  ([ADR 0010](ADR/0010-frontend-split-and-api-surface-freeze.ko.md), Stage F
  작업 1). 데코레이터 인자만 변경했으며 가드/DTO/핸들러는 그대로:
  - `POST /file/uploadFile` → `POST /file`
  - `PATCH /file/patch/:id` → `PATCH /file/:id`
  - `DELETE /file/delete/:id` → `DELETE /file/:id`
  - `POST /auth/token/refreshaccess` → `POST /auth/token/refresh`
- `ROADMAP.md`를 전체 프로젝트 계획서로 전면 개편(11축 결정 검토, 2026-07-23):
  실서비스 지향 목표, 신규 설계 기준 5축(관측성, 재현성, API 계약 안정성,
  테스트 신뢰성, 성능/용량), 단계별 전용 작업 목록(RBAC → 기반 → 메커니즘
  보강 → 게시판 도메인 확장 → AWS 실서비스 전환), 스토리지 포트-어댑터를
  향후 아키텍처 목표로 선언. 관련 문서 동기화: `CLAUDE.md`(로드맵/CI/스토리지
  주석), `README.md`(낡은 알려진 한계 수정), `CONTRIBUTING.md`(마이그레이션
  기반 설정).
- `ROADMAP.md`를 프론트엔드 분리 결정으로 개정(ADR 0010, 2026-07-23): Stage 0
  앞에 **Stage F — 프론트엔드 준비**(라우트 정리·계약 동결, 에러 코드 체계,
  refresh 토큰 cookie 전환 + 회전) 신설; RBAC은 Stage F 뒤로 재배치(API 표면을
  바꾸지 않으므로); refresh 토큰 회전은 Stage 2에서 앞당김; 정적 파일 무인증
  서빙을 Stage 4까지 감수하는 알려진 제약으로 명문화. 관련 문서 동기화:
  `CLAUDE.md`, `README.md`.

### 수정
- `GET /file` 페이지네이션이 결정적으로 동작한다
  ([ADR 0021](ADR/0021-list-query-search-filter-sort.ko.md)). 이 쿼리에는 **`ORDER BY`가
  아예 없었고**, PostgreSQL에서 정렬되지 않은 쿼리에 `OFFSET`/`LIMIT`을 얹으면 행 순서가
  미정의다 — 페이지를 넘기다 어떤 행은 중복되고 어떤 행은 건너뛰어질 수 있었다. 이제 기본
  정렬이 `createdAt DESC`이고 `file.id`를 tiebreaker로 덧붙이므로(이미 유일한 `id`로 정렬할
  때는 생략), 정렬 컬럼 값이 같은 행들이 두 번의 페이지 요청 사이에 순서를 바꿀 수 없다.
  기존 호출자는 이전에 임의 순서로 받던 결과를 이제 정렬된 순서로 받는다. 응답 형태와 기존
  파라미터는 모두 그대로다.
- `DELETE /file/:id`가 행뿐 아니라 저장된 물리 파일까지 지운다
  ([ADR 0020](ADR/0020-account-deletion-cascade.ko.md)): 그동안 파일을 삭제해도 `granted_`
  파일은 `file/upload`에 영구히 남았고, `ServeStaticModule`을 통해 계속 공개 서빙되면서
  아무도 회수하지 않았다(ADR 0018 스윕은 `file/temp`의 `temp_` 파일만 건드린다). unlink는 행이
  사라진 뒤에 best-effort로 수행한다 — 실패하면 `warn`으로 남기고 고아 파일을 남길 뿐, 이미
  커밋된 삭제를 되돌리지 않는다. `file/upload/` 바깥 경로는 거부하며, 이는 `UpdateFileDto`가
  폴더 없는 맨 `granted_` 이름을 허용하므로 실제로 도달 가능한 분기다.
- `POST /file`이 예측 가능한 클라이언트 시퀀스에 500을 내지 않는다
  ([ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)): 이미 청구된 파일명을 다른 title로
  다시 제출하면 행을 insert한 뒤 `rename`이 `ENOENT`로 실패해 `INTERNAL_ERROR`로 무너졌고,
  동시 제출 2건은 락 없는 title 사전검사를 둘 다 통과해 패자의 `QueryFailedError`(
  `HttpException`이 아님)도 500이 됐다. 이제 unique 위반(`23505`)을 다시 해석한다 — 승자가
  같은 파일명을 청구했다면 패자는 같은 요청의 두 번째 사본이므로 replay하고, 아니면 진짜 title
  충돌이므로 400 `FILE_TITLE_TAKEN`을 낸다.
- Auth 응답 직렬화: `AuthController`에 `ClassSerializerInterceptor`가 없어
  `POST /auth/register`가 bcrypt `password` 해시(기존 결함)와 신규
  `refreshTokenHash`를 노출했다 — 인터셉터 없이는 `@Exclude`가 동작하지
  않는다. ADR 0012 플로 라이브 검증에서 발견.
- Refresh 토큰에 무작위 `jti` 클레임 추가: 같은 초에 발급된 두 토큰이
  바이트 단위로 동일해(`sub`/`type`/`iat`/`exp` 동일 → 서명 동일) 회전
  재사용 감지가 무력화되던 문제.

### 보안
- `UploadFileDto.filePath`를 attach 발급 형식으로 고정
  (`^temp_{uuid}_{ms}\.(mp4|mov|webm)$`, [ADR 0019](ADR/0019-upload-claim-idempotency.ko.md)).
  이전에는 형식 검증 없이 `join(cwd, 'file/temp', filePath)`의 `rename` 소스로 들어가서,
  클라이언트가 `../` 세그먼트를 넣으면 타인의 `granted_` 파일을 가리키는 `FileEntity` 행을
  만들 수 있었다. "filePath는 서버가 생성한다"는 전제(Never Do Group 3)를 이제 DTO 경계에서
  강제한다. `UpdateFileDto`는 이 필드를 omit 후 재선언한다 — PATCH는 반대편 생명주기 상태인
  `granted_` 이름을 받기 때문이다.
- `pnpm audit --prod` 클린(2026-07-24): `multer`를 직접 의존성으로
  승격(`upload.module.ts`가 직접 import하는데 팬텀 전이 의존성이라 pnpm 엄격
  레이아웃에서 `node dist/main`이 크래시) 후 `^2.2.0` 핀; 런타임 도달
  지적들을 `pnpm.overrides`로 핀(`body-parser`, `path-to-regexp`,
  `file-type`, `lodash`, `diff`, 스코프 지정 `@nestjs/swagger>js-yaml`);
  범위 내 업데이트 `@nestjs/common`/`core`/`platform-express`(11.1.28),
  `typeorm`(0.3.31), `joi`(18.2.3), `uuid`(13.0.2). dev 전이 지적은
  의도적으로 유지(빌드/테스트 시점 전용).

## [0.0.1] — 개발 라인

### 2026-07-22 — `da676c0` … `d97916d` (하드닝 & 빠른 수정)
- **보안**: 런타임 CVE 지적을 `pnpm.overrides`로 핀 고정(`jws ^3.2.3`,
  `validator ^13.15.22`); `POST /upload/attach`에 mp4/mov/webm mimetype + 확장자
  허용 목록 강제 (`da676c0`).
- **수정**: lint 오류 0건 기준선 도달(unsafe-`any` 체인에 타입 지정, spec
  파일에서는 `unbound-method` 규칙 비활성화); `GET /file` 목록이 `creator`를
  조인해 `GET /file/:id`와 일치 (`063ca14`).
- **수정**: `@nestjs/jwt`를 `devDependencies`에서 `dependencies`로 이동 —
  AuthModule의 런타임 의존성이며 `--prod` 설치가 더는 깨지지 않음 (`44a0ac9`).
- **리팩터**: `FileService.uploadFile`/`updateFile` 커밋 후 재조회를 트랜잭션
  `try` 밖으로 이동하고 명시적 null 가드로 `saved!`/`updated!` 단언 대체
  (`d97916d`).
- **문서**: 하드닝 이후 gaps/로드맵 동기화, chat 잔재 제거 계획, `CLAUDE.md`에
  `.ko.md` 문서 관례 추가 (`dc336ef`, `837fd14`).

### 2026-07-22 — `0549ca4`, `48ab8b7`, `7bbc6b6`
- **추가**: 스키마 변경 없는 소유권 검사
  ([ADR 0007](ADR/0007-ownership-checks-without-rbac.ko.md)): `PATCH /user/:id`·
  `DELETE /user/:id`는 본인만, `PATCH /file/patch/:id`·`DELETE /file/delete/:id`는
  작성자만 가능(불일치 시 `ForbiddenException`).
- **추가**: 새 `GetFilesDto`를 통한 `GET /file` 페이지네이션 — `take` 1–100
  (기본 20), `skip` ≥ 0(기본 0); "목록에 페이지네이션이 없다"는 알려진 공백 해소.
- **추가**: opt-in CORS ([ADR 0008](ADR/0008-opt-in-cors.ko.md)): 선택적
  `CORS_ORIGIN` 환경변수(콤마 구분 허용 목록); 미설정 시 CORS 비활성 유지.
  Joi 스키마와 `.env.example`에 추가.
- **변경**: 테스트 스위트를 현재 서비스 시그니처에 맞춤; `bcrypt`는
  `jest.mock('bcrypt')`로 모킹; 삭제된 `UserService.create` 테스트 제거
  (30개 테스트 통과).
- **변경**: README 엔드포인트 목록을 실제 라우트로 수정(`POST /user` 없음).
- **수정**: `pnpm lint` 복구 — `eslint.config.mjs`가 import하는 통합
  `typescript-eslint` 패키지를 `devDependencies`에 선언; lint가 다시 실행되며
  기존 오류 약 45건은 알려진 공백으로 유지 ([ROADMAP.ko.md](ROADMAP.ko.md) 참조).
- **스타일**: 복구된 `pnpm lint --fix`로 Prettier 저장소 전체 적용;
  `CLAUDE.md` 로드맵 동기화(소유권 검사 완료 표시).

### 2026-07-22 — `f3fff1c`
- `CLAUDE.md`를 이 저장소에 특화된 운영 규약으로 재작성(이전에는 범용).
- **수정**: `@UserId` 데코레이터가 이제 JWT가 채운 `request.user.id`를 읽고, 인증된
  사용자가 없으면 `UnauthorizedException`을 던짐 — 요청 페이로드로 신원을 위장할
  수 없게 됨.
- 로드맵 결정 기록: 마이그레이션 도입, 소유권 검사, RBAC
  ([ROADMAP.ko.md](ROADMAP.ko.md) 참조).

### 2026-06-16 — `c8eb19f`, `4d00bc2`
- `CLAUDE.md` 추가(초기 AI 협업 지침).
- **리팩터 (SOLID & NestJS 원칙)**:
  - DI 수정: `AuthModule`이 자체 `providers[]`에 `UserService`를 재선언하는 대신
    `UserModule`을 import.
  - `FileResponseDto` + `FileService.toResponse()` 추가 — 공개 파일 URL을 엔티티의
    하드코딩 `@Transform` 대신 `BASE_URL`(신규 선택 환경변수)로 조합.
  - 엔티티 정리: 중복 `FileEntity.user` / `UserEntity.files` 관계 쌍과 엔티티
    레벨 표현 데코레이터 제거.
  - `UserService.create` 제거(등록은 `POST /auth/register`만);
    `UserService.update`가 설정된 `HASH_ROUNDS`로 재해싱(이전엔 하드코딩 salt).
  - 타입 안전성: `issueToken`을 `Pick<UserEntity, 'id'>`로 좁힘; local 로그인
    요청 타입 지정; 여러 `any` 제거.

### 2026-04-14 — `2f2fc99`
- **변경**: `app.module.ts`의 `synchronize`를 `true` → `false`로 전환 — 부팅 시
  스키마 자동 변경이 더 이상 일어나지 않음
  ([ADR 0006](ADR/0006-schema-policy-and-migration-adoption.ko.md) 참조).

### 2026-03-24 — `d1e830d`
- **제거**: `GET /auth/profile` 엔드포인트(사용되지 않는 role 실험 잔재).
- 사소한 `FileService` 정리.

### 2026-03-17 — `3d4d5c1`, `595e7fb`
- **제거**: 자리표시자 `upload.controller.spec.ts`.
- 인증 컨트롤러/서비스와 `main.ts` 정리; README 갱신.

### 2026-01-05 — `8b3b633`
- README 편집(커밋 메시지: "few changes" — diff는 README만 변경).

### 2025-12-27 — `6528b96`
- README 편집(한 줄).

### 2025-12-19 — `283e9ab`, `88b327a`
- **수정**: 파일 제목 중복 오류 — `updateFile`이 변경 적용 전에 동일 제목이 이미
  있는지 확인.
- `FileEntity`에 `@IsString`/`@IsNotEmpty` 검증 데코레이터 추가; `FileService`
  주석 정리.
- `file/temp` / `file/upload`에 커밋됐던 샘플 미디어 제거(참고: `88b327a`의
  메시지는 "swagger additional update"이지만 diff는 추적된 미디어 제거만 포함).

### 2025-12-18 — `0a77627`
- `.env.example` 추가; README 정리.

### 2025-12-17 — `434c2bc`
- **초기 애플리케이션**: 4개 모듈의 NestJS 앱 —
  - `AuthModule`: Basic 토큰 등록/로그인, `type` 클레임을 가진 이중 시크릿 JWT 쌍,
    `jwt`/`local` Passport 전략, 리프레시 엔드포인트.
  - `UserModule`: `JwtAuthGuard` 뒤의 사용자 CRUD, bcrypt 해싱, `@Exclude` 비밀번호.
  - `FileModule`: 파일 메타데이터 CRUD; 수동 QueryRunner 트랜잭션 안의 2단계
    `temp_` → `granted_` 승격.
  - `UploadModule`: 서버가 생성한 파일명으로 `file/temp`에 저장하는 Multer
    diskStorage, 100 MB 제한.
  - Joi 검증 설정, `file/` 위의 `ServeStaticModule`, `/doc`의 Swagger, 세 서비스의
    Jest 단위 테스트.
