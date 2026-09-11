# ADR 0055: Security Response Headers via `helmet`

- Status: Accepted — implemented, live-verified (unit, e2e, and a real browser against `/doc`)
- Date: 2026-09-11
- 한국어: [0055-helmet-security-headers.ko.md](0055-helmet-security-headers.ko.md)

## Context

A 2026-09-11 review of `backend/main.ts` found the app sends no hardening response
headers at all — no `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, `Strict-Transport-Security`, or any of the other headers that stop a
browser from being tricked into MIME-sniffing a response, framing the app in a hostile
page, or executing an injected inline script. This sits alongside ADR 0053/0054 (rate
limiting) as another gap `Minimize Attack Surface` (Engineering Principles >
Performance & Security) flags but nothing in the stack had closed yet.

`helmet` is the standard Express/NestJS answer to this — a single middleware that sets
the OWASP-recommended header set, MIT-licensed, with `pnpm audit --prod` reporting zero
known vulnerabilities against the version installed here (`helmet@8.3.0`).

The one concrete risk worth naming before adopting it: `helmet()`'s default
`Content-Security-Policy` directive set does not include `'unsafe-inline'` in
`script-src`. `SwaggerModule.setup('doc', ...)` (`@nestjs/swagger`, wrapping
`swagger-ui-express`) serves an HTML page whose bottom `<script>` block — the call that
constructs `SwaggerUIBundle({...})` and actually renders the UI — is inline, not a
separate `<script src>` file. ADR 0009 already settled that Swagger *is* this project's
API documentation, so a change that silently blanks `/doc` is not an acceptable
trade-off for the header hardening.

## Decision

### D1 — Global `helmet()` via `app.use()`, applied first in `bootstrap()`

`backend/main.ts` calls `app.use(helmet({ ... }))` as the first middleware registered in
`bootstrap()`, before CORS, `cookieParser()`, and the global `ValidationPipe` — every
response, from every route, carries the header set. This mirrors ADR 0053's shape for
introducing the first cross-cutting concern of its kind: a single global registration
point rather than a per-controller opt-in, because the failure mode of a *forgotten*
opt-in (a new controller silently shipping without hardened headers) is invisible until
someone probes for it — the same reasoning ADR 0053 D1 gave for the rate-limit guard.

### D2 — `script-src` widened to `'self' 'unsafe-inline'`; every other default directive kept

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

Live-verified against a real browser (Playwright MCP navigating to `/doc` on the running
dev server): with plain `helmet()` and no override, this is exactly the directive that
would have broken Swagger UI's inline bootstrap script. Widening only `script-src` — not
disabling `contentSecurityPolicy` outright, and not widening any other directive — keeps
every other default protection (`object-src 'none'`, `frame-ancestors 'self'`,
`base-uri 'self'`, etc.) intact for every route including `/doc` itself. `style-src`
needed no change: helmet's own default already includes `'unsafe-inline'` there.

**Alternatives considered and rejected:**
- **Disable `contentSecurityPolicy` entirely** — the simplest fix, but it throws away
  every CSP protection for every route, not just the one inline script `/doc` needs.
  Rejected as strictly worse than a one-directive widening.
- **Disable CSP only on the `/doc` route** (a second `helmet()` instance or a
  route-scoped middleware) — would keep the default (tighter) CSP everywhere except
  Swagger, but adds a second security-header code path to reason about for a single
  inline `<script>` block, and NestJS's Swagger integration docs themselves recommend
  the directive-widening approach taken here. Rejected as more moving parts for no
  extra protection anywhere that matters (`/doc` is already `@ApiTags`-documented,
  developer-facing tooling, not a page handling untrusted user content).
- **Vendor Swagger's inline script out to a separate file and keep the strict default**
  — would need patching `@nestjs/swagger`'s bundled `swagger-ui-express` templates,
  which this project does not control and does not want to fork. Rejected as
  disproportionate to the problem.

### D3 — No new env var

Unlike ADR 0053's `THROTTLE_ENABLED`, `helmet`'s configuration here has no axis that
needs to differ between dev, prod, or the e2e suite — the header set is static
per-request, not stateful, and doesn't interact with `THROTTLE_ENABLED`'s reason for
existing (isolating a shared in-memory counter across hundreds of sequential e2e
requests). No Joi schema entry, no `.env.example` entry.

## Consequences

- **Every route now carries the full `helmet` header set** — `Content-Security-Policy`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`,
  `Referrer-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`,
  `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Frame-Options`,
  `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection` — live-verified via `curl -i`
  against both `/doc` and `/health/live` on the running dev server.
- **`/doc` verified end-to-end in a real browser**, not just by header inspection:
  Playwright MCP loaded `/doc`, confirmed every tag group and the full Schemas list
  rendered, clicked "Authorize" and confirmed the Basic/cookie-auth modal opened with no
  `Content-Security-Policy` console violation and zero console errors.
- **Known limitation, accepted as-is**: `helmet`'s default `Strict-Transport-Security`
  header is sent even though this app terminates plain HTTP in dev and has no TLS
  termination of its own (ADR 0034, still deferred/unscheduled). This is inert in
  practice — browsers only honor `Strict-Transport-Security` when it arrives over an
  already-HTTPS connection — so it carries no functional effect until ADR 0034's HTTPS
  termination work actually lands; revisit only if that changes.
- **No guard impact** — this is Express-level middleware, not a Nest guard; it runs
  before `ThrottlerGuard`/`JwtAuthGuard`/`RolesGuard` in the request pipeline and changes
  no existing guard's coverage.
- **Verified**: `pnpm lint` (clean), `pnpm test` (270/270), `pnpm test:e2e` (76/76,
  against `docker compose up -d db` on port 5435) all pass. `pnpm audit --prod` stays
  clean with `helmet` added.

### Addendum (2026-09-11) — e2e suite required an unrelated one-line fixture fix, unblocked with developer confirmation

The first `pnpm test:e2e` run after this change showed 73/76 failures, all at
`register()` returning `400` instead of `201`. Investigated before assuming it was this
ADR's fault (root-cause-before-fix): reproduced the exact same `400 AUTH_WEAK_PASSWORD`
response by curling `POST /auth/register` directly against a compiled build, and
confirmed via `git status`/`git log` that the only files this task had touched were
`backend/main.ts`, `package.json`, and `pnpm-lock.yaml` — `AuthService.register`'s
password-strength check (`PASSWORD_STRENGTH_PATTERN`, commit `095a32a`, already on `dev`
before this task started) was untouched by this change. The real cause:
`test/app.e2e-spec.ts`'s `PW` fixture (`'pw12345678'`) predates that commit and never
satisfied its regex (needs an uppercase letter and a symbol). Confirmed with the
developer before editing a file outside this task's stated scope (Scope Discipline);
they chose the one-line fix. `PW` is now `'Pw1234567!'` — all 76 e2e cases pass. This is
a pre-existing test/implementation drift unrelated to `helmet`, not a defect this ADR's
own change introduced.
