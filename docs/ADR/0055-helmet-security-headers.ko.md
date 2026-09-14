# ADR 0055: `helmet`을 통한 보안 응답 헤더

- Status: Accepted — implemented, live-verified (unit, e2e, 그리고 실제 브라우저로 `/doc` 확인)
- Date: 2026-09-11
- English: [0055-helmet-security-headers.md](0055-helmet-security-headers.md)

## Context

2026-09-11에 `backend/main.ts`를 점검한 결과, 이 앱은 어떤 보안 강화 응답 헤더도 보내고
있지 않았다 — `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Strict-Transport-Security` 등 브라우저가 응답을 MIME 스니핑하도록 속거나, 악의적인
페이지 안에 프레임으로 삽입되거나, 주입된 인라인 스크립트를 실행하지 못하게 막는 헤더가
하나도 없었다. 이는 ADR 0053/0054(요청 횟수 제한)와 같은 성격의 공백으로, Engineering
Principles > Performance & Security의 `Minimize Attack Surface`가 지적하지만 아직 이
스택에서 막지 않은 지점이었다.

`helmet`은 Express/NestJS에서 이 문제에 쓰는 표준 답이다 — OWASP가 권장하는 헤더 집합을
한 번에 설정해주는 미들웨어 하나이며, MIT 라이선스이고, 이 저장소에 설치한 버전
(`helmet@8.3.0`) 기준 `pnpm audit --prod`가 알려진 취약점 0건을 보고한다.

도입 전에 짚어야 할 구체적인 위험이 하나 있었다: `helmet()`의 기본
`Content-Security-Policy` directive 집합은 `script-src`에 `'unsafe-inline'`을 포함하지
않는다. `SwaggerModule.setup('doc', ...)` (`@nestjs/swagger`가 감싸는
`swagger-ui-express`)가 서빙하는 HTML 페이지는 맨 아래 `<script>` 블록 — 실제로
`SwaggerUIBundle({...})`을 호출해 UI를 렌더링하는 바로 그 코드 — 이 별도의
`<script src>` 파일이 아니라 인라인이다. ADR 0009가 이미 "Swagger가 곧 이 프로젝트의
API 문서"라고 못박은 만큼, `/doc`을 조용히 빈 화면으로 만드는 변경은 헤더 강화를 위해
감수할 만한 트레이드오프가 아니다.

## Decision

### D1 — `app.use()`로 전역 `helmet()` 적용, `bootstrap()`에서 가장 먼저

`backend/main.ts`는 `bootstrap()`에 등록되는 첫 번째 미들웨어로 `app.use(helmet({ ... }))`을
호출한다 — CORS, `cookieParser()`, 전역 `ValidationPipe`보다 앞선 위치다. 모든 라우트의
모든 응답이 이 헤더 집합을 받는다. 이는 이런 종류의 첫 번째 횡단 관심사를 도입할 때 ADR
0053이 취한 형태를 그대로 따른 것이다 — 컨트롤러별 opt-in이 아니라 하나의 전역 등록
지점을 택했는데, opt-in을 빠뜨렸을 때의 실패 양상(새 컨트롤러가 강화된 헤더 없이 조용히
배포되는 것)은 누군가 실제로 확인해보기 전까지는 보이지 않기 때문이다 — ADR 0053 D1이
요청 횟수 제한 가드를 전역으로 둔 이유와 동일하다.

### D2 — `script-src`만 `'self' 'unsafe-inline'`으로 완화하고, 나머지 기본 directive는 모두 유지

```ts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
```

실제 브라우저로 라이브 검증했다(Playwright MCP로 실행 중인 dev 서버의 `/doc`에 접속).
아무 override 없이 `helmet()`만 적용했다면, 바로 이 directive가 Swagger UI의 인라인
부트스트랩 스크립트를 막았을 것이다. `contentSecurityPolicy` 자체를 끄는 대신, 그리고
다른 directive는 전혀 건드리지 않고 `script-src` 하나만 완화함으로써, `/doc`을
포함한 모든 라우트에서 나머지 기본 보호(`object-src 'none'`, `frame-ancestors 'self'`,
`base-uri 'self'` 등)는 그대로 유지된다. `style-src`는 손댈 필요가 없었다 — helmet의
기본값이 이미 거기에 `'unsafe-inline'`을 포함하고 있다.

**검토 후 기각한 대안들:**
- **`contentSecurityPolicy`를 통째로 끄기** — 가장 간단한 해법이지만, `/doc`에
  필요한 인라인 스크립트 하나 때문에 모든 라우트의 CSP 보호를 전부 버리는 셈이다.
  directive 하나만 완화하는 것보다 명백히 더 나쁜 선택이라 기각했다.
- **`/doc` 라우트에서만 CSP를 끄기** (두 번째 `helmet()` 인스턴스나 라우트 범위
  미들웨어) — Swagger를 제외한 나머지 라우트는 더 엄격한 기본 CSP를 유지할 수 있지만,
  인라인 `<script>` 블록 하나 때문에 보안 헤더 코드 경로가 두 개로 늘어난다. NestJS의
  Swagger 연동 공식 문서 역시 여기서 택한 directive 완화 방식을 권장한다. `/doc`은
  이미 `@ApiTags`로 문서화된, 신뢰되지 않은 사용자 콘텐츠를 다루지 않는 개발자용
  도구 페이지이므로, 어디에도 실질적인 추가 보호를 주지 못하면서 구성 요소만 늘리는
  선택이라 기각했다.
- **Swagger의 인라인 스크립트를 별도 파일로 빼내고 엄격한 기본값을 유지** —
  `@nestjs/swagger`가 번들하는 `swagger-ui-express` 템플릿을 패치해야 하는데, 이
  프로젝트가 관리하지도 포크하고 싶지도 않은 대상이다. 문제 크기에 비해 과한
  대응이라 기각했다.

### D3 — 새 환경 변수 없음

ADR 0053의 `THROTTLE_ENABLED`와 달리, 여기서의 `helmet` 설정에는 dev/prod/e2e
스위트 사이에 달라져야 할 축이 없다 — 헤더 집합은 요청마다 고정이고 상태를 갖지
않으며, `THROTTLE_ENABLED`가 존재하는 이유(수백 건의 연속 e2e 요청이 공유 인메모리
카운터를 나눠 쓰는 문제를 격리하는 것)와도 무관하다. Joi 스키마 항목도,
`.env.example` 항목도 추가하지 않는다.

## Consequences

- **이제 모든 라우트가 `helmet`의 전체 헤더 집합을 받는다** — `Content-Security-Policy`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`,
  `Referrer-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`,
  `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Frame-Options`,
  `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection` — 실행 중인 dev 서버의
  `/doc`과 `/health/live` 양쪽에 대해 `curl -i`로 라이브 검증했다.
- **`/doc`은 헤더 확인뿐 아니라 실제 브라우저로 엔드투엔드 검증했다**: Playwright
  MCP로 `/doc`을 로드해 모든 태그 그룹과 전체 Schemas 목록이 렌더링됨을 확인했고,
  "Authorize" 버튼을 클릭해 Basic/쿠키 인증 모달이 `Content-Security-Policy` 위반
  콘솔 에러 없이, 콘솔 에러 0건으로 열리는 것을 확인했다.
- **알려진 한계, 현재는 그대로 수용**: helmet의 기본 `Strict-Transport-Security`
  헤더는 이 앱이 dev에서 평문 HTTP로 종료되고 자체 TLS 종단을 갖지 않음에도
  (ADR 0034, 여전히 보류/미예정) 그대로 전송된다. 이는 실질적으로 무해하다 —
  브라우저는 `Strict-Transport-Security`를 이미 HTTPS로 도착한 응답에서만
  준수하므로, ADR 0034의 HTTPS 종단 작업이 실제로 착수되기 전까지는 아무 기능적
  효과가 없다. 그 상황이 바뀔 때만 다시 검토한다.
- **가드 영향 없음** — 이것은 Nest 가드가 아니라 Express 레벨 미들웨어다.
  `ThrottlerGuard`/`JwtAuthGuard`/`RolesGuard`보다 먼저 요청 파이프라인에서 실행되며,
  기존 가드의 적용 범위를 전혀 바꾸지 않는다.
- **검증 완료**: `pnpm lint`(clean), `pnpm test`(270/270), `pnpm test:e2e`(76/76,
  포트 5435의 `docker compose up -d db` 대상)가 모두 통과했다. `helmet` 추가 후에도
  `pnpm audit --prod`는 계속 clean하다.

### Addendum (2026-09-11) — e2e 스위트에 무관한 한 줄짜리 픽스처 수정이 필요했고, 개발자 확인 후 해소함

이 변경 직후 처음 돌린 `pnpm test:e2e`는 73/76 실패를 보였고, 모두 `register()`가
`201` 대신 `400`을 반환하는 지점이었다. 이 ADR의 잘못이라고 가정하기 전에 먼저
원인을 조사했다(root-cause-before-fix): 컴파일된 빌드에 직접 `POST /auth/register`를
curl로 호출해 동일한 `400 AUTH_WEAK_PASSWORD` 응답을 재현했고, `git status`/`git log`로
이 작업이 실제로 건드린 파일이 `backend/main.ts`, `package.json`, `pnpm-lock.yaml`
셋뿐임을 확인했다 — `AuthService.register`의 비밀번호 강도 검증
(`PASSWORD_STRENGTH_PATTERN`, 커밋 `095a32a`, 이 작업 시작 전부터 이미 `dev`에 있었음)은
이 변경이 손대지 않은 코드였다. 실제 원인: `test/app.e2e-spec.ts`의 `PW` 픽스처
(`'pw12345678'`)가 그 커밋보다 먼저 작성된 값이라 정규식(대문자와 기호 필요)을 한 번도
만족한 적이 없었다. 이 작업의 명시된 범위 밖 파일을 수정하기 전에 개발자에게
확인했고(Scope Discipline), 개발자는 한 줄 수정을 선택했다. `PW`는 이제
`'Pw1234567!'`이며, e2e 76건이 모두 통과한다. 이는 `helmet`과 무관한, 기존부터 있던
테스트/구현 간 어긋남이지 이 ADR의 변경이 만들어낸 결함이 아니다.
