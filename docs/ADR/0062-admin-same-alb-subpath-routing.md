# ADR 0062: Admin console hosting — a third workload on the same ALB, at `/admin`

- Status: Accepted — implemented (`helm lint`/`helm template`, `pnpm test`, a local image build and curl checks against `/admin/*`, and `helm install --wait` on Docker Desktop's Kubernetes verified; live ALB unverified)
- Date: 2026-09-23
- Extends: [ADR 0060](0060-frontend-same-alb-path-routing.md) (D4's "`admin/` is outside this decision" is now resolved — same mechanism, a second app), [ADR 0058](0058-ingress-path-allowlist.md) (one more allow-listed prefix)
- Relates to: [ADR 0010](0010-frontend-split-and-api-surface-freeze.md) (admin stays a separate app — this adds a deploy path, not a route inside `frontend/`), [ADR 0022](0022-admin-console-import-from-chat-project.md)
- 한국어: [0062-admin-same-alb-subpath-routing.ko.md](0062-admin-same-alb-subpath-routing.ko.md)

## Context

`admin/` has never had a deploy path: no Dockerfile, no chart resources, no CI publish job.
It runs cross-origin against the backend (`VITE_API_URL`, `CORS_ORIGIN=http://localhost:5174`
in CI) with no dev proxy (`admin/vite.config.ts`'s `server` block has no `proxy` key, unlike
`frontend/`'s). ADR 0060 D4 named this out of scope on purpose and left it as its own decision.

Three shapes were on the table (frontend session, prior turn): (A) join the same ALB as a
third path-routed workload, mirroring `frontend/`'s ADR 0060 pattern; (B) leave it
undeployed; (C) a separate subdomain/external host. **Developer confirmed A.**

Unlike `frontend/`, which already served from `/` in both dev and prod, `admin/` moving onto
the shared ALB means it can no longer own the host root — `/` there is ADR 0060's frontend
rule. `admin/` has to live at a subpath (`/admin`), which `frontend/` never had to solve.
Investigated before writing this decision, not assumed:

- `admin/src/App.tsx`'s `<BrowserRouter>` carries no `basename` — every route (`/`,
  `/dashboard`, `/users`, `/logs`) is root-relative.
- `admin/vite.config.ts` sets no `base` — Vite's default (`/`) makes every built asset
  reference an absolute root path (`/assets/...`), which would 404 once actually served at
  `/admin/assets/...`.
- Every in-app navigation goes through React Router (`useNavigate()`, `<Navigate to>`) —
  confirmed by grepping `admin/src` for hardcoded paths — **except one**:
  `admin/src/auth/session-guard.ts`'s `rejectSession()` calls
  `window.location.replace('/')` directly, a raw browser API that does not know about
  React Router's `basename`. Under this ADR's design, a session conflict or failed refresh
  would hard-navigate to site root `/` — which is `frontend/`'s Service, not admin's login
  page (ADR 0060 D2's `/` rule). This is a **real bug this ADR's implementation fixes**, not
  a hypothetical.
- `admin/src/api/axios.ts`'s `baseURL: import.meta.env.VITE_API_URL` needs no code change:
  axios treats an `undefined` `baseURL` as "use the request URL as given" — the same
  same-origin-by-omission behavior `frontend/src/api/client.ts`'s `BASE = VITE_API_BASE ??
  ''` gets explicitly. But `admin/src/auth/session-guard.ts`'s own
  `` fetch(`${import.meta.env.VITE_API_URL}/auth/token/refresh`, ...) `` is a template
  literal — an unset env var stringifies to the literal text `"undefined"`, producing
  `undefined/auth/token/refresh`. This one **does** need the `?? ''` frontend already uses.
- The AWS Load Balancer Controller does not rewrite paths — confirmed against its source in
  ADR 0060's research and reconfirmed here: there is no `rewrite-target`-style annotation.
  A `Prefix` rule for `/admin` forwards the request with `/admin` still in the path (ALB
  patterns `/admin`, `/admin/*`, per `buildPathPatterns` — ADR 0060's Context). nginx inside
  the admin pod must therefore serve content **at** `/admin/...`, not at `/`.
- `/admin` collides with no existing prefix: not a backend controller prefix (`/auth`
  `/user` `/post` `/comment` `/file` `/upload` `/audit-log`), not a `frontend/` route (`/login`
  `/` `/posts/:id` `/files` `/view/:id` `/settings`). [ADR 0010](0010-frontend-split-and-api-surface-freeze.md)'s
  "do not re-add an `/admin` route to `frontend/`" is about a route *inside* `frontend/`'s own
  router — an Ingress path to a wholly separate Service is a different thing and doesn't
  reopen that decision.

## Decision

### D1 — Same mechanism as ADR 0060, a third leg

One more values-gated Deployment+Service (`admin.enabled`, default `false`,
`values-prod.yaml` turns it on), its own selector labels (distinct from both `sharenpo` and
`frontend`), and one more optional `service` value in `ingress.yaml`'s per-path backend
(`app` | `frontend` | `admin`) for a `/admin` `Prefix` rule. Same-origin with the API for
the same reason ADR 0060 chose it for `frontend/`: no `CORS_ORIGIN` needed in production, and
since `withCredentials: true`'s refresh cookie is `SameSite=Strict`, a genuinely cross-origin
admin would need the `SameSite=None` change ADR 0012 already rejected — same-origin avoids
that question entirely, for admin exactly as it did for frontend.

### D2 — Vite `base` is build-conditional; dev is untouched

`admin/vite.config.ts` sets `base: command === 'build' ? '/admin/' : '/'`. `pnpm dev` (used
locally, port 5174, no proxy — Context) keeps serving from root exactly as today; only the
Docker production build (which always runs `vite build`) gets the `/admin/` prefix. This
means local dev workflow for `admin/` is unaffected by this ADR — the one thing that changes
is what the Docker image's `vite build` produces.

### D3 — `basename={import.meta.env.BASE_URL}`, not a hardcoded string

`App.tsx`'s `<BrowserRouter>` takes `basename={import.meta.env.BASE_URL}` — Vite sets this
built-in env var to match whatever `base` resolved to (`/` in dev, `/admin/` in the
production build), so the router's basename and the asset base path can never drift apart
from a maintainer changing one and forgetting the other.

### D4 — The one real bug fix: `session-guard.ts`'s hard navigation

`rejectSession()`'s `window.location.replace('/')` becomes
`window.location.replace(import.meta.env.BASE_URL)` — same reasoning as D3, and it closes
the "session conflict silently drops an admin into the public frontend app" bug Context
found. The refresh-endpoint fetch gets `import.meta.env.VITE_API_URL ?? ''` — the same
`?? ''` pattern `frontend/src/api/client.ts` already uses, closing the `"undefined/auth/..."`
bug.

### D5 — nginx serves content at `/admin/...`, using `alias`

`admin/nginx.conf` mirrors `frontend/nginx.conf`'s SPA-fallback/cache/security-header shape,
but every `location` is anchored at `/admin/` (not `/`) and uses `alias` (which strips the
matched prefix) rather than `root` (which would keep it and double it up):

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

A bare `/admin` (no trailing slash) is also a real request the ALB can forward (`Prefix`
matches both `/admin` and `/admin/*`, ADR 0060's Context) — `location /admin/` alone does not
match a URI with no trailing slash, so a dedicated redirect is added:
`location = /admin { return 301 /admin/; }`. The final `location /` block answers `404`
rather than falling through to anything else — there is nothing else in this pod to fall
through to.

### D6 — CI, `deploy.sh`, and tag cleanup mirror the frontend pattern exactly

A third `docker-publish-admin` job (`needs: [admin-lint-and-unit, admin-e2e]`, the admin
equivalents of `docker-publish-frontend`'s gating jobs), same branch-aware tag/platform
split, same smoke test shape adjusted for the `/admin/` prefix (checks `/admin/`,
`/admin/dashboard` deep-link fallback, a missing `/admin/assets/*` 404, the CSP header).
`deploy.sh` resolves and passes a third `--set admin.image.tag=`, alongside the existing
backend and frontend ones. `docker-tag-cleanup.yml`'s matrix gains `sharenpo-admin` as a
third entry — the same reasoning ADR 0060's addendum already recorded for adding
`sharenpo-frontend`.

## Consequences

- Same trade-off ADR 0060 already accepted, now paid a second time: more files (a third
  Dockerfile/nginx.conf/Helm workload/CI job) than leaving `admin/` undeployed, chosen for
  the same reasons (same-origin, one Ingress, one Helm release, one rollback path).
- `admin/`'s local dev workflow (`pnpm dev` on `:5174`, cross-origin against `:3000`, needs
  `CORS_ORIGIN`) is completely unchanged — only the Docker production build differs. `admin/e2e/`
  is untouched for the same reason: it drives the dev server, not the production image.
- `session-guard.ts`'s two fixes (D4) are real bug fixes, not new behavior conditional on
  this ADR — they were already wrong (a hard navigation ignoring the SPA's own base path),
  ADR 0060 landing on `/` is only what makes the bug reachable and worth fixing now.
- `admin/src/auth/session-guard.spec.tsx`'s existing assertion
  (`toHaveBeenCalledWith('/')`) needed no change: Vitest's `import.meta.env.BASE_URL`
  defaults to `/` (it never runs `vite build`), so the D4 rewrite still resolves to `'/'`
  under test — confirmed by running the suite, not assumed.
- No schema, entity, or backend code change. `ADR 0058`'s allow-list gains one more prefix
  (`/admin`) in the same values-driven way `/` did for `frontend/` — the backend Service
  stays exactly as allow-listed as ADR 0058 left it.
- `k8s/helm/README.md`'s live-only pending checklist (ADR 0060's list) gains the same class
  of entries for `/admin`: the path sitting below the other allow-listed prefixes and above
  nothing (it has no sibling to be *above*, only alongside `frontend/`'s `/`), and rollout/
  scrape isolation for the third pod.

### Follow-up work (not done here; lands as its own task if picked up)

1. **Live verification** — the same class ADR 0060 still carries: `helm install --wait`
   against a real or local cluster, and everything that needs a live ALB (target health,
   the `/admin` rule's position relative to the other rules, HTTPS).
2. **CI first run** — `docker-publish-admin` has never executed on GitHub Actions; the first
   push creates `bluecode1775/sharenpo-admin` on Docker Hub (unseen, same as `-frontend`'s
   history).

## Addendum (2026-09-24): local-cluster verification

Narrows Follow-up 1: the local-cluster half is done, so what remains needs a live ALB.

`helm install --wait` ran on Docker Desktop's Kubernetes (`docker-desktop` context, v1.34.1) as
release `c13` in a throwaway namespace, with `frontend` and `admin` enabled and Ingress and
NetworkPolicy off. The developer ran the commands (recipe: `k8s/helm/README.md` > "Verifying on
Docker Desktop's Kubernetes") and reported that the output matched every expected value below. From
the session I could confirm only that the cluster was `Ready`, that the namespace, Postgres and
Secret were created, that the release and namespace were gone afterwards, and that the backend
image built from current source existed locally; the raw command output was not seen.

Images: backend and admin built from current source, frontend built two days earlier and not
rebuilt for this run, all with `pullPolicy=Never`. A throwaway `postgres:16` stood in for RDS.

| Check | Expected, and reported as matching |
|---|---|
| `helm install --wait --timeout=600s` | `STATUS: deployed` |
| Pods | app, frontend, admin, clamav and postgres all `Running` |
| Endpoints | `c13`, `c13-frontend` and `c13-admin` one address each, all different — the backend Service selects neither SPA pod |
| admin Service, in-cluster curl | `/admin` 301, `/admin/` 200, `/admin/dashboard` 200, `/admin/assets/nope.js` 404, `/` 404 |
| frontend Service | `/` 200, `/posts/1` 200, `/assets/nope.js` 404 |
| backend Service | `:3000/health/ready` 200 |

A ready admin pod means its probe (`GET /admin/`) passes through the `alias` config, and the
distinct endpoints show the selector labels keep the three workloads apart (D1, D5).

Still unverified: everything that needs an ALB — rule ordering between `/`, `/admin` and the API
prefixes, `target-type: ip`, the NetworkPolicy ingress rule for the ALB, and HTTPS/redirects
(checklist in `k8s/helm/README.md`); `docker-publish-admin` on GitHub Actions; `deploy.sh`'s admin
tag check against a real Docker Hub image; `helm upgrade` and rollback with three images.
