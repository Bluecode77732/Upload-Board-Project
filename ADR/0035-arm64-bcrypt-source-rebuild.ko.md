# ADR 0035: arm64 지원 — `onlyBuiltDependencies`로 bcrypt 소스 재컴파일

- 상태: 승인됨
- 날짜: 2026-08-12
- 개정 대상: [ADR 0030](0030-container-non-root-and-arch-stance.ko.md) (결정: "타겟
  아키텍처는 당분간 x64 유지 — 알려진 제약으로 기록만 하고 해결하지 않음")
- English: [0035-arm64-bcrypt-source-rebuild.md](0035-arm64-bcrypt-source-rebuild.md)

## 맥락

ADR 0030은 `bcrypt`가 glibc/x64용 prebuilt 바이너리만 제공한다는 점을 기록하고,
arm64 지원 여부는 실제 배포 아키텍처가 정해진 뒤 "언젠가의 Terraform ADR"에서
결정하기로 미뤄뒀습니다. 그런데 그 전제(Terraform 노드 그룹 결정)가 아니라 전혀
다른 방향에서 필요가 생겼습니다 — 아키텍처를 통일한 하나의 이미지를 배포하려고
`docker buildx build --platform linux/amd64,linux/arm64`로 개인 Docker Hub
저장소(`bluecode1775/sharenpo`)에 푸시하려는 시도였고, ADR 0030이 상정했던
AWS/Terraform 노드 그룹 결정과는 무관합니다.

실패 원인을 조사하다가 이전에는 기록되지 않았던 사실을 하나 더 발견했습니다:
pnpm 10은 명시적으로 승인하지 않은 의존성의 설치 스크립트를 기본적으로 차단합니다
(`pnpm install` 자체 출력: `Ignored build scripts: @scarf/scarf, bcrypt,
unrs-resolver`). 다만 이게 amd64에서는 현재 아무 문제를 일으키지 않는다는 것도
로컬에서 직접 확인했습니다(`node -e "require('bcrypt').hashSync(...)"` 정상 동작,
기존 `node_modules` 기준) — `bcrypt`의 glibc/x64용 prebuilt 바이너리가 npm
패키지 안에 이미 번들되어 있어서 별도 설치 스크립트 없이도 로드되기 때문입니다.
반면 prebuilt가 아예 없는 arm64에서는, 원래라면 그 차단된 스크립트가 소스
재컴파일로 폴백해야 하는 지점이라, "스크립트가 차단됐다"는 사실과 "해당
아키텍처용 prebuilt가 없다"는 사실이 arm64에서만 겹쳐서 문제가 됩니다.

## 결정

- **`package.json`의 `pnpm.onlyBuiltDependencies`에 `bcrypt`를 추가**해 설치
  스크립트 실행을 명시적으로 승인합니다. amd64/glibc에서는 달라지는 게 없습니다
  (원래도 동작하던 prebuilt 바이너리 경로, 이미 검증함). arm64에서는 이제 허용된
  스크립트가 `node-gyp`를 통한 소스 컴파일로 폴백합니다 — `development` 빌드
  스테이지는 이미 전체 컴파일러 툴체인(`node:24.8.0`, `-slim` 아님)을 갖고
  있으므로 문제없습니다. bcrypt는 항상 그 스테이지에서만 빌드되고, `production`은
  이미 빌드된 `node_modules`를 복사만 합니다.
- Dockerfile 자체는 코멘트 외에 수정할 필요가 없었습니다: Docker Hub 공식
  `node:24.8.0` 태그는 `buildx --platform` 하에서 타겟 플랫폼에 맞는 베이스를
  자동으로 해석하고, full(비-slim) 버전은 소스 빌드에 필요한 컴파일러를 이미
  포함하고 있습니다.

## 검토했지만 채택하지 않은 대안

- **`bcryptjs`(순수 JS, 네이티브 바인딩 없음, 모든 플랫폼에서 컴파일 없이 동일하게
  동작)로 교체** — 이번엔 보류했을 뿐 완전히 배제하진 않았습니다. 아키텍처 문제
  자체는 없애주지만 순수 JS 해싱이라 네이티브 바인딩보다 눈에 띄게 느리고,
  `auth.service.spec.ts`를 비롯한 관련 목(mock)을 새 모듈 기준으로 재검증해야
  합니다. 소스 재컴파일 경로가 `buildx`의 QEMU 에뮬레이션 하에서 너무 느리거나
  불안정하다고 판명되면 쓸 대체안으로 남겨둡니다.
- **ADR 0030의 x64 전용 방침을 그대로 유지** — 기각. 이 ADR이 지원하려는
  멀티플랫폼 배포 자체가 깨지거나, arm64에서 비밀번호 해싱이 조용히 동작하지
  않는 이미지가 나올 수 있습니다.

## 결과

- `linux/arm64` 빌드는 이제 `development` 스테이지의 `pnpm install` 중에
  `bcrypt`의 `node-gyp` 컴파일을 시도합니다 — **실제 arm64 하드웨어나 `buildx`의
  QEMU 에뮬레이션으로는 아직 검증되지 않았습니다**. 동작을 확인했다고 단정하지
  않고 미검증 제약으로 기록해두는 ADR 0030의 선례를 그대로 따릅니다. arm64
  타겟의 빌드 시간은 (prebuilt 바이너리 fetch 대비 에뮬레이션 하의 네이티브
  컴파일이라) 늘어날 가능성이 높습니다.
- `linux/amd64` 동작은 변화 없음(bcrypt가 계속 prebuilt 바이너리를 로드함을
  확인).
- ADR 0030의 "타겟 아키텍처는 x64 유지" 항목만 개정하며, ADR 0030의 나머지 결정
  (non-root 유저, `HEALTHCHECK`, distroless 보류)은 그대로입니다.
- 스키마, 엔티티, API 표면 변경 없음.
