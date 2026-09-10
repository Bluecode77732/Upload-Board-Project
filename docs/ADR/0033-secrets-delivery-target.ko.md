# ADR 0033: 시크릿 전달 목표 — Kubernetes Secrets, AWS Secrets Manager는 보류

- Status: Accepted (설계만 — 코드 변경 없음)
- Date: 2026-08-08
- 개정 대상: [ADR 0015](0015-docker-and-compose.md) (Decision: "Secrets never
  baked" — 로컬 개발은 `.env`/`env_file`; Consequences에서 프로덕션 등급이
  아니라고 이미 표시)
- 관련: [ADR 0029](0029-storage-port-adapter.md) (앱은 AWS 자격증명을 직접 읽지
  않는다 — SDK의 기본 provider chain이 해석한다)
- English: [0033-secrets-delivery-target.md](0033-secrets-delivery-target.md)

## Context

`.env` + `env_file`(ADR 0015)은 단일 로컬 개발 compose 스택에는 맞는 형태다 —
파일 하나, 머신 하나, 신뢰 경계 하나. 하지만 클러스터 배포로 가는 순간 더 이상
맞지 않는다 — `.env`를 올려둘 공유 파일시스템이 없고, 순환(rotation) 체계도
없고, 누가 언제 어떤 시크릿을 읽었는지 감사할 방법도 없다. 이 프로젝트의
`ConfigService` 전용 접근 규칙(CLAUDE.md > Architecture Decisions > Config)은
이미 애플리케이션 코드가 환경변수 값이 *어떻게* 도착했는지 전혀 모르게 만든다 —
`getOrThrow('X')`만 호출할 뿐이다. 바로 이 기존 경계 덕분에 이번 결정은 위험이
낮다 — 어떤 전달 메커니즘을 고르든 `backend/` 내부는 아무것도 바뀌지 않는다.

## Decision

- **목표 전달 메커니즘은 네이티브 Kubernetes `Secret`을 파드에 환경변수로
  마운트하는 것이다**(향후 Helm 차트의 `envFrom: secretRef`) — 앱 레벨에서
  시크릿 매니저 API와 직접 연동하는 방식이 아니다. 앱의 `ConfigService`/Joi
  경계는 지금 그대로 유지되고, 그 환경변수들의 *출처*만 바뀐다 — compose·로컬의
  `env_file: .env`에서 K8s·배포 환경의 클러스터가 주입하는 `Secret`으로.
- **AWS Secrets Manager를 도입한다면 앱 옆이 아니라 `Secret`의 상류에 둔다.**
  이 결정이 가리키는 실제 형태는 External Secrets Operator(ESO)가 AWS Secrets
  Manager의 항목을 네이티브 `Secret` 객체로 동기화하고, 정적 AWS 자격증명이
  아니라 IRSA(IAM Roles for Service Accounts)로 인증하는 구조다 — 다만 Secrets
  Manager 리소스 프로비저닝, IAM 롤, ESO 설치는 전부 아직 존재하지 않는
  Terraform/IaC 작업이다(ROADMAP.md > Stage 4 > production DevOps stack
  introduction). 이 ADR은 애플리케이션 코드가 Secrets Manager API를 직접
  호출하거나 AWS 자격증명을 직접 읽는 일이 앞으로도 없도록 못박는 것까지만
  한다 — ADR 0029의 기존 방침과 일치한다 — ESO/IAM 연동 자체는 만들지 않는다.
- **이 ADR과 함께 들어가는 코드 변경은 없다.** `.env`/`env_file`은 로컬
  `docker compose up`에 대해 ADR 0015가 남긴 그대로 유지된다 — 이 ADR은 목표
  결정을 지금 문서로 못박아, Helm 차트(다음 Stage 4 작업)와 그 뒤의 Terraform
  작업이 구현 도중에 "어떤 시크릿 메커니즘을 쓸지"를 다시 논쟁하지 않도록 하는
  것이 목적이다.

## Alternatives rejected

- **애플리케이션 코드가 AWS Secrets Manager를 직접 호출** — `@aws-sdk/
  client-secrets-manager` 패키지, `backend/` 내부의 자격증명 해석,
  캐싱/갱신 전략이 필요해진다. 지금은 부팅 시 한 번 읽는 환경변수일 뿐인 값에
  대해 이 모든 게 들어가는 것은 정확히 `ConfigService` 전용 경계가 막으려는
  복잡도다. `S3Storage`(ADR 0029)에서 SDK 기본 provider chain이 자격증명을
  해석하는 것은 S3 접근이 런타임 내내 일어나는 고유 동작이기 때문이지, 부팅
  시점 시크릿 조회가 아니다 — 같은 모양이 아니다.
- **HashiCorp Vault** — 더 강력한 선택지(동적 시크릿, 세밀한 리스, 감사 가능한
  버저닝)지만, 직접 띄우고 백업하고 unseal해야 하는 자체 상태 저장 서비스다 —
  포트폴리오 규모 프로젝트, 그리고 이미 확정된 실제 배포 타깃(AWS + Kubernetes,
  ROADMAP.md)이 별도 인프라 없이 네이티브로 답을 갖고 있는 상황(Kubernetes
  `Secret`, 필요하면 AWS Secrets Manager로 뒷받침)에 비해 운영 부담이
  불균형하다. Vault는 실제 멀티클라우드나 멀티테넌트 시크릿 요구가 생기면 후보로
  남겨두되, 지금은 아무것도 그것을 요구하지 않는다.
- **클라이언트 제공 값(`Idempotency-Key` 방식)이나 `Secret` 구분 없이
  ConfigMap만 쓰는 방식** — 여기엔 해당하지 않는다. 이 결정은 자격증명 성격의
  값(DB 비밀번호, JWT 시크릿)에 관한 것이고, Kubernetes는 이미 정확히 그
  구분(`ConfigMap` vs. `Secret`)을 1급 프리미티브로 두고 있다 — 다른 걸
  도입하는 건 타깃 플랫폼이 이미 하고 있는 구분을 재발명하는 셈이다.

## Consequences

- ADR 0032가 `migrate` 서비스를 위해 이미 바꾼 부분을 넘어서는 `.env.example`,
  Joi 스키마, `docker-compose.yml`의 즉시 변경은 없다 — 이 ADR은 순수하게
  Helm 작업이 구현할 목표를 기록해두는 것이다.
- Helm 차트(ROADMAP.md > Stage 4, 다음 작업)는 `Secret` 템플릿을 정의하거나
  외부에서 관리되는 것을 참조하고 `envFrom`을 연결할 것으로 예상된다 — 그 구현
  자체는 이 ADR의 범위 밖이다.
- AWS Secrets Manager / External Secrets Operator / IRSA 연동은
  ROADMAP.md > Unscheduled에 **아직 착수하지 않은 이유 — 실제 AWS 계정, IAM
  롤, ESO가 설치된 동작 중인 Kubernetes 클러스터가 필요한데 지금은 그중 아무것도
  존재하지 않기 때문**으로 기록하며, 그 전제조건들을 실제로 프로비저닝하는
  Terraform 도입 항목(ROADMAP.md > Stage 4)과 함께 착수하도록 스케줄링한다.
- Kubernetes 네이티브 `Secret` 값은 기본적으로 저장 시 base64 인코딩만 될 뿐
  암호화되지 않는다 — `etcd` 저장 암호화(또는 sealed-secrets 방식) 자체는 이
  ADR이 아니라 Terraform/K8s 작업의 클러스터 레벨 설정 결정이다 — 이미 해결된
  것처럼 보이지 않도록 여기 명시해둔다.
