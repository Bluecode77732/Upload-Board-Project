# ADR 0031: Liveness/Readiness 엔드포인트

- Status: Accepted
- Date: 2026-08-08
- 개정 대상: [ADR 0015](0015-docker-and-compose.md) (Consequences: "health
  엔드포인트도 없다... CI(Stage 1)와 Stage 4에서 다룬다")
- English: [0031-health-and-readiness-endpoints.md](0031-health-and-readiness-endpoints.md)

## Context

이 API에는 "프로세스가 살아 있는가", "지금 트래픽을 받아도 되는가"에 답해주는
것이 아무것도 없다. 로드 밸런서나 Kubernetes는 전용 신호 없이는 죽은 DB 커넥션에
물린 인스턴스를 우회시킬 수도, 느리게 뜨는 중인 인스턴스와 죽은 인스턴스를 구분할
수도 없다 — ROADMAP.md > Stage 4의 오케스트레이터 작업이 성립하기 위한 필수
선행조건이지, 있으면 좋은 선택 사항이 아니다.

## Decision

- **새로운 운영용 모듈 `HealthModule`** (`backend/health/`) — `TempCleanupModule`/
  `StorageModule`이 세운 선례를 따른다(Project-Specific Principles > Module
  Responsibility): 인프라/횡단 관심사는 도메인 모듈에 얹지 않고 자체 모듈을
  갖는다. 기존 도메인 모듈(`FileModule`, `UserModule` 등) 어디에도 "프로세스/DB에
  도달 가능한가"라는 개념을 책임질 자리가 없다.
- **두 개의 엔드포인트, 둘 다 설계상 인증 없음**: `GET /health/live`(liveness —
  프로세스가 HTTP에 응답할 수 있는지만 확인, 의존성 체크 없이 항상 200)와
  `GET /health/ready`(readiness — 여기에 더해 주입된 `DataSource`로 `SELECT 1`을
  실행; 성공하면 200, 실패하면 `ServiceUnavailableException`으로 503). 둘 다
  `@UseGuards(JwtAuthGuard)`를 달지 않는다 — kubelet/LB 프로브는 Bearer 토큰을
  들고 오지 않고, 이 프로젝트는 `JwtAuthGuard`를 전역 `APP_GUARD`가 아니라
  컨트롤러 클래스별로 적용하므로 데코레이터를 그냥 생략하는 것만으로 충분하다 —
  새 가드나 허용목록 메커니즘을 도입하지 않는다.
- **DB ping은 컨트롤러가 아니라 `HealthService.checkDatabase()`에 둔다** — 이
  프로젝트의 커버리지는 서비스만 측정하고(`package.json`의 `jest` 설정), Nest를
  부팅하지 않고도 테스트 가능하게 만드는 편이 코드베이스의 다른 모든 서비스와
  일치한다. 실패 시 실제 에러는 `Logger`로 `error` 레벨에 남기고, 클라이언트에는
  항상 일반화된 503 메시지만 보인다(Never Do Group 3 — Error Transparency: 내부
  상세는 서버 쪽에만 남는다).
- **새 DTO·엔티티·Joi 환경변수 없음.** readiness 체크는 이미 주입돼 있는
  `DataSource`를 그대로 쓴다(`TypeOrmModule.forRootAsync`의 내부 모듈이
  `@Global()`이라 `TypeOrmModule`을 다시 import할 필요가 없다 — `FileService`가
  지금도 `DataSource`를 직접 주입받는 것과 같은 이유).
- **Swagger**: 컨트롤러에 `@ApiTags('health')`, `/health/ready`에 200/503
  `@ApiResponse` — 클라이언트에 노출하는 문서화된 기능이 아니라 운영용
  엔드포인트라 최소한으로 둔다.
- **`Dockerfile`의 새 `HEALTHCHECK` 지시문**(ADR 0030)은 readiness가 아니라
  `GET /health/live`를 호출한다 — Docker의 `HEALTHCHECK`는 반복 실패 시 컨테이너를
  재시작하는데, *DB*가 잠깐 끊겼다고 멀쩡한 프로세스를 재시작해봐야 아무것도
  고쳐지지 않고 부팅 루프만 돈다(문제는 프로세스가 아니라 DB다). readiness는
  컨테이너 자체의 재시작 정책이 아니라 오케스트레이터의 트래픽 라우팅 판단을 위한
  것이다 — 이 ADR이 의도적으로 유지하는 구분이며, 다음 Stage 4 작업의 Kubernetes
  매니페스트는 이에 맞춰 `/health/live`를 `livenessProbe`에, `/health/ready`를
  `readinessProbe`에 연결한다.

## Alternatives rejected

- **`@nestjs/terminus`** — NestJS의 표준 헬스체크 패키지지만, `@Get()` 핸들러
  두 개와 `SELECT 1` 하나로 이미 충분한 것에 새 런타임 의존성을 추가하는 셈이다.
  Scope Discipline은 새 의존성 도입에 근거를 요구하는데, 지금은 Terminus의
  indicator 조합 기능이 값어치를 할 만한 지점(디스크 용량 체크, 메모리 힙 체크,
  여러 다운스트림 서비스)이 없다. 나중에 두 번째 의존성(예: 메시지 큐)이 자체
  indicator를 필요로 하면 그때 재검토한다.
- **엔드포인트 하나로 통합(`/health`)** — 서로 다른 두 소비자(컨테이너 런타임 vs.
  오케스트레이터의 트래픽 라우팅)를, 같은 장애에 대해 서로 다른 게 맞는 응답을
  요구하는데도 하나로 뭉뚱그린다(위 `HEALTHCHECK` 근거 참고) — 나중에 breaking
  change 제약 아래서 쪼개는 대신 처음부터 분리했다.
- **공유 시크릿으로 엔드포인트를 가드하거나 내부망 전용으로 가정** — 프로브는
  구조상 같은 클러스터 안 트래픽이고(kubelet → pod, LB → target group) Bearer
  토큰을 들고 오지 않는다. 여기에 인증을 걸면 공격자 입장에서 얻는 이득 없이
  모든 오케스트레이터의 기본 프로브 클라이언트만 깨진다(`GET /health/live`는
  민감한 내용을 아무것도 드러내지 않는다 — Never Do Group 3가 문제 삼는 것은
  응답 *내용*이고, 이 응답에는 그런 내용이 없다).

## Consequences

- `docker compose up`의 `api` 서비스, 그리고 앞으로의 모든 Kubernetes 배포를
  프로브할 수 있게 된다. DB 장애가 이제 모든 요청이 개별적으로 타임아웃/500나는
  대신 readiness의 타입 있는 503 하나로 드러난다.
- `backend/app.module.ts`에 import 한 줄(`HealthModule`)이 추가된다 — 이번
  변경이 high-blast-radius 파일에 가하는 유일한 손질이다.
- Swagger에 문서화되는 클라이언트 대상 기능은 추가되지 않는다 — `README.md`의
  API Endpoints 섹션에는 애플리케이션 소비자가 아니라 운영자를 위해 두 라우트를
  적어둔다.
- 커버리지: `HealthService.checkDatabase()`는 `DataSource`를 모킹해 유닛
  테스트하고, `HealthController`는 이 코드베이스의 다른 모든 컨트롤러와
  마찬가지로 정책상 커버리지 대상에서 제외된다.
