# ADR 0030: 컨테이너 non-root 실행 — distroless·멀티아치는 보류

- Status: Accepted
- Date: 2026-08-08
- 개정 대상: [ADR 0015](0015-docker-and-compose.md) (Consequences: "root로 실행되며
  distroless 베이스도 없다... CI(Stage 1)와 Stage 4에서 다룬다")
- English: [0030-container-non-root-and-arch-stance.md](0030-container-non-root-and-arch-stance.md)

## Context

ADR 0015는 동작하는 멀티스테이지 이미지를 냈지만 프로덕션 하드닝은 명시적으로
미뤘고, 그중 하나가 컨테이너가 root로 실행된다는 점이다. root로 도는 프로세스가
있는 컨테이너가 뚫리면(의존성 RCE, 역직렬화 버그 등) 공격자는 컨테이너의 사용자
네임스페이스 안에서 root 권한을 그대로 넘겨받는다 — 노드를 여러 워크로드가 공유하는
Kubernetes 환경에서는 non-root 프로세스일 때보다 피해 반경이 훨씬 크다. 이번 작업은
ADR 0015가 미룬 컨테이너/배포 하드닝의 첫 항목이자, 이미지를 오케스트레이터에 올릴
수 있는 상태로 만드는 직접적인 선행 조건이다(ROADMAP.md > Stage 4 > production
DevOps stack introduction).

## Decision

- **런타임 스테이지에 전용 non-root 사용자를 추가한다.** `node:24.8.0-slim` 런타임
  스테이지(베이스 자체는 그대로 유지 — Alternatives rejected 참고)에서 시스템
  그룹/사용자(`appuser`, uid/gid 1001)를 만들고, `/app` — 2단계 업로드 계약이 쓰는
  `file/temp`/`file/upload` 디렉터리를 포함해 — 를 `chown`한 뒤 `CMD` 전에 `USER
  appuser`로 전환한다.
- **`HEALTHCHECK` 지시문을 추가한다.** 새로 생긴 `GET /health/live` 엔드포인트
  ([ADR 0031](0031-health-and-readiness-endpoints.md))를 Node 자체 `http` 모듈로
  호출한다 — `slim` 베이스에 `curl`/`wget` 패키지를 추가할 필요가 없어 이미지
  크기나 공격 표면에 아무 비용도 들지 않는다.
- **타깃 아키텍처는 당분간 x64로 유지하고, 해결이 아니라 제약으로만 문서화한다.**
  `bcrypt`는 glibc 프리빌드로 배포되고, 빌드 스테이지가 이미 런타임과 동일한
  glibc를 보장하지만(ADR 0015가 `alpine` 대신 `slim`을 고른 근거와 동일선상), 그
  프리빌드는 전부 x64다. ARM/Graviton 노드 그룹으로(실제로 AWS 비용을 줄이는
  선택지다) 옮기려면 `pnpm.onlyBuiltDependencies`로 ARM 빌드 스테이지에서 `bcrypt`를
  소스부터 재빌드하거나, 순수 JS 구현인 `bcryptjs`로 바꿔야 한다. 둘 다 지금 하지
  않는다 — 실제 인스턴스 아키텍처는 아직 존재하지 않는 Terraform/노드 그룹 결정
  (ROADMAP.md > Stage 4) 사안이고, 아무것도 돌지 않을 아키텍처를 위해 미리 빌드하는
  것은 이 프로젝트의 Scope Discipline이 배제하는 추측성 작업이다. 이 ADR은 나중에
  나올 Terraform ADR이 같은 제약을 다시 발견하지 않도록 기록만 남긴다.

## Alternatives rejected

- **지금 `gcr.io/distroless/nodejs*-debian12`로 전환** — distroless는 쉘이 없어
  공격 표면이 최소화되고 기본적으로 non-root로 뜨지만, 이번 변경에서 채택을 막는
  두 가지가 있다. (1) distroless는 메이저 버전 태그(`nodejs22-debian12` 등)만
  배포하는데, `nodejs24` 태그가 실제로 존재하는지 이 결정 시점에 **실물 레지스트리로
  검증하지 않았다** — 검증했다가 없다는 걸 알게 되면 이번 하드닝 작업 전체가 태그
  존재 여부라는 무관한 문제에 발목 잡히게 된다. (2) 쉘이 사라지면 이 프로젝트가
  지금 가진 유일한 디버깅 경로(`docker exec`)도 함께 사라지는데, 그걸 대체할
  K8s 네이티브 수단(ephemeral debug container, `kubectl debug`)은 아직 없다 —
  그 대체 도구가 갖춰지기 전에 distroless부터 도입하면 상쇄할 클러스터 도구 없이
  디버깅 능력만 순손실이다. ROADMAP.md > Unscheduled에 별도 후속 항목으로 남기고,
  태그 존재가 확인되고 K8s 단계가 ephemeral-debug 도구를 갖춘 뒤 다시 검토한다.
- **지금 멀티아치(`buildx --platform linux/amd64,linux/arm64`) 빌드** — `bcrypt`
  소스 재빌드 경로나 의존성 교체가 필요하고, 실제 ARM 하드웨어/에뮬레이션으로
  검증해야 하는데, 아직 어떤 배포 타깃도 그 아키텍처를 선택하지 않았다. 실제
  인스턴스 패밀리를 고르는 Terraform/노드 그룹 ADR로 미룬다.
- **전용 사용자/`chown` 대신 `chmod 777`** — 프로세스 소유자를 여전히 root로 둔 채
  권한만 넓히는 방식이라 실제 위험(컨테이너 안에서 프로세스 소유자가 갖는 권한)을
  다루지 못한다 — non-root의 대체재가 될 수 없다.

## Consequences

- 이미지가 더 이상 root로 실행되지 않는다 — 컨테이너 내부 프로세스가 뚫려도
  컨테이너의 사용자 네임스페이스 안에서 root 권한을 갖지 못한다.
- **잔여 위험, 문서화만 하고 해결하지 않음**: `docker-compose.yml`의 바인드 마운트
  (`./file:/app/file`, 로컬 개발 전용)는 네이티브 Linux 호스트에서 호스트 측
  소유권을 그대로 유지한다. 호스트 디렉터리가 컨테이너의 1001과 다른 uid로
  소유돼 있으면 `appuser`가 그 안에 쓰기를 못 해서, 로컬 `docker compose up`이
  파일 승격/서빙에 실패한다. Windows/Mac Docker Desktop의 바인드 마운트 변환
  계층에는 영향이 없다. 이 문제를 만나는 Linux 기여자는 호스트 `./file` 디렉터리를
  한 번 uid 1001로 `chown`하면 된다(`sudo chown -R 1001:1001 file/`) — README.md에
  문서화만 하고 자동화하지는 않는다. 자동화하려면 Dockerfile이 컨테이너 밖으로
  나가 호스트 파일시스템 상태를 바꿔야 하기 때문이다.
- distroless와 멀티아치는 계속 미착수 항목으로 남는다(ROADMAP.md > Unscheduled) —
  각각 막연한 "언젠가"가 아니라 구체적인 선행 조건(레지스트리 태그 확인, 확정된
  배포 아키텍처)에 걸려 있는 상태로 기록한다.
- Joi 스키마, 엔티티, API 표면 변경 없음 — 이 ADR은 Dockerfile 한정이다.
