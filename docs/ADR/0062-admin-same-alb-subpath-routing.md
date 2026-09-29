# ADR 0062: Admin console hosting — a third workload on the same ALB, at `/admin`

- Status: Accepted — implemented (`helm lint`/`helm template`, `pnpm test`, a local image build and curl checks against `/admin/*`, `helm install --wait` on Docker Desktop's Kubernetes, and a CI run on `dev` (smoke test and image push) verified; on a live ALB 2026-09-26 the health checks needed a per-Service path, and `/admin`'s own routing could not be told apart from the frontend's fallback by status code until the 2026-09-29 addendum read the bodies). The 2026-09-30 addendum adds the first real-user-flow pass (register/login/upload/post/comment/visibility on the frontend, role-change+audit-log+D4's sign-out redirect on admin) and, along the way, found and fixed an unrelated bug in `PostService` (unlisted attachments 403ing for their own owner)
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

## Addendum (2026-09-25): browser check of the production image

Run by me with Playwright against the real `sharenpo-admin:local` image (nginx, CSP header on)
started on a local port, with no backend behind it. Requests to `/auth/*` therefore answer nginx's
own 404, which is what exercises the rejected-session path.

| Check | Result |
|---|---|
| `/admin/` | The login form renders (heading "Admin Login", email and password fields, "Sign In"), title "Sharenpo Admin". Console: 0 errors, 0 warnings, so no CSP violation. JS, CSS and favicon are all requested under `/admin/…` and answer 200. |
| `/admin` | Followed the 301 and landed on `/admin/`. |
| `/admin/dashboard` opened directly | SPA fallback 200. The router matched `/dashboard` under the `/admin/` basename (the protected route called refresh). `POST /auth/token/refresh` went to a relative same-origin URL and got 404. The rejected session then navigated to `/admin/` (the login form), not to the site root `/`, which answers 404 in this container. |

Not covered: the login flow and the pages behind it, since no backend ran behind the container.

## Addendum (2026-09-25): CI first run

Resolves Follow-up 2. Pushing `c0b309d` to `dev` (done by the developer) ran the CI workflow, run
`36065808388`, and all nine jobs passed. Read from the run and from Docker Hub:

| Check | Result |
|---|---|
| `docker-publish-admin` | Every step passed. The runner's smoke test printed `Liveness check passed` and `Smoke test passed (redirect, SPA index, deep-link fallback, asset 404, security headers)`, then the image was built and pushed as `bluecode1775/sharenpo-admin:<sha>`. |
| Docker Hub | `docker manifest inspect bluecode1775/sharenpo-admin:<sha>` succeeds (`amd64` plus an `unknown/unknown` entry, which is how buildx lists an attestation manifest). The frontend and backend images exist under the same tag. |
| `admin-e2e` | 11 passed, run after the `vite.config.ts` `base` change (the e2e drives the dev server, where `base` stays `/`). |
| `admin-lint-and-unit` | Lint has 0 errors (the existing warning in `protected-route.tsx` remains); 24 unit tests passed. |
| pnpm pin | `frontend-lint` and `admin-lint-and-unit` both had corepack download `pnpm-10.14.0.tgz`, so the `packageManager` field takes effect in CI. |

Still not exercised: the `main` path (`:latest` and the `linux/arm64` build), because this run was on
`dev`, which builds `linux/amd64` only; the `sharenpo-admin` entry in `docker-tag-cleanup.yml`, which
runs on a schedule from `main`'s copy; `deploy.sh`'s admin tag check against the image that now
exists; and everything that needs a live ALB.

## Addendum (2026-09-26): the live ALB — health checks need a path per Service

The developer enabled the Ingress on a live cluster. The session read AWS and the cluster read-only
and requested the public site with `curl`. Times are UTC.

**What was seen.** Status codes: `https://sharenpo.cloud/` `200`, `/file` `401`, `/admin/` `200`;
bodies and headers were not read. `/file` `401` can only have come from the backend, so the API
prefix rules did win over the `/` rule. `/admin/` `200` does not show that the `/admin` rule was
hit: the frontend's nginx (`location / { try_files $uri /index.html; }`) answers `200` for that
path too, so a request that went to the frontend instead would have looked the same. The admin
group being `healthy` (below) only shows the admin pod serves `/admin/` when the ALB asks it
directly. Whether the ALB sends `/admin/*` to the admin Service is still unobserved. The ALB had
three target groups, all with the default health check (`/`, success code `200`):

| Target group | Result |
|---|---|
| frontend (`:8080`) | `healthy`. `/` is the SPA's `index.html`. |
| admin (`:8080`) | `unhealthy`, `Target.ResponseCodeMismatch [404]`. The admin nginx serves only under `/admin/`. |
| backend (`:3000`) | `unhealthy`, `Target.ResponseCodeMismatch [404]`. The backend has no `GET /`. |

The site still answered because an ALB sends requests to every target of a group when all of its
targets are unhealthy. That also means an unhealthy target never leaves rotation, so a dead pod
would keep receiving requests.

**Decision.** Set the health-check path per Service through the AWS Load Balancer Controller's
`alb.ingress.kubernetes.io/healthcheck-path` annotation on the Service: backend `/health/live`,
admin `/admin/`, frontend unchanged. The chart gained `service.annotations` and
`admin.service.annotations` (empty by default) and `values-prod.yaml` sets the two paths (chart
`0.5.1`, commit `60bfe2a`). The ALB's health check goes straight to the pod, not through the
Ingress rules, so ADR 0058's exclusion of `/health` from the Ingress paths is unaffected.

Rejected: `alb.ingress.kubernetes.io/success-codes: 200-404` on the Ingress, which would make the
health check accept a missing page as healthy; and leaving it as it was.

**Result.** After the developer ran `helm upgrade` (REVISION 3, 17:41:42), all three target groups
were `healthy` at 17:43:15 with health-check paths `/`, `/admin/` and `/health/live`. So the
controller (`aws-load-balancer-controller-1.7.1`, app `v2.7.1`) reads the annotation from the
Service. The pods were not restarted and the public status codes stayed `200`, `401`, `200`.

## Addendum (2026-09-29): second live ALB — the `/admin/` body settles the 2026-09-26 open item

The 2026-09-26 stack was torn down and `app-infra`/`addons`/the chart were re-applied for a second
live pass. The 2026-09-26 addendum above left one thing explicitly open: `/admin/`'s `200` proved
nothing on its own, because the frontend's SPA fallback answers `200` for `/admin/` too. This pass
read the bodies.

- `curl -s https://sharenpo.cloud/admin/` returned `<title>Sharenpo Admin</title>`, with
  `/admin/assets/index--Ii8g1iN.js`/`/admin/assets/index-5ZLQDVBl.css` and
  `/admin/favicon.svg` — distinct from `/`'s `<title>Sharenpo</title>` and bare `/assets/...`.
  The `/admin` Ingress rule is reaching the admin pod, not falling through to the frontend's SPA
  fallback.
- `curl -I https://sharenpo.cloud/admin` (no trailing slash) returned `301` with `server: nginx`
  and `location: /admin/`, and none of the ALB Controller's own response headers — the admin
  container's own redirect (`admin/nginx.conf`), not an ALB-level rewrite.

Both close the last two open rows in [k8s/helm/README.md](../../k8s/helm/README.md)'s Pending
list for this ADR. Nothing decided here changes.

## Addendum (2026-09-30): real-user-flow live verification, frontend through admin

Every prior check against the live stack asked "does the request reach the right pod" —
status codes, response headers, target-group health. None of it asked "does a real user get
the result they expect." This pass did, end to end, against `https://sharenpo.cloud`
(Playwright, throwaway registered accounts, deleted after each run), following after Task 2
(admin/frontend split) and Task 4 (login/CSP) in the same verification series.

**Frontend** (`https://sharenpo.cloud`):
- Register → sign in → sign out; re-registering the same email surfaces "That email is
  already registered — try signing in." (`AUTH_EMAIL_TAKEN`) in the UI, not just as a raw API
  response.
- Uploaded one image, one audio (a hand-built 50-frame silent MP3 — no `.mp3` fixture existed
  in either e2e suite, so one was constructed as an in-browser `File`/`DataTransfer` object
  rather than added to the repo), and one video (the existing `frontend/e2e/fixtures/
  sample.mp4`) through `UploadForm`, then opened each on its `/view/:id` page. All three
  actually decoded and played in a real browser (`<audio>`/`<video>`: `readyState 4`,
  `currentTime` advancing after `.play()`, `error: null`) — not just "the tag rendered." This
  closes the "an actual upload/read round-trip... remains unverified" line on ROADMAP.md's
  **S3** row (Range-request/seek behavior stays open — not exercised here).
- Created a post with an attached file, listed it, opened its detail page, added a comment,
  edited it, deleted it.
- Toggled one file's visibility through all three states and confirmed the *actual*
  reachable range with anonymous (`credentials: 'omit'`) fetches against
  `GET /file/:id/content`: `private` → `403`, `public` → `200`, `unlisted` without the share
  token → `403`, with it → `200` — matching ADR 0025/0026 exactly.
- Dark-mode toggle and a 390×844 mobile viewport both rendered correctly with no console
  errors (excluding the baseline non-2xx `fetch` log entries every unauthenticated page load
  or expected-4xx already produces — those are the browser logging an HTTP response, not a JS
  exception).

**Real bug found and fixed while checking the mobile/dark-mode step**: a post with an
`unlisted` attached file rendered a broken preview (`403`) for every requester, including the
file's own owner, when opened through `PostDetailPage`. Root cause: `PostService.toResponse`
called `fileService.toResponse(post.file)` with no `requester` — the one call site that
didn't, out of every other one in `FileService` — so `FileResponseDto.shareUrl` could never be
computed, and separately `PostService.baseQuery()` never joined `file.creator`, so even after
passing `requester` through, `FileService`'s `isManager` check (`file.creator &&
canManage(...)`) stayed `false` regardless. `PostDetailPage.tsx`'s `shareUrl ?? fileUrl`
fallback then handed an unauthenticated `<img>`/`<audio>`/`<video src>` a token-less URL,
which `unlisted`'s access rule always refuses. `public` (no auth needed) and `private` (its
own authenticated blob-fetch path) were unaffected — only `unlisted` was structurally broken.
Fixed by threading `requester` through `toResponse`/`getPosts`/`getPostById`/`create`/
`resolveAttachment` and adding the missing `leftJoinAndSelect('file.creator', 'fileCreator')`
(`backend/post/post.service.ts`, `post.controller.ts`, commit `1c845a3`) — `pnpm test`
280/280, verified against a local `db`+`clamav` compose stack + dev servers (the API response
gained `shareUrl`; a same-origin image load, via the Vite proxy, succeeded pixel-for-pixel).
Not yet on the live stack — this fix needs its own deploy.

**Admin** (`https://sharenpo.cloud/admin/`):
- Signed in as a freshly-promoted superadmin (registered live, then promoted by the developer
  running `kubectl exec <backend-pod> -- env SUPERADMIN_EMAIL=<email> node
  dist/scripts/promote-superadmin.js` — the RDS instance is `publicly_accessible = false`, so
  the script has to run from inside a pod already in the VPC, not from a laptop against
  `.env`).
- `/admin/dashboard`, `/admin/users`, `/admin/logs` all resolved under the `/admin` router
  `basename` (D3).
- Changed a user's role `user → admin` from `/admin/users`; the table updated immediately and
  `/admin/logs` recorded it as `ROLE_CHANGE`, actor and target user IDs, `user→admin` — both
  the write and the audit trail work end to end on the live stack, not just in the local
  suite.
- A full page reload on `/admin/users` kept the session (no bounce to the login form).
- Signing out landed on `https://sharenpo.cloud/admin/` — **the live confirmation of D4's
  fix** (`session-guard.ts`'s `rejectSession()` hard-navigating to site root instead of the
  admin basename), which every earlier addendum here had only checked locally or against a
  backend-less container.

Console errors across every step: `0`, aside from the same baseline non-2xx `fetch` log noise
noted above. Test accounts and their files/posts were deleted after each check; the two role
changes made for this check (promote, then `user → admin` on a second account) are recorded
in `/admin/logs` permanently, by design (ADR 0013's audit log is append-only).
