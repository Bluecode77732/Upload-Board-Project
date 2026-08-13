# ADR 0032: 마이그레이션을 컨테이너 부팅이 아닌 별도 배포 스텝으로 분리

- Status: Accepted
- Date: 2026-08-08
- 개정 대상: [ADR 0015](0015-docker-and-compose.md) (Decision: "Migrations on
  boot" — 런타임 `CMD`가 `node dist/main` 전에 `migration:run`을 실행)
- English: [0032-migration-as-separate-deploy-step.md](0032-migration-as-separate-deploy-step.md)

## Context

ADR 0015의 `CMD`는 컨테이너가 뜰 때마다 `migration:run` 실행 후 `node dist/main`을
실행하도록 돼 있고, 이는 `docker compose up`을 새 볼륨에 대해 단일 명령으로
끝내려는 의도였다. 이는 그 당시 범위였던 단일 인스턴스 로컬 개발 대상에는 맞는
선택이었다. 하지만 같은 이미지에서 인스턴스가 동시에 두 개 이상 뜨는 순간부터는
더 이상 맞지 않는다 — Kubernetes `Deployment`가 N개 레플리카로 스케일하거나,
롤링 업데이트 중 잠깐 구버전·신버전 파드가 함께 도는 상황이라면, N개의 컨테이너가
부팅 시점에 동시에 같은 DB를 향해 `migration:run`을 실행하려고 경합하게 된다.
TypeORM의 마이그레이션 러너는 동시 실행을 염두에 두고 설계되지 않았다 — 두
인스턴스가 동시에 "마이그레이션 X는 아직 적용 안 됨"을 읽고 둘 다 실행을
시도하면, 진 쪽은 실패하거나(더 나쁘게는 마이그레이션 형태에 따라) 이긴 쪽과
동시에 DDL을 부분적으로 적용해버릴 수 있다. 이는 정확히
[CLAUDE.md](../CLAUDE.md) > Scope Discipline이 마이그레이션 검토를 요구하는
바로 그 위험이며, ROADMAP.md > Stage 4는 "마이그레이션을 별도 배포 스텝으로
분리"를 다중 인스턴스로 가기 위한 명시적 선행 조건으로 꼽고 있다.

## Decision

- **`Dockerfile`의 `CMD`는 더 이상 마이그레이션을 실행하지 않는다.** `["node",
  "dist/main"]`뿐이다 — API 컨테이너가 부팅 시점에 하는 일은 스키마가 이미 맞다는
  전제 아래 트래픽을 서빙하는 것뿐이다.
- **`docker-compose.yml`에 one-shot `migrate` 서비스를 추가한다.** 같은
  이미지를 빌드하되 `command`를 덮어써서 예전 `CMD`가 하던 것과 정확히 같은 것을
  실행한다(`node node_modules/typeorm/cli.js migration:run -d
  dist/data-source.js`). `api`는 이제 기존의 `db: condition: service_healthy`에
  더해 `migrate: condition: service_completed_successfully`에도 의존한다. 그
  결과 `docker compose up`은 여전히 커밋된 마이그레이션을 API가 서빙을 시작하기
  전에 적용한다 — ADR 0015가 원했던 "새 볼륨에 대한 단일 명령" 속성은 그대로
  유지되지만, 순서는 이제 부팅 안에 암묵적으로 끼워 넣는 방식이 아니라 명시적으로
  "마이그레이션 먼저, 그다음 서빙" 방식이다.
- **이것은 앞으로 만들 Kubernetes 형태를 모델링하는 것이지, 그 자체를 구현하는
  것은 아니다.** 실제 다중 인스턴스 배포에서는 이에 대응하는 Kubernetes `Job`
  (또는 Helm pre-install/pre-upgrade 훅)이 필요하다 — 롤아웃마다 한 번, N개
  레플리카로 스케일하는 `Deployment`보다 먼저 실행돼야 한다. 그 매니페스트는 이번
  작업이 아니라 Stage 4의 Helm 작업 몫이다. 이번에 들어가는 것은 **이미지 레벨의
  선행 조건**이다 — 이미지는 더 이상 자신이 유일하게 `migration:run`을 실행할
  존재라고 가정하지 않고, 로컬 개발(`docker compose up`)이 이미 그 Job이 재현할
  "마이그레이션 후 서빙" 순서를 실제로 거친다.
- **`migration:run`은 계속 멱등이다**(ADR 0006/0015에서 변경 없음) — 이미 최신인
  스키마에 대해 `migrate`를 한 번 더 실행해도 안전한 no-op이다. 이 성질 덕분에
  "롤아웃 전체에서 한 번 이상 실행될 수도 있는 별도 스텝으로 돌린다"가 애초에
  안전해지는 것이고, 이 ADR은 락이나 리더 선출을 추가하지 않는다 — 락이 지키려는
  대상을 기존 멱등성이 이미 커버하기 때문이다.

## Alternatives rejected

- **부팅 시 마이그레이션을 유지하고 분산 락(예: `migration:run` 주변에 Postgres
  advisory lock)을 추가** — 경합 자체는 실제로 해결되지만, 분리-스텝 모델이
  구조적으로 회피하는 문제를 위해 락 획득·타임아웃·"준비됐지만 막혀 있는" 컨테이너
  상태 같은 진짜 새로운 복잡도를 들이는 셈이다. 미래에 정말로 롤아웃 전 스텝을
  실행할 수 없는 배포 형태를 만나면 그때 재검토한다.
- **TypeORM CLI + `dist/data-source.js`만 담는 전용 `Dockerfile` 타깃**(더
  가벼운 "migrator" 전용 이미지) — 더 큰 규모에서는 실제 프로덕션 관행이지만, 이
  프로젝트는 `Dockerfile` 하나에 이미지 하나로 두 역할(평소엔 `api`, `command`를
  덮어써서 `migrate`)을 다 감당하는 편이 이 규모에서는 더 단순하고 충분하다 —
  런타임 이미지 전체의 크기나 의존성 표면이 마이그레이션 스텝 자체에 문제가 될
  때 재검토한다.
- **ADR 0015가 남긴 상태 그대로 두고 Kubernetes Job에만 미룬다** — 부팅 시점
  결합은 K8s 매니페스트뿐 아니라 이미지 자체에 새겨져 있어서 기각했다. 매니페스트
  레이어만 고치고 이미지의 `CMD`는 계속 마이그레이션을 실행한다면, 로컬 `api`
  서비스를 스케일하는 순간 `docker compose up`이 경합하게 되고, 이미지는 자신이
  주장하는 결정을 실제로는 반영하지 못하는 상태로 남는다.

## Consequences

- `docker compose up`의 단일 명령 속성이 유지되며 엔드투엔드로 검증됐다(`db`
  healthy → `migrate` 실행 후 0으로 종료 → `api` 기동 → `GET /doc`과
  `GET /health/ready` 둘 다 응답).
- `Dockerfile`은 더 이상 TypeORM CLI 호출을 기본 `CMD`에 묶어두지 않는다 — 이
  이미지를 (compose의 `migrate` 스텝 없이) 직접 `docker run`하는 경우 이제
  스키마가 이미 최신이거나, `command`를 덮어써서 먼저 `migrate`를 스스로
  실행해야 한다 — 이는 실수가 아니라 의도된, 문서화된 동작이다.
- Kubernetes Job에 해당하는 부분은 여기서 만들지 않는다 — ROADMAP.md > Stage
  4의 Helm 작업으로 명시적으로 미루며, 이 ADR의 `docker-compose.yml` `migrate`
  서비스가 그때 포팅할 구체적인 로컬 모델을 제공한다.
- 스키마·엔티티·API 표면 변경 없음.
