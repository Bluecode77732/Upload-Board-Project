# ADR 0062: admin 콘솔 호스팅 — 같은 ALB의 세 번째 워크로드, `/admin` 서브패스

- Status: Accepted — 구현 완료(`helm lint`/`helm template`, `pnpm test`, 로컬 이미지 빌드와
  `/admin/*` curl 확인, Docker Desktop Kubernetes에서의 `helm install --wait`까지 검증.
  라이브 ALB는 미검증)
- Date: 2026-09-23
- Extends: [ADR 0060](0060-frontend-same-alb-path-routing.ko.md) (D4의 "`admin/`은 이 결정
  밖"이 이제 해소됨 — 같은 메커니즘, 두 번째 앱), [ADR 0058](0058-ingress-path-allowlist.ko.md)
  (allow-list에 prefix 하나 더 추가)
- Relates to: [ADR 0010](0010-frontend-split-and-api-surface-freeze.ko.md) (admin은 여전히
  별도 앱이다 — 이건 `frontend/` 안의 라우트가 아니라 배포 경로 하나를 추가하는 것),
  [ADR 0022](0022-admin-console-import-from-chat-project.ko.md)
- English: [0062-admin-same-alb-subpath-routing.md](0062-admin-same-alb-subpath-routing.md)

## Context

`admin/`은 지금까지 배포 경로가 아예 없었다: Dockerfile도, 차트 리소스도, CI 발행 잡도
없다. 백엔드와는 cross-origin으로 동작하고(`VITE_API_URL`, CI에서는
`CORS_ORIGIN=http://localhost:5174`), dev 프록시도 없다(`admin/vite.config.ts`의 `server`
블록에 `proxy` 키가 없다 — `frontend/`와 다르다). ADR 0060 D4가 일부러 범위 밖으로 남겨
별도 결정으로 미뤄뒀다.

후보는 세 가지였다(프론트 세션, 이전 턴): (A) `frontend/`의 ADR 0060 패턴처럼 같은 ALB에
세 번째 경로-분기 워크로드로 합류, (B) 배포하지 않고 보류, (C) 별도 서브도메인/외부 호스팅.
**개발자가 A를 확정했다.**

이미 dev·prod 모두 `/`에서 서빙하던 `frontend/`와 달리, `admin/`이 같은 ALB로 옮겨가면
호스트 루트를 더는 가질 수 없다 — `/`는 ADR 0060의 프론트엔드 규칙이 이미 차지하고 있다.
`admin/`은 서브패스(`/admin`)에서 살아야 하는데, 이건 `frontend/`가 풀 필요 없었던
문제다. 이 결정을 쓰기 전에 직접 조사한 내용(추측 아님):

- `admin/src/App.tsx`의 `<BrowserRouter>`는 `basename`이 없다 — 모든 라우트(`/`,
  `/dashboard`, `/users`, `/logs`)가 루트 기준 상대 경로다.
- `admin/vite.config.ts`는 `base`를 설정하지 않는다 — Vite 기본값(`/`)이라 빌드된 모든
  자산 참조가 절대 루트 경로(`/assets/...`)가 되는데, 실제로 `/admin/assets/...`에서
  서빙되면 404가 난다.
- 앱 안의 모든 네비게이션은 React Router(`useNavigate()`, `<Navigate to>`)를 거친다 —
  `admin/src`에서 하드코딩된 경로를 grep해서 확인함 — **딱 하나만 빼고**:
  `admin/src/auth/session-guard.ts`의 `rejectSession()`이 `window.location.replace('/')`를
  직접 호출하는데, 이건 React Router의 `basename`을 전혀 모르는 원시 브라우저 API다. 이 ADR의
  설계 아래에서는 세션 충돌이나 refresh 실패가 사이트 루트 `/`로 강제 이동시키는데 — 그건
  admin의 로그인 페이지가 아니라 `frontend/`의 Service다(ADR 0060 D2의 `/` 규칙). 이건
  가정이 아니라 **이 ADR의 구현이 실제로 고치는 진짜 버그**다.
- `admin/src/api/axios.ts`의 `baseURL: import.meta.env.VITE_API_URL`은 코드 변경이 필요
  없다: axios는 `baseURL`이 `undefined`면 "요청 URL을 그대로 쓴다"로 동작한다 —
  `frontend/src/api/client.ts`의 `BASE = VITE_API_BASE ?? ''`가 명시적으로 얻는 것과 같은
  "생략하면 same-origin" 동작이다. 하지만 `admin/src/auth/session-guard.ts` 자신의
  `` fetch(`${import.meta.env.VITE_API_URL}/auth/token/refresh`, ...) ``는 템플릿 리터럴이다
  — env var가 미설정이면 문자열 그대로 `"undefined"`가 되어
  `undefined/auth/token/refresh`가 만들어진다. 이건 `frontend/`가 이미 쓰고 있는 `?? ''`가
  **실제로 필요하다**.
- AWS Load Balancer Controller는 경로를 재작성하지 않는다 — ADR 0060 조사에서 소스로
  확인했고 여기서 다시 확인했다: `rewrite-target` 같은 annotation이 없다. `/admin`의
  `Prefix` 규칙은 요청에 `/admin`을 그대로 남긴 채 전달한다(ALB 패턴은 `/admin`,
  `/admin/*` — `buildPathPatterns`, ADR 0060 Context). 그래서 admin 파드 안의 nginx는
  `/`가 아니라 **`/admin/...`에서** 콘텐츠를 서빙해야 한다.
- `/admin`은 기존 어떤 prefix와도 안 겹친다: 백엔드 컨트롤러 prefix(`/auth` `/user` `/post`
  `/comment` `/file` `/upload` `/audit-log`)도 아니고, `frontend/` 라우트(`/login` `/`
  `/posts/:id` `/files` `/view/:id` `/settings`)도 아니다. [ADR
  0010](0010-frontend-split-and-api-surface-freeze.ko.md)의 "`frontend/`에 `/admin` 라우트를
  다시 넣지 말 것"은 `frontend/` 자신의 라우터 *안의* 라우트에 대한 이야기다 — 완전히 별도
  Service로 가는 Ingress 경로는 다른 문제라 그 결정을 다시 여는 게 아니다.

## Decision

### D1 — ADR 0060과 같은 메커니즘, 세 번째 다리

values로 켜고 끄는 Deployment+Service가 하나 더 생긴다(`admin.enabled`, 기본 `false`,
`values-prod.yaml`이 켬), `sharenpo`·`frontend` 둘 다와 다른 자기만의 셀렉터 라벨,
`ingress.yaml`의 경로별 backend에 선택지가 하나 더(`app` | `frontend` | `admin`) 생겨
`/admin` `Prefix` 규칙을 받는다. API와 same-origin으로 두는 이유는 ADR 0060이 `frontend/`에
그렇게 한 것과 같다: 운영에서 `CORS_ORIGIN`이 필요 없고, `withCredentials: true`의 refresh
쿠키가 `SameSite=Strict`이므로 진짜 cross-origin admin이었다면 ADR 0012가 이미 기각한
`SameSite=None` 문제를 다시 꺼내야 했을 것이다 — same-origin은 frontend에서 그랬던 것처럼
admin에서도 그 문제 자체를 없앤다.

### D2 — Vite `base`는 빌드 조건부, dev는 손대지 않는다

`admin/vite.config.ts`는 `base: command === 'build' ? '/admin/' : '/'`로 설정한다.
`pnpm dev`(로컬에서 쓰는 것, 포트 5174, 프록시 없음 — Context)는 오늘과 똑같이 루트에서
그대로 서빙된다 — Docker 운영 빌드(항상 `vite build`를 돌린다)만 `/admin/` prefix를 받는다.
즉 `admin/`의 로컬 dev 워크플로는 이 ADR로 전혀 바뀌지 않는다 — 바뀌는 건 Docker 이미지의
`vite build` 결과물뿐이다.

### D3 — `basename={import.meta.env.BASE_URL}`, 하드코딩 문자열이 아니라

`App.tsx`의 `<BrowserRouter>`는 `basename={import.meta.env.BASE_URL}`을 받는다 — Vite가
내장 제공하는 이 env var는 `base`가 실제로 정해진 값과 항상 같다(dev에서는 `/`, 운영
빌드에서는 `/admin/`). 그래서 유지보수하는 사람이 하나만 바꾸고 다른 하나를 깜빡해서
router의 basename과 자산 base path가 서로 어긋나는 일이 구조적으로 불가능하다.

### D4 — 진짜 버그 수정 하나: `session-guard.ts`의 강제 네비게이션

`rejectSession()`의 `window.location.replace('/')`는
`window.location.replace(import.meta.env.BASE_URL)`이 된다 — D3와 같은 이유이고, Context가
찾아낸 "세션 충돌이 admin을 조용히 공개 프론트엔드 앱으로 떨어뜨리는" 버그를 닫는다. refresh
엔드포인트를 부르는 fetch에는 `import.meta.env.VITE_API_URL ?? ''`을 붙인다 —
`frontend/src/api/client.ts`가 이미 쓰는 것과 같은 `?? ''` 패턴이고,
`"undefined/auth/..."` 버그를 닫는다.

### D5 — nginx는 `/admin/...`에서 서빙한다, `alias`로

`admin/nginx.conf`는 `frontend/nginx.conf`의 SPA fallback·캐시·보안 헤더 구성을 그대로
본뜨되, 모든 `location`을 `/`가 아니라 `/admin/`에 고정하고 `root`(매칭된 prefix를 그대로
유지)가 아니라 `alias`(매칭된 prefix를 벗겨낸다)를 쓴다:

```nginx
location /admin/assets/ {
    alias /usr/share/nginx/html/assets/;
    expires 1y;
    try_files $uri =404;
}
location /admin/ {
    alias /usr/share/nginx/html/;
    try_files $uri /admin/index.html;
}
location / {
    return 404;
}
```

끝에 슬래시 없는 `/admin`도 ALB가 실제로 전달할 수 있는 요청이다(`Prefix`는 `/admin`과
`/admin/*` 둘 다 매칭한다, ADR 0060 Context) — `location /admin/`만으로는 슬래시 없는
URI를 매칭하지 못하므로 전용 리다이렉트를 하나 더 둔다: `location = /admin { return 301
/admin/; }`. 마지막 `location /` 블록은 다른 어디로도 넘기지 않고 그냥 `404`를 낸다 — 이
파드 안에는 넘길 다른 대상이 없다.

### D6 — CI, `deploy.sh`, 태그 정리를 frontend 패턴과 그대로 맞춘다

세 번째 `docker-publish-admin` 잡(`needs: [admin-lint-and-unit, admin-e2e]` —
`docker-publish-frontend`를 게이팅하는 잡들의 admin 버전), 같은 브랜치별 태그/플랫폼 분리,
`/admin/` prefix에 맞게 조정한 같은 모양의 스모크 테스트(`/admin/`, `/admin/dashboard` 딥링크
fallback, 없는 `/admin/assets/*`의 404, CSP 헤더 확인). `deploy.sh`는 기존 백엔드·프론트
태그 옆에 세 번째로 `--set admin.image.tag=`를 조회해 전달한다. `docker-tag-cleanup.yml`의
매트릭스에는 `sharenpo-admin`이 세 번째 항목으로 들어간다 — `sharenpo-frontend`를 추가할 때
ADR 0060 addendum이 이미 기록한 것과 같은 이유다.

## Consequences

- ADR 0060이 이미 받아들인 것과 같은 trade-off를 한 번 더 치른다: `admin/`을 배포하지 않는
  것보다 파일이 늘어난다(Dockerfile·nginx.conf·Helm 워크로드·CI 잡 각각 하나씩 더) — 이유도
  똑같다(same-origin, Ingress 하나, Helm 릴리스 하나, 롤백 경로 하나).
- `admin/`의 로컬 dev 워크플로(`:5174`에서 `pnpm dev`, `:3000`과 cross-origin,
  `CORS_ORIGIN` 필요)는 전혀 바뀌지 않는다 — Docker 운영 빌드만 다르다. `admin/e2e/`도
  같은 이유로 그대로다: dev 서버를 상대로 돌지, 운영 이미지를 상대로 돌지 않는다.
- `session-guard.ts`의 두 수정(D4)은 이 ADR이 있어야만 생기는 새 동작이 아니라 원래
  잘못돼 있던 버그다(SPA 자신의 base path를 모르는 강제 네비게이션) — ADR 0060이 `/`를
  차지한 게 그 버그를 실제로 발동 가능하게 만들고 지금 고칠 가치를 만들었을 뿐이다.
- `admin/src/auth/session-guard.spec.tsx`의 기존 단언(`toHaveBeenCalledWith('/')`)은 고칠
  필요가 없었다: Vitest의 `import.meta.env.BASE_URL`은 기본값이 `/`다(`vite build`를 돌리지
  않으므로) — 그래서 D4의 수정 이후에도 테스트 아래서는 여전히 `'/'`로 계산된다 — 가정이
  아니라 실제로 테스트를 돌려 확인했다.
- 스키마·엔티티·백엔드 코드 변경 없음. `ADR 0058`의 allow-list에 prefix가 하나
  더(`/admin`) 늘어나는데, `frontend/`의 `/`가 그랬던 것과 똑같이 values로 제어된다 —
  백엔드 Service는 ADR 0058이 남겨둔 그대로 allow-list다.
- `k8s/helm/README.md`의 라이브 전용 미해결 점검 목록(ADR 0060의 목록)에 `/admin`용 같은
  종류의 항목이 늘어난다: 이 경로가 다른 allow-list prefix들보다 아래에, 그리고
  (`frontend/`의 `/`와 나란히 있을 뿐 그 위에 있을 대상은 없으므로) 무언가의 위에 있을
  필요는 없는 채로 놓이는지, 그리고 세 번째 파드의 롤아웃·스크레이프 격리.

### 후속 작업 (여기서는 하지 않음, 맡게 되면 별도 작업으로 진행)

1. **라이브 검증** — ADR 0060이 여전히 지고 있는 것과 같은 종류: 실제 또는 로컬 클러스터에
   대한 `helm install --wait`, 그리고 라이브 ALB가 필요한 모든 것(타깃 healthy 여부, `/admin`
   규칙이 다른 규칙들과 상대적으로 어디 놓이는지, HTTPS).
2. **CI 첫 실행** — `docker-publish-admin`은 GitHub Actions에서 돈 적이 없다. 첫 push가
   Docker Hub에 `bluecode1775/sharenpo-admin`을 만든다(아직 본 적 없음, `-frontend`가
   겪었던 것과 같은 이력).

## Addendum (2026-09-24): 로컬 클러스터 검증

후속 작업 1을 좁힌다: 로컬 클러스터 쪽은 끝났고, 남은 것은 라이브 ALB가 필요한 부분뿐이다.

`helm install --wait`를 Docker Desktop의 Kubernetes(`docker-desktop` 컨텍스트, v1.34.1)에서
일회용 네임스페이스에 릴리스 `c13`으로 실행했다. `frontend`와 `admin`은 켜고 Ingress와
NetworkPolicy는 껐다. 명령은 개발자가 직접 실행했고(절차: `k8s/helm/README.md` >
"Docker Desktop Kubernetes에서 검증하기"), 아래 예상값과 출력이 모두 일치했다고 보고했다.
세션에서 직접 확인한 것은 클러스터가 `Ready`였다는 점, 네임스페이스·Postgres·Secret이
만들어졌다는 점, 이후 릴리스와 네임스페이스가 사라졌다는 점, 현재 소스로 빌드한 백엔드
이미지가 로컬에 있었다는 점뿐이며, 명령 출력 원문은 보지 못했다.

이미지: 백엔드와 admin은 현재 소스로 빌드했고, frontend는 이틀 전에 빌드한 것을 이번에
다시 빌드하지 않고 썼다. 모두 `pullPolicy=Never`다. RDS 자리에는 일회용 `postgres:16`을 썼다.

| 확인 | 예상값(일치한다고 보고됨) |
|---|---|
| `helm install --wait --timeout=600s` | `STATUS: deployed` |
| 파드 | app, frontend, admin, clamav, postgres 모두 `Running` |
| 엔드포인트 | `c13`, `c13-frontend`, `c13-admin` 각각 주소 하나씩, 모두 서로 다름 — 백엔드 Service가 SPA 파드를 고르지 않는다 |
| admin Service, 클러스터 내부 curl | `/admin` 301, `/admin/` 200, `/admin/dashboard` 200, `/admin/assets/nope.js` 404, `/` 404 |
| frontend Service | `/` 200, `/posts/1` 200, `/assets/nope.js` 404 |
| 백엔드 Service | `:3000/health/ready` 200 |

admin 파드가 Ready라는 것은 probe(`GET /admin/`)가 `alias` 설정을 거쳐 통과한다는 뜻이고,
엔드포인트가 서로 다르다는 것은 셀렉터 라벨이 세 워크로드를 분리한다는 뜻이다(D1, D5).

아직 확인하지 않은 것: ALB가 필요한 모든 것 — `/`, `/admin`, API prefix 사이의 규칙 순서,
`target-type: ip`, ALB용 NetworkPolicy 인바운드 규칙, HTTPS/리다이렉트(점검 목록은
`k8s/helm/README.md`); GitHub Actions에서의 `docker-publish-admin`; 실제 Docker Hub 이미지를
대상으로 한 `deploy.sh`의 admin 태그 확인; 세 이미지로 하는 `helm upgrade`와 롤백.

## Addendum (2026-09-25): 운영 이미지 브라우저 확인

제가 Playwright로 실제 `sharenpo-admin:local` 이미지(nginx, CSP 헤더 켜짐)를 로컬 포트에 띄워
확인했고, 컨테이너 뒤에 백엔드는 없었다. 그래서 `/auth/*` 요청은 nginx 자신의 404로 응답하고,
바로 이것이 세션 거부 경로를 구동한다.

| 확인 | 결과 |
|---|---|
| `/admin/` | 로그인 폼이 렌더링된다(제목 "Admin Login", 이메일·비밀번호 입력, "Sign In"), 탭 제목 "Sharenpo Admin". 콘솔: 오류 0, 경고 0 — CSP 위반이 없다. JS·CSS·favicon 모두 `/admin/…` 아래로 요청되고 200이다. |
| `/admin` | 301을 따라가 `/admin/`에 도착했다. |
| `/admin/dashboard` 직접 진입 | SPA 폴백 200. 라우터가 `/admin/` basename 아래에서 `/dashboard`를 매칭했다(보호 라우트가 refresh를 호출함). `POST /auth/token/refresh`는 슬래시로 시작하는 같은 출처 상대 URL로 나가 404를 받았다. 이어서 거부된 세션은 사이트 루트 `/`(이 컨테이너에서는 404)가 아니라 `/admin/`(로그인 폼)으로 이동했다. |

확인하지 않은 것: 컨테이너 뒤에 백엔드가 없었으므로 로그인 흐름과 그 뒤의 페이지들.
