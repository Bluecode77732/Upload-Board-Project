# ADR 0066: 스택 선택 근거

- Status: Accepted — 소급 기록. 코드, 스키마, API 변경 없음
- Date: 2026-10-12
- Relates to: [ADR 0009](0009-rest-only-api-with-swagger.ko.md) (NestJS 컨트롤러로 REST), [ADR 0043](0043-terraform-project-adaptation.ko.md)과 [ADR 0047](0047-observability-prometheus-grafana.ko.md) (이미 적혀 있던 AWS·관측 스택의 이유), [ADR 0053](0053-global-rate-limiting.ko.md)과 [ADR 0054](0054-per-route-rate-limit-tuning.ko.md) (요청 횟수 한도 수치), [ADR 0065](0065-multi-file-upload-client-sequential.ko.md) D4 (한 번에 15개)
- English: [0066-stack-selection-rationale-retroactive.md](0066-stack-selection-rationale-retroactive.md)

## Context

이 프로젝트의 모양을 정하는 선택 네 가지에 기록된 이유가 없다. 2026-10-12에 `docs/`, `README.md`,
`frontend/`, 변경 이력을 검색해 찾은 것은 아래 표가 전부다.

| 선택 | 저장소에 이미 적혀 있는 것 | 적혀 있지 않은 것 |
|---|---|---|
| NestJS, TypeORM, PostgreSQL | 첫 커밋(2025-12-17)이 이미 NestJS 앱이다([CHANGELOG.md](../CHANGELOG.md), "Initial application"). ADR 0009: "REST only, via NestJS controllers." | 왜 이 셋인가. |
| Helm·Terraform을 쓰는 AWS/EKS | ROADMAP §6은 "업계 표준 DevOps 툴체인"이라고 적는다. ADR 0043이 RDS(D2), Graviton 노드(D3), ACM(D4)의 이유를, ADR 0047이 Prometheus와 Grafana의 이유를 적는다. | 컨테이너를 돌리는 다른 방법이 아니라 왜 AWS와 Kubernetes인가. ECS나 Fargate를 언급한 문서는 없다. |
| 상태·데이터 패칭 라이브러리가 없는 `frontend/` | `frontend/CLAUDE.md`: 추가하지 말고, 근거를 붙여 먼저 제안한다. 스택 자체인 React + Vite는 2026-07-24에 정했다(ROADMAP §7). | 왜 필요하지 않았는가. |
| 분당 100 / 5 / 15회 | ADR 0053 D1: "보수적인 기본값". ADR 0054: 자격 증명 라우트와 `POST /upload/attach`를 좁혀야 할 표면으로 본다. ADR 0065 D4: attach가 분당 15회로 제한돼서 한 번에 15개. | 숫자가 어디서 나왔는가. |

이유는 2026-10-12에 개발자가 직접 밝혔다. 이 ADR은 그것을 저장소가 이미 보여 주는 내용 옆에 적고,
기록되지 않았거나 측정하지 않은 부분은 그렇다고 분명히 쓴다.

위의 날짜는 이 글을 쓴 날이지 선택을 한 날이 아니다. 스택은 2025-12-17부터, AWS 도구는 2026-07-23에
계획에 들어왔고(ROADMAP, Consistency note), 프론트엔드 스택은 2026-07-24에 정했고, 요청 횟수 한도는
2026-09-10에 들어왔다.

## 결정

### D1 — NestJS, TypeORM, PostgreSQL

트래픽이 크게 늘면 서비스 단위로 나눌 수도 있다는 점을 염두에 두고 골랐다. 이에 더해 NestJS의 모듈과
의존성 주입 구조가 이 프로젝트가 기대는 모듈 분리(Auth, User, File, Post, Comment, Upload)를
프레임워크 차원에서 뒷받침하고, 여기서 쓰는 Passport, Swagger, Throttler에 공식 통합이 있다. TypeORM은
NestJS와 잘 맞고, 수동 트랜잭션 패턴에 필요한 `QueryRunner`를 제공한다
([ADR 0004](0004-transaction-pattern-selection.ko.md)).

PostgreSQL은 설계가 실제로 기대는 쪽이다. `23505`와 `23503`을 타입이 있는 결과로 바꾸는 설계
([ADR 0019](0019-upload-claim-idempotency.ko.md), [ADR 0023](0023-board-domain-schema.ko.md))와
제목 검색을 받치는 `pg_trgm` GIN 인덱스([ADR 0049](0049-performance-capacity-criteria.ko.md))가 그렇다.

서비스 단위로 나눈다는 생각은 앞날을 내다본 것일 뿐이다. 지금 있는 것은 replica 하나짜리 레이어드 모듈러
모놀리스이고(ROADMAP §4), 서비스 메시를 넣지 않은 이유는 ROADMAP §7에 있다. 준비라고 부를 만한 것은
`exports`/`imports` 계약으로만 대화하는 모듈 경계와 `FileStorage` 포트다. 지금 당장 수평 확장을 막는 것은
둘이다. 인스턴스 메모리에 있는 요청 횟수 카운터([ADR 0053](0053-global-rate-limiting.ko.md))와 `local`
스토리지 기본값([ADR 0029](0029-storage-port-adapter.ko.md))이다.

### D2 — Helm·Terraform을 쓰는 AWS/EKS

이유는 둘이다. Kubernetes에는 그대로 가져다 쓸 수 있는 생태계가 있다. 릴리스는 Helm, 클러스터는
Terraform 모듈, 관측은 Prometheus와 Grafana다. 그리고 배포 시장에서 표준으로 쓰이는 도구를 익히는 것
자체가 이 프로젝트의 목표였다. ADR 0001이 HTTP 인증 방식 전반을 익히는 것을 목표로 적은 것과 같다.
ROADMAP §1은 이 프로젝트를 포트폴리오이자 학습용 백엔드라고 설명한다.

그 선택 안쪽 부분의 이유는 ADR 0043(RDS, Graviton, ACM)과 ADR 0047(Prometheus, Grafana, 매니지드
AMP/AMG를 기각한 이유)에 있다.

이 선택을 할 때 ECS, Fargate 같은 다른 컨테이너 서비스와의 비교를 글로 남기지 않았고, 이 ADR도 그것을
꾸며 내지 않는다. 기록으로 남아 있는 비용은 EKS 컨트롤 플레인, RDS, NAT 게이트웨이, ALB의 시간당
요금이다([ADR 0043](0043-terraform-project-adaptation.ko.md) D1).

### D3 — 상태·데이터 패칭 라이브러리가 없는 프론트엔드

`frontend/`는 화면이 적고 서버 상태가 목록과 상세 정도다. `fetch` 래퍼와 컴포넌트 상태로 충분했고,
라이브러리는 의존성과 번들 크기, 유지 부담만 늘렸을 것이다. `fetch`로는 부족했던 곳도 `frontend/README.md`에
적혀 있다. 업로드 진행률은 같은 파일 안의 `XMLHttpRequest` 경로를 쓰는데, `fetch`에는 업로드 진행 이벤트가
없기 때문이다.

`admin/`은 일부러 다르다. Chat Project에서 이미 Zustand와 axios로 만든 코드를 가져왔고
([ADR 0022](0022-admin-console-import-from-chat-project.ko.md)), 다시 쓰지 않고 적응시켰다.

나중에 라이브러리를 넣을 때는 `frontend/CLAUDE.md`의 규칙을 따른다. 근거를 붙여 먼저 제안한다.

### D4 — 요청 횟수 한도 수치

- **분당 100회**는 전역 기본값이다. ADR 0053 D1이 개발자가 요청한 보수적인 단일 기본값으로 기록했다.
- **분당 5회**는 `register`, `signin`, `token/refresh`에 적용한다. 사람이 오타를 내고 다시 시도할 수는
  있고, 스크립트가 비밀번호를 추측하는 속도는 분당 몇 번으로 줄인다.
- **분당 15회**는 `POST /upload/attach`에 적용한다. [ADR 0065](0065-multi-file-upload-client-sequential.ko.md)
  D4의 한 번에 15개 상한과 같은 숫자이기도 하다.

판단으로 정한 값이다. 부하 테스트나 악용 데이터는 근거로 쓰지 않았다. ADR 0053이 이미 짚은 replica 둘
이상으로의 전환 때 다시 본다. 그때까지 카운터는 인스턴스별이기 때문이다.

## 결과

- 이 네 가지 선택에 대한 "왜?"에 이제 가리킬 문서가 있다. 그 문서는 개발자가 밝힌 이유가 어디까지이고
  글로 따져 보지 않은 부분이 어디인지도 함께 적는다.
- D1의 서비스 분리 이야기를 마이크로서비스가 있거나 예정돼 있다는 주장으로 읽어서는 안 된다. 현재
  아키텍처를 말하는 것은 계속 ROADMAP §4와 §7이다.
- 메우지 않고 기록해 둔 공백이 둘 있다. ECS/Fargate와의 비교가 없고, 요청 횟수 한도 수치는 측정하지
  않았다.
- `CLAUDE.md`는 바꾸지 않는다. Architecture Decisions는 이 선택들을 이미 확정된 것으로 다룬다.
  [ARCHITECTURE.ko.md](../ARCHITECTURE.ko.md)에는 이 ADR을 가리키는 한 줄을 더한다.
