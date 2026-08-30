# ADR 0048: CI 트리거 복원과 `docker-publish` 브랜치별 설계

- 상태: 승인됨 — 구현됨
- 날짜: 2026-08-30
- 개정 대상: [ADR 0016](0016-github-actions-ci.ko.md) (GitHub Actions 기반 지속적 통합)
- English: [0048-ci-trigger-restoration-and-docker-publish-design.md](0048-ci-trigger-restoration-and-docker-publish-design.md)

## 맥락

ADR 0016의 결정문은 명확하다 — 워크플로는 `main`/`dev`에 대한 `push`와
`pull_request` 양쪽에서 실행된다. 그런데 이 세션 시작 시점(2026-08-30)의 실제
`.github/workflows/ci.yml`은 두 트리거 모두 `main` 전용으로 좁혀져 있었다 —
ADR 0016의 결정에서 벗어난 드리프트였지만 이를 기록한 ADR은 없었다. ADR 0016은
또한 이미지 빌드/푸시를 결정 범위 밖으로 명시적으로 뒀다("배포 파이프라인은
아니다: 이미지 빌드/푸시 없음... 이는 Stage 4에서 도입된다"). 이후 Stage 4에서
`docker-publish` 잡이 추가됐지만, 그 설계를 기록한 ADR도 없었다 — 이 ADR이 그
첫 기록이다.

`docker-publish`의 문서화되지 않은 `main` 전용 트리거는 [ROADMAP.md
§7](../ROADMAP.ko.md#7-미일정--미결-사항)에 기록된 반복적인 스테일 이미지
사고(2026-08-28 발견, 2026-08-29/30 재발)의 직접 원인이었다 — 이 프로젝트의
실제 개발은 `dev`에서 이뤄지는데 `dev`는 이미지 빌드를 한 번도 트리거한 적이
없어서, `k8s/helm/values.yaml`의 `image.tag: latest` 기본값(그리고
`values-prod.yaml`의 고정 태그조차)이 `dev`에 방금 랜딩된 코드보다 앞선 이미지를
조용히 가리키고 있었다. 그 ROADMAP 항목은 후보 해법 세 가지(a/b/c)를 기록해뒀지만
개발자 판단이 필요해 하나를 고르지 않은 채 남겨뒀다. 이 ADR은 (b)안 —
`docker-publish`의 트리거를 `dev` push에도 반응하게 바꾸는 것 — 이 실제로
구현되고 라이브 검증됐음을 기록한다.

## 결정

### D1 — 트리거 복원은 부분적이다, ADR 0016 원문으로의 완전 복귀가 아니다

`push`는 ADR 0016의 원래 결정과 일치하도록 `[main, dev]`로 복원한다.
`pull_request`는 의도적으로 `[main]` 전용으로 남긴다 — 이건 이 ADR이 닫으려는
격차를 만든 것과 같은 종류의 미기록 드리프트가 아니라, 숙고를 거친 선택이다:
이 프로젝트의 실제 워크플로에서 `dev`는 보통 pull request가 아니라 직접
push를 받으므로, `dev`에 대한 PR 트리거 CI는 실익이 낮고 복원 요청도 없었다.
`dev`가 앞으로 PR을 정례적으로 받게 된다면 이 행은 재검토돼야 한다.

### D2 — `docker-publish`의 브랜치별 태그/플랫폼 설계 (이 문서가 첫 기록)

- `main`은 기존 `linux/amd64,linux/arm64` 멀티아치 빌드에 `:latest` +
  `:<sha>`를 그대로 유지한다 — 변경 없음.
- `dev`는 `linux/amd64` 단일 아키텍처 빌드에 `:<sha>`만 받는다(`:latest`는
  절대 받지 않음).

근거: `dev`는 이제 `main`보다 훨씬 자주 발행되고, 거기에 의존하는 `:latest`
소비자가 없다. 두 브랜치 모두 *런타임* arm64 검증이 존재한 적이 없다 — QEMU
에뮬레이션 위에서 컨테이너를 실제로 실행하는 건 비현실적이라, arm64에 대해서는
어느 브랜치든 "빌드가 끝났다"만 확인돼 왔다. 따라서 `dev`의 arm64 빌드를 빼도
잃는 건 조기 *빌드* 실패 신호뿐이고(다음 `main` 머지 시점, 즉 배포 전에 여전히
발견됨), 애초에 존재한 적 없는 런타임 신호는 잃지 않는다. `dev`가 지금
얼마나 더 자주 발행되는지를 감안하면 QEMU 비용을 절반으로 줄이는 게 이 트레이드
오프를 감수할 가치가 있다고 판단했다.

### D3 — 워크플로 전역 `concurrency`

`concurrency: { group: ${{ github.workflow }}-${{ github.ref }},
cancel-in-progress: true }` 블록을 추가해, 같은 브랜치로의 연속 push(이제 전체
파이프라인을 트리거하는 `dev`가 특히)가 낡은 실행을 끝까지 돌리는 대신 취소되게
했다.

### D4 — push 전 스모크 테스트 (새로운 검증)

실제 멀티플랫폼 `--push` 빌드 전에, 새 스텝이 amd64 이미지를 로컬로 빌드하고
(`--load`, `type=gha`로 GHA 캐시해서 이후 push 빌드가 전체 컴파일 비용을 다시
치르지 않게 함), 일회용 `postgres:16` 서비스와 함께 `--network host`로
기동시켜, 아무것도 push하기 전에 Dockerfile 자체의 `HEALTHCHECK`
(`GET /health/live`)가 `healthy`를 보고할 때까지 폴링한다. 이건 정말 새로운
검증이다 — 어느 브랜치든 이전의 `docker-publish` 실행은 빌드된 이미지가 실제로
뜨는지 검증한 적이 없었고, 빌드 자체의 완료 여부만 확인해왔다.

### D5 — `docker/login-action`을 `v3`에서 `v4`로 버전 업

D1~D4를 실제 `dev` push로 라이브 검증하던 중 발견: GitHub Actions가 `node20`
대상 액션을 기본적으로 `node24` 런타임으로 강제 실행시키기 시작하면서,
`docker/login-action@v3`(`node20` 런타임 액션)가 "malformed HTTP Authorization
header"로 즉시 실패하기 시작했다. 이는 Docker Hub 자격증명 문제가 아니라고
판단한 뒤 런타임 문제로 진단됐다 — 독립된 두 번의 자격증명 교체에도 동일한
실패가 반복됐기 때문이다. `v4`는 `v3`와 입력값이 바이트 단위로 동일한(두 버전의
`action.yml`을 직접 diff해 확인) 네이티브 `node24` 빌드라, 이 버전 업은 Node
런타임 불일치에 대한 드롭인 수정이지 동작 변경이 아니다. (실제 근본 원인은
웹 UI로 붙여넣는 과정에서 `DOCKER_USERNAME`/`DOCKER_PASSWORD` 시크릿 값에
섞여 들어간 이물 문자로 밝혀졌지만 — `v3`→`v4` 버전 업 자체는 그 별개의
자격증명 형식 문제와 무관하게, 애초에 진단하려던 Node 런타임 비호환성에 대한
올바른 근본 수정이므로 그대로 유지했다.)

## 결과

- **2026-08-30 실제 `dev` push로 엔드투엔드 라이브 검증 완료**: 6개 검증 잡
  전부 통과, `docker-publish`가 로그인(`v4`) 성공 → 스모크 테스트 컨테이너
  `healthy` 확인 → push까지 완료 — `bluecode1775/sharenpo:<sha>`가 Docker
  Hub에 **단일 아키텍처(`amd64`) 이미지**로 올라갔고, `:latest` 태그는 전혀
  건드리지 않았다(애초에 Docker Hub에 `:latest` 태그가 존재하지 않는다 —
  이전까지 Docker Hub의 모든 이미지가 수동 push였다는 뜻이고, 이 ADR 이전엔
  `docker-publish`가 성공적인 push에 도달한 적이 없었다는 것과 일치한다).
- [ROADMAP.md §7](../ROADMAP.ko.md#7-미일정--미결-사항)의 `image.tag: "latest"`
  스테일 배포 항목을 (b)안으로 닫는다. (a)안(`values.yaml`의 `image.tag`
  기본값 제거)과 (c)안(`dev`를 주기적으로 `main`에 병합)은 진행하지 않았다 —
  이 항목이 존재하는 이유인 "`dev`에서는 이미지가 전혀 빌드되지 않는다"는
  격차는 (b)만으로 닫힌다.
- 이 ADR을 라이브 검증하는 도중, `dev`가 이 경로들을 정말 실행한 적이
  없었던 탓에 무관한 기존 결함 2건이 드러나 함께 고쳐졌다:
  `test/app.e2e-spec.ts`의 `seedFile` 헬퍼가 [ADR
  0040](0040-persisted-media-type-for-playback.ko.md)의 `NOT NULL mediaType`
  컬럼 추가 이전 코드였던 것과, 위 `docker/login-action` 버전 업. 둘 다
  `CHANGELOG.md`에 기록했고 여기서 다시 서술하지 않는다 — 이 ADR은 CI 설계
  결정을 기록하는 것이지, 검증 도중 고친 결함 전부를 기록하는 게 아니다.
- `CLAUDE.md`의 CI/CD 섹션을 같은 변경에서 갱신했다 — 이제 `docker-publish`의
  존재, 브랜치별 태그/플랫폼 분리, 스모크 테스트를 언급하고(세부사항을
  다시 쓰지 않고 이 ADR을 인용), "`main`/`dev`로의 push/PR" 표현도 정정했다
  — `push`는 `main`+`dev`를 다루고 `pull_request`는 `main`만 다룬다(D1).
- 이 ADR 이전엔 `docker-publish`에 의존성 캐싱이 없었다 — D4의 스모크 테스트
  빌드가 이제 GitHub Actions 캐시(`type=gha`)를 쓰므로 이후 push 빌드가 그
  레이어를 재사용한다. 이 잡에 생긴 첫 캐싱이다.
