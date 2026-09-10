# ADR 0016: GitHub Actions 기반 지속적 통합(CI)

- 상태: 승인됨
- 날짜: 2026-07-25
- English: [0016-github-actions-ci.md](0016-github-actions-ci.md)

## 맥락

0-오류 lint 베이스라인과 통과하는 단위/e2e 스위트는 오직 사람의 기억으로만
유지되었다 — lint 오류나 실패하는 테스트가 머지되는 것을 막는 장치가 없었다. CI는
확정된 Stage 1 항목으로, 툴체인 고정([ADR 0014](0014-node-pnpm-version-pinning.ko.md),
설치 재현성 확보)과 컨테이너 Postgres 이미지 사용([ADR 0015](0015-docker-and-compose.ko.md),
e2e가 돌 DB 확보)이 이뤄지자 착수 가능해졌다. 지시는 명확하다 — 최소 파이프라인,
그 이상은 아님.

## 결정

- **단일 GitHub Actions 워크플로** — `.github/workflows/ci.yml`, `main`/`dev`에 대한
  `push`·`pull_request`에서 실행, `permissions: contents: read`.
- **두 잡.** `lint-and-unit`은 `lint:ci` + `pnpm test`(DB 불필요), `e2e`는
  `postgres:16` 서비스 컨테이너 대상으로 스위트를 실행한다. 단위 경로는 빠르고 DB가
  필요 없는 반면 e2e는 서비스가 필요해 분리했다 — 공통 신호는 빠르게, 실패 지점은
  정확하게.
- **툴체인은 고정값에서.** `actions/setup-node`에 `node-version-file: .nvmrc`를 주고
  `corepack enable`로 `packageManager` pnpm(ADR 0014)을 활성화한다. 워크플로가
  Dockerfile과 동일한 버전 출처를 읽으므로 YAML에 버전을 중복하지 않는다.
- **신규 `lint:ci` 스크립트** — `--fix` **없는** `eslint`. CI는 위반 시 조용히 고쳐
  통과시키는 게 아니라 실패해야 한다. `pnpm lint`(`--fix` 포함)는 로컬 편의용으로 유지.
- **e2e 환경 변수는 워크플로에서.** CI에는 `.env`가 없으므로 필요한 Joi 변수를 잡의
  `env:`로 주입한다(폐기용 시크릿). `postgres:16` 서비스(ADR 0015와 일치)는
  `pg_isready` 헬스체크를 두어 스텝이 준비를 기다리게 하고, `mkdir -p file/temp
  file/upload`로 승격 테스트가 쓰는 미추적 업로드 디렉터리를 다시 만든다.

## 기각된 대안

- **CI에서 `pnpm lint`(`--fix`) 실행** — 자동 수정 후 exit 0이라 실패해야 할 위반을
  숨긴다. `lint:ci`가 정직하게 게이트한다.
- **모든 것을 단일 잡으로** — 단위 실행마다 Postgres를 띄우게 만든다. 분리하면 DB 없는
  경로가 빠르고 실패 신호도 정확하다.
- **`pnpm/action-setup`** — 동작하지만, Corepack + `.nvmrc`가 ADR 0014의 단일 출처를
  추가 액션 없이 재사용하고 Dockerfile과도 일관된다.
- **CI에서 e2e 생략** — e2e 스위트는 요청→응답 경로의 주 회귀 안전망이다. 컨테이너 DB가
  한 줄이면 되는 지금, 이를 돌리는 것이 Stage 1 테스트 신뢰성의 핵심이다.

## 결과

- 2026-07-26 그린 검증: 두 잡(`lint-and-unit`, `e2e`) 모두 `dev`에서 CI 통과. (첫 실행은
  값어치도 증명했다 — 개발 DB에 이미 스키마가 있어 로컬에서 가려졌던 실제 e2e 결함을
  잡아냈고, `test/e2e-env.ts`에서 수정.)
- lint(0-오류)와 단위 + e2e 스위트가 매 push/PR에서 강제된다 — 기억이 아니라. CLAUDE.md가
  문서화한 베이스라인이 이제 기계로 검증된다.
- 아직 의존성 캐싱 없음 — 실행마다 재설치(최소 파이프라인에는 허용 가능; pnpm 스토어
  캐시는 이후 조이기).
- 배포 파이프라인은 아니다: 이미지 빌드/푸시, 환경 게이트 없음. 이는 Stage 4에서 도입된다
  (ROADMAP의 컨테이너·배포 하드닝 행 참고).
- CLAUDE.md의 "no CI workflow" / CI/CD "None" 서술은 이 워크플로(및 ADR 0015의
  Dockerfile) 존재를 반영해 갱신된다. git hook은 여전히 없다.
