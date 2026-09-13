# ADR 0058: Ingress 경로 allow-list — health·metrics·docs 차단

- Status: Accepted — implemented, `helm template`/`helm lint` 검증 완료
- Date: 2026-09-13
- Extends: [ADR 0041](0041-helm-chart-project-adaptation.md)
- English: [0058-ingress-path-allowlist.md](0058-ingress-path-allowlist.md)

## Context

2026-09-09 보안 점검에서 `k8s/helm/templates/ingress.yaml`의 경로 규칙이
단일 catch-all `path: /`(`pathType: ImplementationSpecific`) 하나뿐이라는 게
발견됐다. `ingress.enabled`를 언젠가 `true`로 켜는 순간(오늘까지는 어디서도
`false` — ROADMAP.md: 외부 테스터가 실제로 필요해지기 전까지 꺼둠), 이 규칙
하나가 예외 없이 모든 경로를 공개 ALB로 라우팅하게 된다 — `/health/live`,
`/health/ready`, `/metrics`, `/doc`(Swagger UI)도 포함해서. 이 넷은 전부
인증이 없다(`HealthModule`/`MetricsModule`은 의도적으로 무인증, ADR
0031/0047; Swagger 컨트롤러도 guard가 없다).

논의 중 확인된 두 가지가 이 결정을 구체화했다:

- **`/health/*`와 `/metrics`는 애초에 Ingress를 거쳐 외부에 노출될 필요가
  없다.** kubelet의 liveness/readiness 프로브는 파드에 IP로 직접 붙고,
  Prometheus의 `ServiceMonitor`(ADR 0047)도 Service/파드 엔드포인트를 직접
  스크레이프한다 — 둘 다 애초에 Ingress를 거치지 않는다. 막아도 운영상 잃는
  게 없다.
- **`/doc`은 진짜 트레이드오프였다, 단순한 문제가 아니라.** 공개를 유지할
  근거로 "외부 검토자가 API를 바로 눌러보게 하기"가 제시됐지만, 실제
  포트폴리오/면접 검토는 대부분 리포(README, 코드)를 읽거나 화면공유로 직접
  시연하는 방식으로 이뤄지고, 면접관이 알아서 공개 Swagger URL을 찾아 혼자
  눌러보는 경우는 상대적으로 드물다. 이 얕은 이득에 비해 `/doc`은
  `/health`·`/metrics`와 똑같이 "인증 게이트가 없는" 위험군이다 — URL을 찾은
  누구에게나 모든 엔드포인트·파라미터·DTO 구조 전체를 지도로 넘겨준다.
  결정(개발자, 이번 세션): `/doc`도 함께 차단한다. 내부 접근(로컬 개발,
  클러스터 내부)은 영향받지 않는다.

## Decision

### D1 — 컨트롤러 prefix의 명시적 allow-list, 더 좁은 catch-all이 아니라

`values.yaml`의 `ingress.hosts[].paths`는 이제 이 앱의 실제 `@Controller`
prefix를 정확히 나열한다: `/auth`, `/user`, `/post`, `/comment`, `/file`,
`/upload`, `/audit-log`. `/health`, `/metrics`, `/doc`은 목록에서 빠져
차단된다. `/audit-log`는 관리자 전용(`RolesGuard`)이지만, `/user`·`/post`의
일부도 마찬가지다 — 이 목록의 기준은 "인증됐는가"가 아니라 "애초에 인증
게이트가 있는가"다. 나열된 prefix는 전부 이미 `JwtAuthGuard`(해당 시
`RolesGuard`까지) 뒤에 있으므로 Ingress 레벨 노출이 추가 위험을 만들지
않는다. 반면 제외된 세 경로는 자체 게이트가 전혀 없어 네트워크 계층이
유일한 보호막이다.

### D2 — ALB 전용 리젝트 규칙이 아니라 allow-list

두 구현 방식을 비교했다:

- **A — ALB fixed-response 리젝트 규칙**: `/` catch-all은 그대로 두고,
  `/health`·`/metrics`·`/doc`에 더 높은 우선순위의 경로 규칙을 추가해
  `alb.ingress.kubernetes.io/actions.<name>` fixed-response 백엔드
  (`{"type":"fixed-response",...}`, 서비스 이름 = 액션 이름,
  `port: use-annotation`)로 보낸다.
- **B — `/`를 명시적 allow-list로 재작성**(채택): catch-all 자체를 없애고,
  나열된 prefix만 라우팅한다.

B를 택한 이유는 네 가지다:

1. **이 코드베이스의 기존 방침과 일치.** 전역 `ValidationPipe`가
   `whitelist + forbidNonWhitelisted`로 동작하고, `backend/entities.ts`는
   glob이 아니라 단일 명시적 등록 목록이다 — 둘 다 "선언된 것만" 방식이다.
   B는 이 철학을 Ingress 계층에 그대로 적용한 것뿐이고, A였다면 이
   프로젝트에서 유일하게 "새 표면은 기본 공개"로 가는 지점이 됐을 것이다.
2. **컨트롤러 이식성.** `addons/main.tf`가
   `enable_aws_load_balancer_controller = true`를 갖고 있지만, 차트 자체는
   아직 그걸 확정한 적이 없다(`ingress.className`은 여전히 `""`). A의
   어노테이션 문법은 ALB 전용이고, B는 어떤 ingress controller에서든 동일한
   규칙을 렌더링한다.
3. **아무것도 배포돼 있지 않은 상태에서의 검증 가능성.** 세 Terraform
   상태 모두 2026-08-28 destroy됐다(CLAUDE.md의 Terraform/infra 항목) —
   A의 리젝트 규칙을 시험해볼 살아있는 ALB가 없다. 이게 중요한 이유는 A가
   의존하는 게 바로 규칙 *우선순위*인데, AWS Load Balancer Controller에는
   경로/규칙 순서를 항상 정확히 지키지는 않는다는 미해결 이슈가 실제로
   보고돼 있기 때문이다
   ([kubernetes-sigs/aws-load-balancer-controller#3033](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/3033),
   [#2203](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/2203)).
   검증 불가능한 컨트롤러 전용 순서 보장에 정확성을 기대는 보안 장치를
   그대로 내보내는 건 기각했다. B는 순서에 의존할 게 없다 — prefix가
   목록에 있는지 없는지만 보면 되고, 렌더링된 YAML만 읽어도 확인된다.
4. **템플릿 비용.** A는 `ingress.yaml`에 새 조건 분기(경로별로
   fixed-response 대상을 가리키는 backend service 오버라이드)가 필요하지만,
   B는 템플릿 변경이 전혀 없었다 — 두 방식을 현재 템플릿 그대로 렌더링해
   확인함(Verification 참고).

B의 감수 비용: 앞으로 새 컨트롤러가 생기면 이 목록에 그 경로를 추가해야
외부에서 호출 가능해진다. 안 하면 기본적으로 404다. 이건 결함이 아니라
올바른 기본값(새 표면은 기본적으로 닫힘)으로 취급하며, 이 프로젝트가 이미
다른 곳에서 요구하는 것과 같은 수동 등록 규율이다(`entities.ts`,
`test/e2e-utils.ts`의 `MIGRATIONS`/`TABLES`).

### D3 — `pathType: Prefix`, 스캐폴드의 `ImplementationSpecific`이 아니라

원래 차트 스캐폴드가 `ImplementationSpecific`을 쓴 건 구체적인 라우팅
의도가 아직 없었기 때문이다(자리표시자 `path: /`). 이제 각 경로가 자기
하위 경로까지 매칭해야 하는 실제 prefix를 가리키므로(`/file`은
`/file/123/content`도 매칭해야 함), `Prefix`가 표준 쿠버네티스 pathType으로
맞다 — 어떤 ingress controller에서든 이식되고, 컨트롤러별 해석에 맡길 게
남지 않는다.

### D4 — `values-prod.yaml`은 그대로, 대신 Helm 배열 병합 함정을 문서화

`values-prod.yaml`은 오늘 `ingress` 키 자체가 없다 — 실제로 켜는 것(host,
TLS, ALB 어노테이션)은 외부 테스터 필요가 실제로 생길 때까지 여전히
미룬 상태다(ROADMAP.md). 이번 작업은 기본 `values.yaml`의 allow-list만
바꾸고, 아직 쓰이지 않는 기능을 위해 `values-prod.yaml`에 자리표시자
`ingress` 블록을 추가하지 않는다.

나중에 실제로 켜는 사람을 위해 하나 기록해둘 점: Helm은 `-f` 레이어 간
배열을 병합하지 않고 통째로 교체한다. 나중에 `values-prod.yaml`이
`ingress.hosts[].host`(실제 도메인)만 오버라이드하고 `paths`를 다시 적지
않으면, host는 있고 규칙은 하나도 없는 Ingress가 조용히 만들어진다. 이 점을
`values.yaml`의 `ingress` 주석 블록에, allow-list 바로 옆에 직접 적어뒀다.

## Verification

시험해볼 살아있는 클러스터가 없다(세 Terraform 상태 모두 2026-08-28
destroy). 이번 변경은 순수 쿠버네티스 스펙 레벨의 Ingress 데이터라(A안과
달리 런타임에서 증명해야 할 컨트롤러 전용 어노테이션 동작이 없음),
`helm template`/`helm lint`가 실 클러스터 검증의 대체재가 아니라 이 경우엔
그 자체로 충분한 검증이다:

- `helm lint k8s/helm --set secrets.existingSecret=dummy-secret` — 실패 0건.
- `helm template sharenpo k8s/helm --set ingress.enabled=true --set
  secrets.existingSecret=dummy-secret --show-only templates/ingress.yaml` —
  allow-list에 올린 7개 경로(`/auth`, `/user`, `/post`, `/comment`, `/file`,
  `/upload`, `/audit-log`)만 정확히 렌더링되고 각각 이 차트 자신의
  Service로 라우팅됨; `/health`, `/metrics`, `/doc`은 나타나지 않음.
  `templates/ingress.yaml`은 변경이 전혀 필요 없었다 — D2의 템플릿 비용
  주장을 확인해준다.

## Consequences

- `k8s/helm/values.yaml`의 `ingress.hosts[].paths`가 단일
  `path: /`(`ImplementationSpecific`)에서 명시적 7개 prefix(`Prefix`)로
  바뀌었다. `templates/ingress.yaml`은 무변경.
- `ingress.enabled`는 여전히 `false`다 — 이번 작업이 Ingress를 켜는 게
  아니라, 언젠가 켜질 때를 위해 모양만 준비해둔 것이다.
- `/doc`(Swagger UI)은 Ingress가 켜지는 순간부터 외부에서 도달 불가능해진다;
  내부/로컬 접근(`localhost:3000/doc`, 클러스터 내부)은 영향받지 않는다.
  공개 API 문서 열람이 실제로 필요해지면 이 결정을 다시 여는 게 아니라
  별도 결정으로 재검토한다.
- 앞으로 새 컨트롤러는 외부에서 호출 가능하려면 이 allow-list에 경로
  prefix를 추가해야 한다 — `entities.ts` 등록과 같은 부류의 수동 단계다.
- `values-prod.yaml`은 무변경이다; 실제로 Ingress를 켜는 사람은 실 host/TLS/
  ALB 어노테이션과 함께 거기서도 `paths` 전체를 다시 적어야 한다(Helm이
  배열을 병합하지 않는다는 점, `values.yaml` 주석에 기록됨).

### 추가 기록 (2026-09-13) — values-prod.yaml 템플릿 반영

위 공백이 이제 절반은 메워졌다: `k8s/helm/values-prod.yaml`에 실제 도메인,
이 ADR의 일곱 경로 목록 전체, `certificate-arn`/`listen-ports`/`ssl-redirect`
annotation까지 담은 주석 처리된 `ingress` 블록이 준비돼 있다 — `addons/`와
`app-infra/`를 다시 apply한 뒤 이 주석만 풀면 된다. `ingress.enabled`는
여전히 `false`이고 이 변경이 그걸 바꾸지 않는다. 이 템플릿을 검증하는
과정(`helm lint`/`helm template --set ingress.enabled=true ...`)에서
`k8s/infra/terraform/README.md`에 이미 있던 `helm upgrade --set
ingress.hosts[0].host=...` 한 줄짜리 레시피의 실제 버그도 함께 발견했다 —
`--set`은 배열 인덱스에 값을 줄 때 그 원소 전체를 교체해버려서 이 ADR의
allow-list 경로가 전부 조용히 사라지고 있었다 — 바로 이 ADR이 막으려던
문제 그 자체다. 대신 `--set-json`으로 `hosts` 배열 전체를 넘기도록 고쳤다.
