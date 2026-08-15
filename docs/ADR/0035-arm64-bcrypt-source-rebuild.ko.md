# ADR 0035: arm64 지원 — bcrypt는 이미 잘 동작함, `onlyBuiltDependencies`는 안전장치로 유지

- 상태: 승인됨
- 날짜: 2026-08-12
- 개정 대상: [ADR 0030](0030-container-non-root-and-arch-stance.ko.md) (결정: "타겟
  아키텍처는 당분간 x64 유지" — 아래에서 단순 보류가 아니라 정정함)
- English: [0035-arm64-bcrypt-source-rebuild.md](0035-arm64-bcrypt-source-rebuild.md)

## 맥락

ADR 0030은 `bcrypt`가 glibc/x64용 prebuilt 바이너리만 제공한다고 기록했고,
arm64 지원 여부는 실제 배포 아키텍처가 정해진 뒤 "언젠가의 Terraform ADR"에서
결정하기로 미뤄뒀습니다. 그런데 그 전제가 아니라 전혀 다른 방향에서 필요가
생겼습니다 — 아키텍처를 통일한 하나의 이미지를 배포하려고
`docker buildx build --platform linux/amd64,linux/arm64`로 개인 Docker Hub
저장소(`bluecode1775/sharenpo`)에 푸시하려는 시도였고, ADR 0030이 상정했던
AWS/Terraform 노드 그룹 결정과는 무관합니다.

조사 중에 pnpm 10이 기본적으로 의존성 설치 스크립트를 차단한다는 사실도
발견했습니다(`pnpm install` 자체 출력: `Ignored build scripts: @scarf/scarf,
bcrypt, unrs-resolver`). ADR 0030의 "prebuilt는 x64뿐" 주장과 합쳐서, 처음엔
이걸 arm64에서 겹치는 두 가지 문제로 읽었습니다 — prebuilt도 없고, 소스
컴파일로 폴백해야 할 설치 스크립트마저 차단됐다고요.

**이 ADR은 원래 그 판단에 따라 작성·커밋됐는데, 틀렸습니다.** 실제로 끝까지
검증해보니(`docker run --platform linux/arm64 node:24.8.0 sh -c "npm install
bcrypt"` 실행 후 같은 컨테이너 안에서 `require('bcrypt').hashSync(...)` 호출)
다음이 드러났습니다:
- 설치 로그에는 `node-gyp-build` 실행만 있고 `gyp`/`make`/컴파일 관련 출력이
  **전혀 없습니다**. `node-gyp-build`는 bcrypt가 쓰는 `prebuildify` 방식의 설치
  헬퍼로, npm 패키지 안에 이미 번들된 prebuilt `.node` 바이너리를 찾아 쓰고,
  그게 없을 때만 컴파일로 폴백합니다.
- `bcrypt@6.0.0`은 `x64`뿐 아니라 동작하는 `linux-arm64`/glibc prebuilt도
  번들하고 있습니다 — 이 프로젝트가 고정한 버전 기준으로는 ADR 0030의 전제가
  성립하지 않습니다.
- `require('bcrypt').hashSync(...)`가 QEMU 에뮬레이션 하에서 실제 해시를
  만들어내며 성공했습니다 — 번들된 prebuilt가 실제로(단순히 존재만 하는 게
  아니라) 쓰이고 있음을 확인한 것입니다.
- prebuilt 탐색이 설치 시점의 *스크립트*가 아니라, tarball에서 이미 풀린 파일을
  `node-gyp-build`가 require 시점에 읽는 방식으로 이뤄지기 때문에, pnpm의
  스크립트 차단은 애초에 어느 아키텍처에서도 bcrypt에 위협이 된 적이
  없습니다. 패키지 파일 압축 해제는 lifecycle 스크립트 실행 허용 여부와
  무관하게 항상 일어나고, pnpm이 막는 건 스크립트 자체뿐입니다.

## 결정

- **기록을 정정합니다**: arm64는 `bcrypt`에 컴파일 단계가 필요 없고, 이 ADR이
  원래 설명한 메커니즘으로는 애초에 컴파일이 일어날 일도 없었습니다. ADR
  0030의 "타겟 아키텍처는 x64 유지" 제약은 단순 개정이 아니라 **철회**합니다 —
  차단이 풀렸다는 정도가 아니라 실제로 동작함을 검증했습니다.
- **`package.json`의 `pnpm.onlyBuiltDependencies: ["bcrypt"]`는 그래도
  유지**합니다. 안전장치로서 비용이 없기 때문입니다: 지금은 아무 역할도 안 하지만
  (prebuilt 경로가 애초에 스크립트를 필요로 한 적이 없으므로), 향후 `bcrypt`
  버전이 올라가거나 이 프로젝트가 아직 타겟하지 않는 플랫폼에서 번들 prebuilt가
  없어지는 경우가 오면, 그 폴백 컴파일이 이미 사전 승인되어 있어 조용히
  스킵되는 것을 막아줍니다.
- 코멘트 정정 외에 Dockerfile 변경은 필요 없습니다 — 아키텍처별로 빌드가
  달라져야 할 이유가 없습니다.

## 검토했지만 채택하지 않은 대안

- **`bcryptjs`로 교체** — 해결해야 할 문제 자체가 없어졌으므로 더 이상 진행하지
  않습니다.
- **`onlyBuiltDependencies`를 완전히 되돌리기** — 안전장치로 유지하는 쪽을
  택했습니다(결정 참조): 비용이 없고, 지금은 잠재적이지만 실재하는 실패 모드를
  막아줍니다(번들 prebuilt가 없는 미래 버전/플랫폼이 이 ADR이 조사한 것과 같은
  차단된 스크립트 경로를 거쳐 조용히 실패하는 상황).

## 결과

- `linux/arm64` 빌드는 `linux/amd64`와 마찬가지로 bcrypt의 번들 prebuilt를
  씁니다 — 컴파일 단계가 없고, 이 의존성 기준으로는 두 플랫폼 간 빌드 시간
  차이가 의미 있게 없습니다. `--platform linux/arm64` 에뮬레이션 하의 독립된
  `npm install bcrypt` + `require('bcrypt').hashSync(...)` 실행으로 검증했고,
  전체 프로젝트의 `docker buildx build`로는 아직 검증하지 않았습니다(이
  Dockerfile의 실제 `pnpm install` 안에서도 동일하게 성립하는지 최소 한 번은
  확인해볼 가치가 있습니다).
- 현재 고정된 `bcrypt@6.0.0` 기준으로 ADR 0030의 "bcrypt prebuilt는 전부 x64"
  주장을 철회합니다 — ADR 0030의 나머지 결정(non-root 유저, `HEALTHCHECK`,
  distroless 보류)은 그대로입니다.
- 과정 기록: 이 ADR의 원래 버전은 나중에 뒤집힌 판단에 기반해 검증 없이
  작성·커밋됐습니다 — Hallucination Prevention의 "모든 가정을 실제 출력으로
  검증하라"는 코드뿐 아니라 ADR에도 그대로 적용됩니다.
- 스키마, 엔티티, API 표면 변경 없음.
