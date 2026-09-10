# ADR 0034: HTTPS 종단은 Ingress에서, 앱 안에서는 하지 않는다 (설계만)

- Status: Accepted (설계만 — 코드 변경 없음)
- Date: 2026-08-08
- 개정 대상: [ADR 0015](0015-docker-and-compose.md) (Consequences에서 "HTTPS도
  없다"를 미뤄둔 프로덕션 하드닝으로 표시)
- 관련: [ADR 0012](0012-refresh-cookie-rotation.md) (refresh 쿠키의 `Secure`
  플래그는 `ENV === 'prod'`일 때 켜지는데, 이게 맞으려면 브라우저가 실제로 보는
  연결이 HTTPS여야 한다)
- English: [0034-https-termination-stance.md](0034-https-termination-stance.md)

## Context

refresh 토큰 쿠키(`backend/auth/auth.controller.ts`의
`refreshCookieBaseOptions`)는 이미 `ConfigService.getOrThrow('ENV') === 'prod'`일
때마다 `secure: true`를 건다. 이 플래그가 맞으려면 브라우저가 이 API라고 인식하는
대상과의 실제 연결이 HTTPS여야 한다 — 브라우저가 평문 HTTP로 보는 연결 위에서
`Secure` 쿠키는 그냥 버려지고, prod에서 refresh/rotation이 조용히 깨진다. 지금
Node 프로세스는 평문 HTTP로만 리슨하고(`app.listen`, `main.ts`), 그 앞에서 TLS를
종단해주는 것은 아무것도 없다. 이건 ADR 0012 이후 계속 존재해온 실제 공백이고,
아직 `ENV=prod`로 배포된 게 없어서 잠복해 있을 뿐이다.

## Decision

- **TLS 종단은 ingress/로드밸런서 레이어에서 하고, Node 프로세스 안에서는 절대
  하지 않는다.** 목표로 하는 AWS + Kubernetes 형태(ROADMAP.md > Stage 4)에서는
  Kubernetes `Ingress`(또는 AWS Load Balancer Controller를 통한 AWS ALB)가
  인증서(ACM 발급, 또는 cert-manager + Let's Encrypt)를 들고 파드에는 평문
  HTTP로 전달한다. 이것이 표준적인 클라우드 네이티브 분리 방식이다 — 모든
  워크로드가 저마다 인증서와 갱신 로직을 들고 있는 대신, 클러스터/서비스당
  종단점 하나만 둔다.
- **이 ADR과 함께 들어가는 코드 변경은 없다.** `main.ts`는 계속 평문 HTTP로
  리슨하고, `refreshCookieBaseOptions`의 기존 `secure: ENV === 'prod'` 게이트는
  이 목표 형태에 대해 이미 정확히 맞는 코드라 바꿀 게 없다 — 이미 "prod에서는
  이 앞의 무언가가 TLS를 종단해준다"를 전제로 하고 있고, 그게 정확히 이 ADR이
  구축하기로 못박는 내용이다. 이 ADR은 Helm/Ingress 작업이 들어가기 전에 그
  전제를 미리 기록해둬서, Ingress 작업이 "prod에서 왜 `Secure`가 무조건
  켜지는가"를 다시 따져보지 않아도 되게 하려는 목적이다.
- **신뢰 경계**: TLS가 ingress에서 종단되고 나면, ingress → 파드 구간은
  클러스터 사설 네트워크 안의 평문 HTTP다. 이는 받아들여지는 클라우드 네이티브
  신뢰 경계다(지금도 compose 네트워크 안에서 이 프로젝트의 `db` 연결이 이미
  암호화 없이 건너는 것과 같은 경계) — 파드 간 트래픽 암호화(서비스 메시, mTLS)는
  이 ADR이 다루지 않는, 훨씬 더 무거운 별도 결정이다.

## Alternatives rejected

- **Node 프로세스 안에서 TLS 종단**(`https.createServer` + 파드에 마운트한
  인증서 파일) — 인증서 프로비저닝, 갱신, 개인키 취급을 애플리케이션 코드와
  이미지 설정 안으로 끌고 들어오고, 레플리카마다 중복된다. ingress/ALB 모델은
  이 일을 하도록 설계된 한곳에 전부 모아둔다. 또한 ADR 0030의 non-root·공격
  표면 축소 방향과도 긴장 관계다 — 앱 컨테이너 안에 개인키 자료가 있는 것은
  노출을 줄이는 게 아니라 늘리는 것이다.
- **파드마다 TLS 종단 사이드카 프록시**(예: 파드별 Envoy) — 이 프로젝트가 아직
  갖고 있지 않은 문제(파드 간 암호화)를 푸는 진짜 서비스 메시 영역이다 — 존재하지
  않는 인프라를 위해 미리 짓지 말자는 ADR 0030의 Alternatives rejected 근거와
  같은 이유로 시기상조다.
- **대신 `Secure` 플래그 요구 자체를 없앤다** — 평문 HTTP 위에서도 쿠키가
  동작하게는 되지만, `Secure`가 존재하는 이유(Never Do Group 3)를 정면으로
  무력화한다 — refresh 토큰은 정확히 암호화되지 않은 연결을 절대 건너서는 안 되는
  종류의 값이다. 선택지에 올리지 않는다.

## Consequences

- `main.ts`, `auth.controller.ts`, `Dockerfile`, `.env.example` 어디에도 diff
  없음 — 이 ADR은 구현이 아니라 미래를 향한 약속이다.
- Kubernetes `Ingress`/ALB + 인증서 프로비저닝은 ROADMAP.md > Stage 4의
  Helm/K8s 작업으로 명시적으로 미룬다 — 이 ADR은 그 작업이 "TLS를 어디서
  끝낼지"를 처음부터 새로 정하지 않아도 되도록 목표 형태를 미리 준다.
- 그게 들어가기 전까지는, 앱에 평문 HTTP로 트래픽이 도달하는 곳 어디서도
  `ENV=prod`를 실제로 돌리면 refresh rotation이 깨진다 — 이는 받아들여지는
  공백이다. 아직 `ENV=prod`로 배포된 곳이 전혀 없기 때문이다(ROADMAP.md > Stage
  4, 배포 자체는 여전히 이 계획의 미착수 terminal act다).
