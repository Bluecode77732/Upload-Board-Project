# ADR 0060: 프론트엔드 호스팅 — 같은 Helm 릴리스의 별도 nginx 워크로드를 하나의 ALB에서 경로로 분기

- Status: Accepted — 구현 완료 (`helm lint`/`helm template`, 로컬 이미지 빌드, 브라우저 CSP 확인까지 검증. 라이브 ALB·`kind`·CI 잡 자체는 미검증)
- Date: 2026-09-21
- Amends: [ADR 0058](0058-ingress-path-allowlist.ko.md) (D1의 "catch-all 없음"은 이제 백엔드 Service에만 적용되고, D2의 3·4번 근거는 합쳐진 Ingress에서는 더 이상 성립하지 않는다), [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md) ("prod: `CORS_ORIGIN`" 절만)
- Extends: [ADR 0041](0041-helm-chart-project-adaptation.ko.md)
- Relates to: [ADR 0012](0012-refresh-cookie-rotation.ko.md) (이연돼 있던 도메인 간 쿠키 문제를 여기서 해소), [ADR 0008](0008-opt-in-cors.ko.md), [ADR 0034](0034-https-termination-stance.ko.md), [ADR 0048](0048-ci-trigger-restoration-and-docker-publish-design.ko.md), [ADR 0054](0054-per-route-rate-limit-tuning.ko.md), [ADR 0055](0055-helmet-security-headers.ko.md), [ADR 0056](0056-networkpolicy-east-west-restriction.ko.md)
- English: [0060-frontend-same-alb-path-routing.md](0060-frontend-same-alb-path-routing.md)

## Context

지금은 프론트엔드를 호스팅하는 곳이 없다. `frontend/`에는 `Dockerfile`이
없고, `.github/workflows/ci.yml`의 `docker-publish` 잡은 백엔드 이미지만
빌드하며, `k8s/helm/templates/`에도 프론트엔드 워크로드가 없고, ROADMAP.md에도
프론트엔드 호스팅 항목이 없다. 앞선 네 결정이 이 문제를 각각 반쯤만 답해 둔
상태였다:

- [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md): 프론트엔드는
  "HTTP로 백엔드를 소비한다(dev: Vite 프록시, prod: `CORS_ORIGIN`)".
- [ADR 0012](0012-refresh-cookie-rotation.ko.md)는 `SameSite=None`을 기각하면서
  도메인 간 쿠키 문제를 "Stage 4 배포 ADR"로 미뤘다.
- [ADR 0034](0034-https-termination-stance.ko.md)는 TLS 종단을 ALB/Ingress에
  두기로 했다. [ADR 0054](0054-per-route-rate-limit-tuning.ko.md)의 2026-09-14
  addendum은 목표 형태를 "CDN이나 두 번째 리버스 프록시 계층 없이 인터넷에 열린
  ALB 하나"로 기록했고, 이것이 `trust proxy` = `10.0.0.0/16`의 전제다.
- [ADR 0058](0058-ingress-path-allowlist.ko.md)은 Ingress를 백엔드 컨트롤러
  prefix 일곱 개의 명시적 allow-list로 만들어, `/health`·`/metrics`·`/doc`이
  ALB를 거치지 않게 했다.

이번 결정을 위해 기억이 아니라 코드와 공식 문서에서 직접 확인한 사실:

- `frontend/src/api/client.ts`는 모든 URL을 `${VITE_API_BASE ?? ''}${path}`로
  만든다. 빌드 때 값을 비워 두면 상대 경로로 요청하므로, 코드 변경 없이
  same-origin이 된다.
- `k8s/helm/templates/ingress.yaml`은 모든 경로를 차트 자신의 Service 하나로
  보낸다. 지금은 경로별 backend를 표현할 수 없다.
- AWS Load Balancer Controller 소스(`main` 브랜치,
  `pkg/ingress/model_build_listener_rules.go`)는 `Prefix` 경로 `/file`을 ALB
  패턴 `/file`과 `/file/*` 두 개로 바꾼다. 따라서 `/files`나 `/posts/5`와는
  매칭되지 않는다. 정렬은 Exact 먼저, 그다음 긴 `Prefix` 순이다(컨트롤러의
  Ingress spec 문서도 같은 내용이다). 한 IngressGroup 안에서 *서로 다른*
  Ingress 리소스끼리의 순서는 별개의 문제다:
  [#3033](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/3033)
  (`/*` 규칙이 특정 경로 위로 올라감)은 "not planned"로 닫혔고,
  [#2203](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/2203)
  (규칙이 특이도가 아니라 매니페스트 위치 순으로 정렬됨)은 읽은 페이지에 수정
  버전이 없는 채로 닫혀 있다. `addons/`가 실제로 설치하는 컨트롤러 버전은
  확인하지 않았다.
- SPA 라우트 `/login`, `/`, `/posts/:id`, `/files`, `/view/:id`, `/settings`
  (`frontend/src/App.tsx`)는 API prefix(`/auth`, `/user`, `/post`, `/comment`,
  `/file`, `/upload`, `/audit-log`)와 첫 경로 세그먼트가 겹치지 않는다.
- `FileResponseDto.fileUrl`/`shareUrl`은 백엔드가 `BASE_URL`로 조립하는 절대
  URL(`{BASE_URL}/file/:id/content`)이고, `k8s/helm/values-prod.yaml`은 이미
  `BASE_URL`을 공개 도메인으로 두고 있다 — SPA를 거기서 서빙하면 SPA와 같은
  origin이다.
- `k8s/infra/terraform/app-infra/main.tf`의 ACM 인증서는 `var.domain_name` 하나만
  커버한다. SAN도 와일드카드도 없다.

Terraform 상태가 지금 apply돼 있는지는 일부러 가정하지 않았다. 아래 내용은
그것에 의존하지 않는다.

## Decision

**A안을 택한 이유** — 개발자 확정(2026-09-21): 옵션 비교에서 확인한
장점(same-origin이라 CORS가 필요 없고 쿠키가 그대로이며, Terraform·ACM·DNS 변경이
없고, 백엔드와 Helm 릴리스와 롤백 경로를 함께 쓴다), 그리고 개발자의
표현으로는 이전에 만든 앱과의 차별화.

### D1 — Same origin: 별도의 정적 파일 nginx 워크로드가 API와 같은 호스트에서 SPA를 서빙한다

SPA는 `frontend/`에서 정적 파일 nginx 이미지로 빌드해, 기존 Helm 릴리스 안에
자체 Deployment와 Service로 올리고 API와 같은 공개 호스트에서 응답한다.
same-origin이므로 아래는 모두 코드 변경이 필요 없다:

- 빌드 때 `VITE_API_BASE`는 비워 둔다(상대 URL).
- prod에서 `CORS_ORIGIN`은 비워 둔다 — 이 클라이언트에는 ADR 0008의 opt-in을
  쓰지 않는다.
- refresh 쿠키는 그대로다: `HttpOnly`, `SameSite=Strict`, `Path=/auth/token`,
  host-only, prod에서 `Secure`(ADR 0012). **ADR 0012에서 이연됐던 문제는 여기서
  해소된다 — `SameSite=None`은 쓰지 않으며, `None`을 기각한 판단도 그대로
  유지된다.**
- 이미 공개 도메인인 `BASE_URL`이 `fileUrl`/`shareUrl`을 SPA와 같은 origin에
  붙잡아 둔다.

### D2 — Ingress 하나에서 경로로 분기: 백엔드 allow-list는 그대로, 프론트엔드가 `/`를 맡는다

`Ingress` 리소스 하나에 두 규칙 묶음을 담는다: ADR 0058의 prefix 일곱
개(`Prefix`)는 지금과 똑같이 백엔드 Service로, `/` `Prefix` 규칙 하나는
프론트엔드 Service로 보낸다. `templates/ingress.yaml`에는 경로별 backend
Service가 추가되고, 기본값은 차트 자신의 백엔드 Service라서 기존 values는 지금과
똑같이 렌더링된다.

ADR 0058의 보안 불변식은 유지되며, 규칙 순서에 의존하지도 않는다: 백엔드
Service는 allow-list의 일곱 패턴에서만 참조되므로 `/health`·`/metrics`·`/doc`은
어떤 순서에서도 백엔드에 닿을 수 없다 — 프론트엔드의 `/` 규칙(SPA fallback
또는 404)으로 떨어진다. 바뀌는 것은 ADR 0058 D1("catch-all 자체가 없다")과 D2의
3·4번 근거("순서 의존 없음", "템플릿 변경 없음")가 주장하던 내용이다. 이제
프론트엔드 Service로 범위가 좁혀진 catch-all이 존재하고, 합쳐진 Ingress는
컨트롤러가 `/*`를 특정 prefix들 아래에 둔다는 데 기댄다. 이게 어긋나면 API
경로가 SPA의 `index.html`로 응답한다 — 눈에 띄는 기능 장애이지 노출이 아니다.

Ingress는 하나만 쓰고 IngressGroup은 쓰지 않는다: Ingress 간 순서 문제가 바로
#3033이 보고한 경우다.

### D3 — 프론트엔드 워크로드는 같은 차트에 두고, 셀렉터 라벨은 따로 쓴다

Ingress의 backend는 그 Ingress와 같은 네임스페이스의 Service여야 하고, Ingress를
하나 더 두면 D2의 Ingress 간 순서 문제가 되살아난다. 그래서 프론트엔드
Deployment와 Service는 두 번째 차트가 아니라 `k8s/helm/`에 추가한다
([ADR 0042](0042-k8s-helm-directory-consolidation.ko.md): Kubernetes 디렉터리는
하나, 차트 옆에 별도 매니페스트를 두지 않는다). 프론트엔드 파드는 백엔드와 다른
셀렉터 라벨을 쓴다. `clamav-*` 템플릿이 `app.kubernetes.io/name: clamav`로 이미
그렇게 하고 있다: 백엔드 Service는 `sharenpo.selectorLabels`로 파드를 고르므로,
프론트엔드 파드가 같은 라벨을 달면 API 엔드포인트로 잘못 잡힌다.

### D4 — 범위: `frontend/`만

`admin/`은 이번 결정 밖이다. 자체 호스팅이 정해지기 전까지는 별도의 cross-origin
앱(`VITE_API_URL`, `CORS_ORIGIN` 설정 — `.github/workflows/ci.yml`의
`admin-e2e`가 쓰는 형태)으로 남는다.

### 구현 단계로 넘기는 것

여기서는 정하지 않는다: `frontend.enabled` values의 기본값을 켤지 끌지
(`ingress`, `metrics.serviceMonitor`, `networkPolicy` 블록은 values로 게이팅하고
`values-prod.yaml`이 켜는 방식이라 그 모델이 유력하다), 이미지 이름과 태그 체계,
replica 수, nginx 보안 헤더의 정확한 구성, 캐시 정책.

## Alternatives rejected

각 항목에는 그 대안이 A보다 나았던 점을 함께 적는다. 그 부분이 곧 감수하는
트레이드오프다.

- **B — 서브도메인(`app.<domain>`)을 별도 Ingress host로.** cross-origin이지만
  same-site라서 refresh 쿠키는 `SameSite=Strict`를 유지한다. 대신 SPA origin용
  `CORS_ORIGIN`, 빌드 때 박아 넣는 `VITE_API_BASE`, `Authorization`이 붙는
  요청마다 생기는 CORS preflight, DNS 레코드 1개, ACM 변경(인증서에 SAN이
  없으므로 `app-infra/`의 Terraform 수정)이 필요하다. 진짜 장점은 host 단위
  규칙이라 경로 순서 의존이 없고 ADR 0058을 건드리지 않는다는 점이다.
  채택하지 않았다 — 그 장점을 얻는 데 A보다 AWS 쪽 변경이 더 든다.
- **C — S3 + CloudFront.** 평가만 했다. CloudFront는 ACM 인증서를 `us-east-1`에
  둬야 하므로(CloudFront 공식 문서) 인증서와 provider alias가 하나 더 필요하다.
  새 Terraform과, 이 저장소에는 없는 배포 단계(CD 없음)도 필요하다. CDN 도입이기도
  한데, ADR 0005는 CDN을 명시 요청 없이 제안하지 않을 항목으로 두고 ADR 0036은
  설계하지 않은 채 남겼다. ADR 0054의 "CDN 없음" 전제는 API 앞단에 무엇이 서느냐에
  관한 것이라, 정적 파일 전용 배포는 그 전제를 건드리지 않고 API까지 앞세우면
  건드린다. 채택하지 않았다.
- **D — 외부 호스팅(Vercel, Netlify).** 제공자 기본 도메인에서는 SPA가
  cross-site라서 refresh 쿠키에 `SameSite=None`이 필요하다 — CSRF 방어를
  포기한다는 이유로 ADR 0012가 기각한 바로 그 옵션이다. 같은 등록 도메인의 커스텀
  서브도메인을 쓰면 쿠키가 same-site로 남아 실행 가능해진다: 작업량이 가장
  적고(이미지·차트·CI 변경 없음) 관리형 CDN을 쓴다. 반면 Helm 릴리스 밖에 두 번째
  배포 경로가 생기고, Vercel Hobby 플랜은 비상업 개인 용도로 제한된다(공식 문서,
  2026-09-21 확인). 호스트의 rewrites로 API를 프록시하면 ADR 0054가 배제한 두 번째
  프록시 계층이 생긴다. 채택하지 않았다.
- **E — 백엔드가 SPA를 서빙(`ServeStaticModule`).** 새 Kubernetes 리소스가
  없다. 하지만 `/` 규칙이 백엔드 Service를 가리키게 되어
  `/health`·`/metrics`·`/doc`이 다시 노출된다 — ADR 0058이 막은 바로 그 노출이다.
  이를 피하려면 모든 SPA 라우트를 Ingress values의 allow-list에도 올려야 해서,
  `App.tsx`의 라우팅이 Helm에 그대로 복제된다. ADR 0010의 분리도 되돌리고, 고위험
  파일인 `app.module.ts`를 수정해야 하며, helmet의 CSP(ADR 0055)가 SPA 문서에까지
  걸려 S3 presigned redirect(ADR 0036) 때문에 완화가 필요할 가능성이 높다 — CSP
  의미론에서 추정한 것이고 브라우저로 시험하지 않았다.
- **A안의 변형(A안 안에서 기각).** (a) `/` 규칙 대신 SPA 라우트를 Ingress에 하나씩
  allow-list하면 ADR 0058의 "catch-all 없음"은 지켜지지만, `App.tsx`의 라우트를
  values로 복제하게 되고, 목록에 빠진 라우트는 SPA에 아예 닿지 못해 SPA의
  `path="*"` fallback이 구해 줄 수 없다. (b) IngressGroup 하나에 자체 Ingress를
  가진 두 번째 차트 — D2·D3의 Ingress 간 순서 문제다.

## Consequences

- **감수하는 트레이드오프.** A는 더 큰 작업이다: Docker, Helm, CI, `deploy.sh`에
  걸쳐 설정/코드 파일이 약 9개로, 커스텀 서브도메인을 쓰는 D안의 약 3개보다
  많다. 게다가 라이브 ALB만 해소할 수 있는 순서 의존이 하나 생긴다. Decision에
  적은 이유로 A를 택했다.
- ADR 0058은 대체가 아니라 amend된다. allow-list와 보안 불변식은 백엔드 Service에
  대해 그대로 유지된다. D1의 "catch-all 없음"은 합쳐진 Ingress를 더는 설명하지
  못하고, D2의 3·4번 근거도 더는 성립하지 않는다. D4의 Helm 배열 병합 주의사항은
  이제 프론트엔드 `/` 경로에도 적용된다: `ingress.hosts`를 다시 선언하는
  오버레이는 모든 경로를 다시 선언해야 한다.
- ADR 0010의 prod 절은 "same-origin, `CORS_ORIGIN` 미설정"이 된다.
  `frontend/vite.config.ts` 헤더 주석은 여전히 운영에서 "실제 origin + CORS를
  쓴다"고 적고 있어, 이 결정이 구현되면 낡은 설명이 된다. 그 파일은 `frontend/`의
  고위험 파일이라 주석 수정에도 명시적 승인이 필요하다(후속 작업).
- SPA와 API가 이제 ALB에서 하나의 경로 네임스페이스를 공유한다. 지금은 첫
  세그먼트가 겹치는 게 없다. 새 최상위 SPA 라우트는 API prefix로 시작하면
  안 되고(백엔드로 라우팅된다), allow-list에 추가하는 새 컨트롤러 prefix는 SPA
  라우트의 첫 세그먼트와 같으면 안 된다. `vite.config.ts`가 dev 프록시에서 같은
  위험을 이미 문서화해 두었다(정규식으로 앵커링한 `/file`, `/post`).
- **미검증 잔여 사항.** `/*`가 특정 prefix들 아래에 놓인다는 순서는 컨트롤러의
  문서화된 동작(Exact, 그다음 긴 Prefix)에 기댄다. 라이브 ALB에서도, `addons/`가
  설치하는 컨트롤러 버전에 대해서도 확인된 적이 없다.
- SPA의 응답 헤더는 helmet에서 상속되지 않는다(ADR 0055는 API 응답만 다룬다).
  nginx가 직접 설정해야 한다. `STORAGE_DRIVER=s3`에서는 SPA의 미디어와 `fetch`
  호출이 S3 presigned URL로 가는 302를 따라가므로(ADR 0036), CSP가 버킷 origin을
  허용해야 한다(추정, 시험 안 함).
- ADR 0056의 NetworkPolicy는 `sharenpo.selectorLabels`를 선택하므로, clamav
  파드처럼 프론트엔드 파드도 그 밖에 있다. 별도 정책이 필요한지는 구현 단계에서
  정한다.
- 새 AWS 리소스도 Terraform 변경도 없다 — ALB와 인증서를 함께 쓴다. 프론트엔드
  파드는 기존 노드에 부하를 더한다(측정 전). 스키마, 엔티티, 백엔드 코드 변경은
  없다.

### 후속 작업 (여기서는 하지 않음, 각각 별도 작업으로 진행)

1. **이미지** — `frontend/Dockerfile`, nginx 설정, `.dockerignore`: 멀티스테이지
   (pnpm 빌드 후 nginx), non-root
   ([ADR 0030](0030-container-non-root-and-arch-stance.ko.md)), `VITE_API_BASE`
   미설정, 딥링크(`/posts/:id`, `/view/:id`)가 열리도록 SPA fallback, 위에서 말한
   보안 헤더.
2. **Helm** — 프론트엔드 Deployment와 Service(별도 셀렉터 라벨), `ingress.yaml`의
   경로별 backend, `values.yaml`/`values-prod.yaml`(`/` 경로, prod 오버레이는 전체
   경로 목록을 다시 선언), `k8s/helm/README.md`.
3. **CI** — `docker-publish`가 ADR 0048의 브랜치별 태그/플랫폼 분리대로 프론트엔드
   이미지를 빌드·푸시하고, 푸시 전에 스모크 테스트(페이지와 딥링크가 200으로
   응답)를 돌린다.
4. **`deploy.sh`**([ADR 0046](0046-deploy-sequence-automation.ko.md)) — 지금은
   이미지 태그를 하나만 해석해서 `--set image.tag=`만 넘긴다. 프론트엔드 태그도
   해석하고 확인해야 한다. 두 이미지를 같은 `:<sha>`로 게시하면 `IMAGE_TAG` 하나로
   하는 롤백이 유지된다.
5. **문서** — `k8s/infra/terraform/README.md`의 "Enabling the ALB ingress" 아래
   `--set-json` 절차(`/` 경로 추가), `frontend/CLAUDE.md`, `vite.config.ts` 주석
   (승인 필요), 구현되면 CLAUDE.md의 Helm/K8s 항목.
6. **검증** — `helm lint --strict`; `helm template --set ingress.enabled=true`로
   일곱 prefix → 백엔드 Service, `/` → 프론트엔드 Service가 렌더링되는지 확인;
   일회용 `kind` 클러스터에서 빌드한 이미지로 `helm install --wait`; 로컬
   `docker build`·실행과 딥링크 확인. 첫 라이브 ALB에서는: 토큰 없는 `GET /file`이
   HTML이 아니라 API의 401 JSON을 돌려주는지, `/files`·`/posts/1`·존재하지 않는
   경로가 SPA의 HTML을 돌려주는지, `/health/live`·`/metrics`·`/doc`이 SPA의
   HTML(또는 404)을 돌려주고 백엔드 응답은 절대 돌려주지 않는지.
7. **`admin/` 호스팅** — 별도 결정(D4).

### Addendum (2026-09-21) — 구현 완료

후속 작업 1~4번이 반영됐다. 5번은 `vite.config.ts` 주석만 빼고 반영됐고(명시적 승인이 필요하다),
6번은 클러스터 없이 할 수 있는 검증까지 끝났으며, 7번은 아직 열려 있다.

- **"구현 단계로 넘기는 것"으로 남겨 뒀던 선택을 확정했다.** `frontend.enabled`는 `values.yaml`에서
  `false`, `values-prod.yaml`에서 `true`가 기본이다(`ingress`/`metrics.serviceMonitor`/
  `networkPolicy`와 같은 모델). 이미지는 `bluecode1775/sharenpo-frontend`이고, 매 push마다 `:<sha>`,
  `main`에는 `:latest`가 더 붙는다(ADR 0048의 분리). `deploy.sh`는 백엔드의 태그를
  `frontend.image.tag`로 함께 넘긴다. `replicaCount`는 1이다. nginx는 보안 헤더를 server 레벨에서
  설정하고 캐시 정책은 `expires`로 준다 — location 안에 `add_header`가 하나라도 있으면 server 레벨
  헤더가 통째로 무시되기 때문이다. CSP는 이미지·미디어·`fetch`에 `https://*.amazonaws.com`(S3
  presigned 리다이렉트)을, 비공개 파일 미리보기에는 `blob:`을 허용한다.
- **`ingress.yaml`**은 path마다 선택적 `service: app|frontend`를 받는다(기본 `app`). `frontend` path는
  `frontend.enabled`가 false인 동안 건너뛰고, 그 밖의 값은 렌더링을 실패시킨다 — 그래서 기존 values는
  이전과 똑같이 렌더링되고, 예전 일곱 경로 레시피도 그대로 렌더링된다.
- **구현하다가 발견한 어긋남 두 가지.**
  (1) 프론트엔드 Service의 포트 이름은 `http`가 아니라 `web`이다. `servicemonitor.yaml`이 모든
  Service가 `sharenpo.labels`로 물려받는 `sharenpo.selectorLabels`로 Service를 고르고 `http`라는
  이름의 포트를 스크레이프하는데, 여기서도 같은 이름이면 Prometheus가 nginx의 `/metrics`(SPA
  fallback의 HTML)를 스크레이프하게 된다. clamav Service는 포트 이름이 `clamd`라서 우연히 피해 갈
  뿐이다.
  (2) pnpm을 Dockerfile 안에서 고정했다(`corepack prepare pnpm@10.14.0`). `frontend/package.json`에는
  `packageManager`가 없어서 corepack이 최신 pnpm(12.5.1)을 받았는데, `node:24.8.0`에 든 corepack
  0.34.0이 그걸 실행하지 못한다(`bin/pnpm.cjs`가 없음). `frontend-*`/`admin-*` CI 잡도 같은 무고정
  상태를 공유한다 — 2026-09-17에는 통과했지만 그 상태를 지켜 주는 장치가 없다. `frontend/`와
  `admin/`의 `package.json`에 핀을 두는 건 별도 결정이다.
- **발견, 2026-09-22 해결.** AWS Load Balancer Controller의 `target-type` 기본값은
  `instance`이고 공식 문서상 `NodePort`나 `LoadBalancer` Service가 필요한데, 이 차트의
  Service는 `ClusterIP`다. `values-prod.yaml`의 주석 처리된 annotation 블록에 이제
  `alb.ingress.kubernetes.io/target-type: ip`가 들어 있고, `k8s/helm/README.md`와
  `k8s/infra/terraform/README.md`의 레시피도 함께 맞췄다 — 고치는 과정에서 두 번째로 겹치는
  공백이 드러났다: `ip` 모드 ALB는 파드 IP로 직접 트래픽을 보내는데,
  [ADR 0056](0056-networkpolicy-east-west-restriction.ko.md)의 NetworkPolicy(같은 네임스페이스
  파드만 인바운드 허용)는 그걸 애초에 허용하지 않았다. 여기가 아니라 그 ADR 자신의 2026-09-22
  addendum(`ingress.enabled`로 게이팅한 새 `ipBlock` 규칙)에서 함께 닫았다 — 둘 다 라이브에서만
  검증 가능하며 `k8s/helm/README.md`의 미해결 점검 목록에 있다.
- **발견했지만 고치지 않은 것.** `docker-tag-cleanup.yml`은 `bluecode1775/sharenpo`만
  정리하므로 프론트엔드 저장소의 sha 태그는 쌓인다.
- **검증한 것.** `frontend.enabled` × `ingress.enabled` 조합에 대한 `helm lint --strict`와
  `helm template`(프론트엔드 없이 규칙 일곱 개, 있으면 `/` → `<release>-frontend:80`까지 여덟
  개, 잘못 쓴 `service`는 렌더링 실패). amd64·arm64 로컬 `docker build`: nginx는 uid 101로 실행되고,
  `nginx -t`가 통과하며, 딥링크는 `index.html`로 fallback되고, 없는 `/assets` 파일은 404이며, 해시가
  붙은 자산은 1년 캐시되고, 번들에 개발용 origin이 구워지지 않았다. 실제 브라우저(Playwright)에서
  CSP 아래로 SPA가 뜬다(콘솔 에러 1건은 그 컨테이너에 백엔드가 없어서 나는
  `POST /auth/token/refresh`의 405). 워크플로에 대한 `actionlint`(shellcheck 포함), `deploy.sh`에
  대한 `bash -n`(shellcheck는 바꾼 구간에서 지적 없음).
- **검증하지 못한 것 — 라이브 배포 없이 가능한 것.** `helm install --wait`(구현한 머신에 `kind`가
  없다. 로컬 클러스터면 된다)와 CI 잡 자체(푸시해야만 돈다. 첫 푸시가
  `bluecode1775/sharenpo-frontend` Docker Hub 저장소를 자동으로 만든다고 가정했지만 아직 확인하지
  못했다).
- **검증하지 못한 것 — 라이브에서만 가능한 것.** `ingress.enabled`를 켜고 `addons/`와
  `app-infra/`를 apply하고 도메인이 ALB를 가리키도록 한 뒤 배포해야만 볼 수 있다: (1) `/` 규칙이
  API prefix들 아래에 놓이는지, (2) HTTP→HTTPS 리다이렉트와 인증서, 그리고 새로고침 뒤에도
  `Secure` refresh 쿠키가 유지되는지, (3) CSP와 버킷의 CORS 규칙 아래에서 S3 presigned 리다이렉트가
  되는지, (4) 실제 클라이언트 IP가 rate limiter에 도달하는지, (5) 두 Deployment가 롤아웃되고
  Service가 의도대로 연결되며 백엔드만 스크레이프되는지. 통과 기준이 있는 체크리스트는
  `k8s/helm/README.md`의 "Enabling HTTPS (Ingress)" 아래 미해결 목록이다.
