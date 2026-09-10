# ADR 0054: Per-Route Rate Limit Tuning

- Status: Accepted — implemented, e2e-verified
- Date: 2026-09-10
- Amends: [ADR 0053](0053-global-rate-limiting.md)
- 한국어: [0054-per-route-rate-limit-tuning.ko.md](0054-per-route-rate-limit-tuning.ko.md)

## Context

ADR 0053 shipped a single global default (100 requests/minute on every route via
`APP_GUARD`) and explicitly deferred differentiation: "Per-route tuning (e.g. a tighter
limit on `POST /auth/signin` specifically) is deliberately out of scope for this ADR ...
with route-specific limits deferred to a follow-up task." This ADR is that follow-up.

Two route groups are a materially different risk shape than the rest of the API:

- `POST /auth/register`, `POST /auth/signin`, `POST /auth/token/refresh` are the
  credential-check surface — the exact thing ADR 0053's security review flagged as
  unconstrained brute-force targets. 100 attempts/minute is still generous for automated
  password guessing.
- `POST /upload/attach` writes a file to disk on every call (`file/temp`,
  `UploadService.stageTemp`) before any ownership/claim check runs (that happens later, at
  `POST /file`) — a tight loop of attach calls is a cheap way to fill disk, independent of
  the 100MB per-file cap.

`POST /auth/signout` was considered for the same tightened bucket and rejected: it sits
behind `JwtAuthGuard`, so it requires an already-valid access token. An attacker with no
valid token cannot call it at all, and one who already has a valid token gains nothing by
calling it repeatedly — it is not a credential-guessing surface, so it keeps the global
100/minute default.

**A second, independent problem surfaced while implementing the first**: `ADR 0053`'s
`THROTTLE_ENABLED=false` escape hatch (used only by `test/e2e-env.ts` to keep
`test/app.e2e-spec.ts` from tripping its own rate limit) works by inflating the `default`
throttler's `limit` to `Number.MAX_SAFE_INTEGER` inside `ThrottlerModule.forRootAsync`'s
factory. Reading the installed `@nestjs/throttler` v6.5.0 source
(`node_modules/@nestjs/throttler/dist/throttler.guard.js`) to confirm this before adding new
per-route limits showed that a route-level `@Throttle({ default: { limit, ttl } })`
decorator replaces that `limit` value outright for the decorated route (`routeOrClassLimit
|| namedThrottler.limit` in `canActivate`) — the module-level inflation never runs for a
route carrying its own override. `test/app.e2e-spec.ts`'s `createUser()` helper alone calls
`POST /auth/register` + `POST /auth/signin` roughly 85 times across the suite, all against
one in-process server sharing one client IP; a hardcoded 5/minute override on those routes
would have exceeded that within the suite's run and broken it with unrelated 429s, silently
defeating the very escape hatch ADR 0053 built for this.

## Decision

### D1 — Route-level `@Throttle()` overrides on the credential and upload surfaces

- `backend/auth/auth.controller.ts`: `register`, `signIn`, and `rotateAccessToken` each
  carry `@Throttle({ default: { limit: 5, ttl: 60000 } })` (5 requests/minute). `signOut`
  is left undecorated — see Context above.
- `backend/upload/upload.controller.ts`: `uploadMedia` (`POST /upload/attach`) carries
  `@Throttle({ default: { limit: 15, ttl: 60000 } })` (15 requests/minute).
- Every other route keeps ADR 0053's global 100/minute default — this ADR does not touch
  `GET /file`, `GET /post`, `GET /comment`, or any other controller.
- The override target is the string `'default'` — the same (unnamed, implicitly-named)
  throttler ADR 0053 registered in `ThrottlerModule.forRootAsync`. No second named
  throttler was introduced: registering a genuinely separate named throttler (e.g.
  `'auth'`) would apply to *every* route by default unless every other controller opted out
  via `@SkipThrottle({ auth: true })` — invasive, and out of this task's scope. Overriding
  the existing `'default'` entry per-route is the library's documented mechanism for exactly
  this ("differentiate specific routes from the global default") and touches only the two
  files above.

### D2 — `THROTTLE_ENABLED` bypass moved from limit-inflation to `skipIf`

`backend/app.module.ts`'s `ThrottlerModule.forRootAsync` factory now returns a plain
`limit: 100` (no ternary) plus a module-level `skipIf: () => !configService.get<boolean>('THROTTLE_ENABLED')`.

`ThrottlerModuleOptions` supports `skipIf` as a top-level, guard-wide option, and
`ThrottlerGuard.canActivate` evaluates it (`namedThrottler.skipIf || this.commonOptions.skipIf`)
**before** resolving that throttler's effective `limit`/`ttl` — ahead of, not instead of, the
route-level override lookup. This makes the bypass apply uniformly to the `default`
throttler and to any route carrying a `@Throttle({ default: {...} })` override, in one
place, instead of needing every future override to separately account for
`THROTTLE_ENABLED`. `test/e2e-env.ts` is unchanged — it still just sets
`THROTTLE_ENABLED=false` via `setupFiles`; only the mechanism behind that flag changed.

## Consequences

- **Two routes tighter, everything else unchanged**: `POST /auth/register`,
  `POST /auth/signin`, `POST /auth/token/refresh` now allow 5 requests/minute per client;
  `POST /upload/attach` allows 15/minute. `POST /auth/signout` and every non-auth,
  non-upload route stay at ADR 0053's 100/minute default.
- **No new Swagger annotations**: consistent with ADR 0053 (which did not add a `429`
  `@ApiResponse` to any route despite the global guard applying everywhere), the tightened
  routes above also do not gain an explicit `429` Swagger entry. `RATE_LIMITED` remains
  documented at the `ErrorCode`/`AllExceptionsFilter` level, not per-route.
- **e2e suite verified, not just reasoned about**: `pnpm test` (264/264) and `pnpm test:e2e`
  (76/76, against `docker compose up -d db` on port 5435) both pass after D1+D2 — the
  `skipIf` fix was confirmed to actually prevent the regression D1 alone would have caused,
  not merely assumed safe.
- **No new env var, no schema change**: `THROTTLE_ENABLED`'s meaning to an operator is
  unchanged (still "off only for the e2e suite, always `true` in dev/prod") — only its
  internal implementation moved.
- **Alternatives considered and rejected**: a second named `'auth'`/`'upload'` throttler
  registered globally (rejected — would apply everywhere by default, requiring
  `@SkipThrottle` on every unrelated controller); leaving the `MAX_SAFE_INTEGER` inflation
  in place and separately re-deriving `THROTTLE_ENABLED` inside each new `@Throttle()` call
  (not possible — decorator arguments are static values evaluated at module-import time,
  before `ConfigModule`'s `envFilePath` loading runs, so they cannot read `ConfigService`);
  applying `@Throttle` at the `AuthController` class level instead of per-handler (rejected
  — would have pulled `signOut` into the tighter bucket along with the three credential
  routes, which Context above argues against).

### Addendum (2026-09-10) — `trust proxy` is unset; behind a reverse proxy every client shares one bucket

Follow-up discussion surfaced a gap this ADR's live verification did not test: `req.ip`
(the key `ThrottlerGuard`'s default `getTracker` uses) is Express's own client-socket-address
resolution, not the real originating client, once any reverse proxy sits in front of the app.
`backend/main.ts` has no `app.set('trust proxy', ...)` call (confirmed absent — grepped the
whole repo). This app is not currently deployed (the AWS/EKS stack is torn down), and
`k8s/helm/`'s `Ingress` is disabled by default with its `ingressClassName` left for an
operator to choose (checked `values.yaml`/`templates/ingress.yaml` — no ALB/nginx commitment
in the chart itself), so there is no live impact today. But the moment that `Ingress` is
turned on in front of any reverse proxy, every external client's `req.ip` would resolve to
that proxy's own address, collapsing the per-client 5/minute (`auth`) and 15/minute
(`upload`) buckets this ADR built into one **app-wide** bucket shared by every visitor —
five total login attempts per minute for the whole app, not per person.

Not fixed here — deliberately deferred, tracked in `CLAUDE.md`'s Known Gaps (Rate limiting
row) — because the correct `trust proxy` value (a hop count or explicit proxy IP range) is a
property of whichever ingress/load-balancer topology is chosen when `Ingress` is actually
enabled, which has not happened yet; setting a number now would be guessing at a topology
that doesn't exist. Revisit alongside whichever task turns `Ingress` on.

### Addendum (2026-09-11) — `frontend-e2e`/`admin-e2e` CI jobs needed the same `THROTTLE_ENABLED` bypass

D1's tighter 5/minute limit on `POST /auth/register`/`POST /auth/signin`/
`POST /auth/token/refresh` broke both Playwright-based CI jobs
(`frontend-e2e`, `admin-e2e` in `.github/workflows/ci.yml`), surfaced as the only two
failing checks on PR #2. Every spec in both suites calls a shared `registerAndSignIn`
helper (`frontend/e2e/helpers.ts:38`, `admin/e2e/helpers.ts`) to create a fresh account,
and both jobs boot the compiled backend directly (`node dist/main`) rather than
importing `test/e2e-env.ts` — the only place `THROTTLE_ENABLED=false` had been wired.
Every request from a CI runner shares one IP, so the 5/minute ceiling was exhausted
within the first few specs; the job logs showed every subsequent spec failing at the
same `registerAndSignIn` assertion (redirected back to `/login` instead of `/`), which
traced to a 429 on the auth routes, not an application defect.

This is the same category of gap as the `trust proxy` addendum above: this ADR's
"e2e suite verified" claim in Consequences covered `pnpm test:e2e` (the Jest suite,
which already goes through `test/e2e-env.ts`) but not the two Playwright-driven CI
jobs, which don't share that setup file.

Fixed by adding `THROTTLE_ENABLED: 'false'` to each job's own `env:` block in
`.github/workflows/ci.yml` (`frontend-e2e`, `admin-e2e`) — the same bypass
`test/e2e-env.ts` already used, applied at the CI-job level since neither job imports
that file. No change to D1's limits, D2's mechanism, or `THROTTLE_ENABLED`'s dev/prod
default (`true`) — CI-only.
