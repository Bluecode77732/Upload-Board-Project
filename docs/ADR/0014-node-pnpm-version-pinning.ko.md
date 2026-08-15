# ADR 0014: Node.js·pnpm 버전 고정

- 상태: 승인됨
- 날짜: 2026-07-25
- English: [0014-node-pnpm-version-pinning.md](0014-node-pnpm-version-pinning.md)

## 맥락

`pnpm-lock.yaml`은 모든 의존성을 고정하지만 *툴체인*은 무엇도 고정하지 않았다.
CLAUDE.md는 Node와 pnpm이 미고정 상태(`.nvmrc` 없음, `engines` 필드 없음)라고
명시해 왔다. 기여자나 빌드 머신이 다른 Node·pnpm 메이저 버전을 쓰는 환경 드리프트는
진단하기 어려운 잠재적 실패 원인이며, 재현 가능한 빌드 대상이 생기는 순간 곧바로
현실적인 실패 원인이 된다. 툴체인 고정은 Stage 1 기반 작업의 첫 항목이자, 뒤따르는
두 작업의 선행 조건이다 — Docker 베이스 이미지 태그와 CI의 `setup-node`/pnpm 버전이
모두 파생될 단일 출처가 필요하기 때문이다.

## 결정

- **`.nvmrc` = `24.8.0`** — 스위트가 검증된 정확한 런타임(Node 24 "Krypton" LTS
  라인). `nvm`/`fnm` 사용자는 `nvm use`로 권장 버전을 그대로 얻는다.
- **`engines` 하한** — `node >= 24`, `pnpm >= 10`. 동일 버전 강제가 아니라 하한이다.
  pnpm의 `engine-strict`는 **끈 상태**로 두어 `engines`가 차단이 아니라 경고로 동작한다
  — 같거나 더 새로운 툴체인은 그대로 설치되고, 이 필드는 최소 버전을 문서화하며
  Docker·CI가 참조할 값이 된다.
- **`packageManager: "pnpm@10.14.0"`** — Corepack의 정확한 고정. Corepack은 Node에
  기본 포함되므로 추가 도구가 필요 없고, Docker 이미지와 CI가 pnpm 버전을 읽는 단일
  출처가 된다.
- **범위: 고정만.** 이 값을 소비하는 작업(Docker/compose, CI)은 각자의 기록을 가진
  별도의 Stage 1 작업이며, 이 ADR은 출처만 확립한다.

## 기각된 대안

- **`engines` 정확 일치(`node: "24.8.0"`)** — 지나치게 취약하다. 패치 버전이 오를
  때마다 아무 이득 없이 설치가 실패한다. 정확한 권장값은 `.nvmrc`가 이미 담고 있고
  `engines`는 호환 하한이다.
- **Volta 고정** — 기여자마다 별도 도구를 설치해야 한다. Corepack은 Node에 포함되고
  `.nvmrc`는 `nvm`/`fnm` 표준이라 새 선행 조건이 없다.
- **`engine-strict = true`** — 버전 불일치 시 설치를 강제로 차단한다. 이 초기 단계의
  포트폴리오 프로젝트에는 과하다. 어차피 CI가 하한을 강제하게 되면 그때 조이는 편이 낫다.
- **미고정 유지** — 문서화된 공백 그대로다. 재현 가능한 Docker 이미지와 의미 있는 CI를
  가로막고 환경 드리프트를 살아있는 실패 원인으로 남긴다.

## 결과

- CLAUDE.md의 "Reproducible Builds" 항목이 갱신된다: 툴체인이 이제 고정되었다
  (`.nvmrc` + `engines` + `packageManager`), 더 이상 "버전 미고정"이 아니다.
- Docker 베이스 이미지 태그(Stage 1)와 CI 툴체인 버전이 그때그때 임의로 정해지는 대신
  단일 출처에서 파생된다.
- `engines`는 권고적이다(`engine-strict` 꺼짐): 너무 낮은 툴체인에 경고를 띄울 뿐
  설치를 실패시키지 않는다. 강제는 CI와 함께 도입된다.
- 런타임 상향은 세 줄 변경(`.nvmrc`, `engines.node`, pnpm 상향 시 `packageManager` +
  `engines.pnpm`)이며 다른 변경과 동일하게 리뷰된다.
