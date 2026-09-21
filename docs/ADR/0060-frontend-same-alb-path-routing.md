# ADR 0060: Frontend hosting — a separate nginx workload in the same Helm release, path-routed on the one ALB

- Status: Accepted — implemented (`helm lint`/`helm template`, a local image build, and a browser CSP check verified; live ALB, `kind`, and the CI job itself unverified)
- Date: 2026-09-21
- Amends: [ADR 0058](0058-ingress-path-allowlist.md) (D1's "no catch-all" now applies to the backend Service only; D2's reasons 3–4 no longer hold for the combined Ingress), [ADR 0010](0010-frontend-split-and-api-surface-freeze.md) (its "prod: `CORS_ORIGIN`" clause only)
- Extends: [ADR 0041](0041-helm-chart-project-adaptation.md)
- Relates to: [ADR 0012](0012-refresh-cookie-rotation.md) (its deferred cross-domain cookie question is resolved here), [ADR 0008](0008-opt-in-cors.md), [ADR 0034](0034-https-termination-stance.md), [ADR 0048](0048-ci-trigger-restoration-and-docker-publish-design.md), [ADR 0054](0054-per-route-rate-limit-tuning.md), [ADR 0055](0055-helmet-security-headers.md), [ADR 0056](0056-networkpolicy-east-west-restriction.md)
- 한국어: [0060-frontend-same-alb-path-routing.ko.md](0060-frontend-same-alb-path-routing.ko.md)

## Context

Nothing hosts the frontend today. `frontend/` has no `Dockerfile`, the
`docker-publish` job in `.github/workflows/ci.yml` builds only the backend
image, `k8s/helm/templates/` has no frontend workload, and ROADMAP.md has no
frontend-hosting row. Four earlier decisions each left the question
half-answered:

- [ADR 0010](0010-frontend-split-and-api-surface-freeze.md): the frontend
  "consumes the backend over HTTP (dev: a Vite proxy; prod: `CORS_ORIGIN`)".
- [ADR 0012](0012-refresh-cookie-rotation.md) rejected `SameSite=None` and
  deferred the cross-domain cookie question to "the Stage 4 deployment ADR".
- [ADR 0034](0034-https-termination-stance.md) put TLS termination at the
  ALB/Ingress. [ADR 0054](0054-per-route-rate-limit-tuning.md)'s 2026-09-14
  addendum recorded the target shape as one internet-facing ALB with no CDN or
  second reverse-proxy layer in front of it — the premise behind
  `trust proxy` = `10.0.0.0/16`.
- [ADR 0058](0058-ingress-path-allowlist.md) made the Ingress an explicit
  allow-list of the backend's seven controller prefixes, so `/health`,
  `/metrics`, and `/doc` never route through the ALB.

Read from code and official documentation for this decision (not recalled):

- `frontend/src/api/client.ts` builds every URL as
  `${VITE_API_BASE ?? ''}${path}`. Left unset at build time, requests use
  relative paths — same-origin, with no code change.
- `k8s/helm/templates/ingress.yaml` sends every path to the chart's own
  Service. A per-path backend cannot be expressed today.
- The AWS Load Balancer Controller's source (`main` branch,
  `pkg/ingress/model_build_listener_rules.go`) turns a `Prefix` path `/file`
  into the two ALB patterns `/file` and `/file/*`, so it matches neither
  `/files` nor `/posts/5`. It orders paths Exact first, then longest `Prefix`
  first (the controller's Ingress-spec page says the same). Ordering *across*
  separate Ingress resources in one IngressGroup is a different case:
  [#3033](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/3033)
  (a `/*` rule ending up above a specific path) was closed "not planned", and
  [#2203](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/2203)
  (rules ordered by manifest position rather than specificity) is closed with
  no fix version on the page read. Which controller version `addons/` installs
  was not checked.
- The SPA's routes — `/login`, `/`, `/posts/:id`, `/files`, `/view/:id`,
  `/settings` (`frontend/src/App.tsx`) — share no first path segment with the
  API prefixes (`/auth`, `/user`, `/post`, `/comment`, `/file`, `/upload`,
  `/audit-log`).
- `FileResponseDto.fileUrl`/`shareUrl` are absolute URLs the backend composes
  from `BASE_URL` (`{BASE_URL}/file/:id/content`), and
  `k8s/helm/values-prod.yaml` already sets `BASE_URL` to the public domain —
  the SPA's own origin if the SPA is served there.
- `k8s/infra/terraform/app-infra/main.tf`'s ACM certificate covers
  `var.domain_name` alone — no SAN, no wildcard.

Whether the Terraform states are currently applied was deliberately not
assumed; nothing below depends on it.

## Decision

**Why A** — confirmed by the developer, 2026-09-21: the merits compared in the
options review (same origin: no CORS and an unchanged cookie; no Terraform,
ACM, or DNS change; one Helm release and one rollback path shared with the
backend) and, in the developer's words, differentiation from their previous
app.

### D1 — Same origin: a separate static-file nginx workload serves the SPA on the API's own host

The SPA is built from `frontend/` into a static-file nginx image and runs as
its own Deployment and Service inside the existing Helm release, answering on
the same public host as the API. Same-origin means none of the following needs
a code change:

- `VITE_API_BASE` stays unset at build time (relative URLs).
- `CORS_ORIGIN` stays unset in prod — ADR 0008's opt-in is not exercised for
  this client.
- The refresh cookie is unchanged: `HttpOnly`, `SameSite=Strict`,
  `Path=/auth/token`, host-only, `Secure` in prod (ADR 0012). **ADR 0012's
  deferred question is resolved — no `SameSite=None`; its rejection of `None`
  stands.**
- `BASE_URL`, already the public domain, keeps `fileUrl`/`shareUrl` on the
  SPA's own origin.

### D2 — One Ingress, path-split: the backend allow-list is unchanged, the frontend takes `/`

A single `Ingress` resource carries both rule sets: ADR 0058's seven prefixes
(`Prefix`) route to the backend Service exactly as today, and one `/` `Prefix`
rule routes to the frontend Service. `templates/ingress.yaml` gains a per-path
backend Service, defaulting to the chart's own backend Service so existing
values render as they do now.

ADR 0058's security invariant is preserved, and it does not depend on rule
order: the backend Service is referenced only by the seven allow-listed
patterns, so `/health`, `/metrics`, and `/doc` cannot reach it under any
ordering — they fall to the frontend's `/` rule (SPA fallback or 404). What
changes is what ADR 0058 D1 ("no catch-all at all") and D2 reasons 3–4 ("no
ordering dependency", "zero template change") claimed. A catch-all now exists,
scoped to the frontend Service, and the combined Ingress relies on the
controller placing `/*` below the specific prefixes. If that fails, API paths
answer with the SPA's `index.html` — a loud, functional failure, not an
exposure.

One Ingress, never an IngressGroup: cross-Ingress ordering is exactly the case
#3033 reports.

### D3 — The frontend workload lives in the same chart, with its own selector labels

An Ingress backend must be a Service in the Ingress's own namespace, and a
second Ingress would bring back the cross-Ingress ordering in D2. So the
frontend Deployment and Service are added to `k8s/helm/` rather than to a
second chart ([ADR 0042](0042-k8s-helm-directory-consolidation.md): one
Kubernetes directory, no manifests beside the chart). Frontend pods carry
selector labels distinct from the backend's, as the `clamav-*` templates
already do with `app.kubernetes.io/name: clamav`: the backend Service selects
on `sharenpo.selectorLabels`, and a frontend pod carrying them would be picked
up as an API endpoint.

### D4 — Scope: `frontend/` only

`admin/` is outside this decision. It stays a separate cross-origin app
(`VITE_API_URL`, with `CORS_ORIGIN` set — the shape `admin-e2e` in
`.github/workflows/ci.yml` uses) until its own hosting is decided.

### Left to implementation

Not fixed here: whether a `frontend.enabled` value defaults on or off (the
`ingress`, `metrics.serviceMonitor`, and `networkPolicy` blocks are
values-gated with `values-prod.yaml` turning them on — the likely model), the
image name and tag scheme, the replica count, the exact nginx security-header
set, and the cache policy.

## Alternatives rejected

Each entry says what the alternative did better than A, since that is the
trade-off accepted.

- **B — a subdomain (`app.<domain>`) on its own Ingress host.** Cross-origin
  but same-site, so the refresh cookie would keep `SameSite=Strict`. It needs
  `CORS_ORIGIN` for the SPA's origin, `VITE_API_BASE` baked in at build time, a
  CORS preflight on requests carrying `Authorization`, one more DNS record, and
  an ACM change (the certificate has no SAN, so a Terraform change in
  `app-infra/`). Its real advantage: host-scoped rules carry no path-ordering
  dependency and leave ADR 0058 untouched. Not chosen — that advantage costs
  more AWS-side change than A.
- **C — S3 + CloudFront.** Evaluated only. CloudFront needs its ACM certificate
  in `us-east-1` (official CloudFront docs), so a second certificate and a
  provider alias; it also needs new Terraform and a deploy step this repo has
  none of (no CD). It brings in a CDN, which ADR 0005 lists among things not to
  propose without an explicit request and ADR 0036 leaves undesigned. ADR
  0054's no-CDN premise concerns whatever fronts the API: a static-only
  distribution would not touch it, one fronting the API would. Not chosen.
- **D — an external host (Vercel, Netlify).** On a provider-default domain the
  SPA is cross-site, so the refresh cookie would need `SameSite=None` — the
  option ADR 0012 rejected because it gives up CSRF protection. On a custom
  subdomain of the same registrable domain the cookie stays same-site and this
  becomes viable: the least work (no image, chart, or CI change) and a managed
  CDN. Against it: a second deploy path outside the Helm release, and Vercel's
  Hobby plan is limited to non-commercial personal use (official docs, read
  2026-09-21). Proxying the API through the host's rewrites would add the
  second proxy layer ADR 0054 rules out. Not chosen.
- **E — the backend serves the SPA (`ServeStaticModule`).** No new Kubernetes
  resource, but the `/` rule would then point at the backend Service,
  re-exposing `/health`, `/metrics`, and `/doc` — the exposure ADR 0058 closes
  — unless every SPA route were also allow-listed in Ingress values, copying
  `App.tsx`'s routing into Helm. It reverses ADR 0010's split, edits
  `app.module.ts` (a high-blast-radius file), and puts helmet's CSP (ADR 0055)
  on the SPA document, which would probably need widening for the S3 presigned
  redirect (ADR 0036) — inferred from CSP semantics, not tested in a browser.
- **Variants of A, rejected inside A.** (a) Allow-listing each SPA route in
  Ingress instead of a `/` rule keeps ADR 0058's "no catch-all", but copies
  `App.tsx`'s routes into values, and a route missing from the list would never
  reach the SPA, so its `path="*"` fallback could not rescue it. (b) A second
  chart with its own Ingress in one IngressGroup — the cross-Ingress ordering
  of D2 and D3.

## Consequences

- **Trade-off accepted.** A is the larger build: about nine config/code files
  across Docker, Helm, CI, and `deploy.sh`, against about three for option D on
  a custom subdomain, plus one ordering dependency that only a live ALB can
  settle. It was chosen for the reasons under Decision.
- ADR 0058 is amended, not superseded. Its allow-list and security invariant
  stand for the backend Service; D1's "no catch-all" no longer describes the
  combined Ingress, and D2 reasons 3–4 no longer hold. Its Helm array-merge
  caveat (D4) now covers the frontend `/` path too: an overlay that redeclares
  `ingress.hosts` must redeclare every path.
- ADR 0010's prod clause becomes "same-origin; `CORS_ORIGIN` unset".
  `frontend/vite.config.ts`'s header comment still says production uses "a real
  origin + CORS" — it goes stale once this is built. The file is
  high-blast-radius for `frontend/`, so editing that comment needs explicit
  approval (follow-up).
- The SPA and the API now share one path namespace at the ALB. No first
  segment collides today. A new top-level SPA route must not start with an API
  prefix (it would route to the backend), and a new controller prefix added to
  the allow-list must not equal an SPA route's first segment. `vite.config.ts`
  already documents the same hazard for the dev proxy (its regex-anchored
  `/file` and `/post`).
- **Residual, unverified.** The `/*`-below-the-prefixes ordering rests on the
  controller's documented behavior (Exact, then longest Prefix). It has not
  been observed on a live ALB or against the controller version `addons/`
  installs.
- The SPA's response headers are not inherited from helmet (ADR 0055 covers API
  responses only); nginx owns them. Under `STORAGE_DRIVER=s3`, the SPA's media
  and `fetch` calls follow a 302 to an S3 presigned URL (ADR 0036), so a CSP
  must allow the bucket origin (inferred, not tested).
- ADR 0056's NetworkPolicy selects `sharenpo.selectorLabels`; like the clamav
  pod, a frontend pod sits outside it. Whether it needs its own policy is
  decided at implementation.
- No new AWS resource and no Terraform change — the ALB and certificate are
  shared. The frontend pod adds load to existing nodes (unmeasured). No schema,
  entity, or backend code change.

### Follow-up work (not done here; each lands as its own task)

1. **Image** — `frontend/Dockerfile`, nginx config, `.dockerignore`:
   multi-stage (pnpm build, then nginx), non-root
   ([ADR 0030](0030-container-non-root-and-arch-stance.md)), `VITE_API_BASE`
   unset, an SPA fallback so deep links (`/posts/:id`, `/view/:id`) load, and
   the security headers above.
2. **Helm** — frontend Deployment and Service (distinct selector labels), a
   per-path backend in `ingress.yaml`, `values.yaml`/`values-prod.yaml` (the
   `/` path; redeclare the full path list in the prod overlay), and
   `k8s/helm/README.md`.
3. **CI** — `docker-publish` builds and pushes the frontend image with ADR
   0048's branch-aware tag/platform split, and a smoke test before the push
   (the page and a deep link answer 200).
4. **`deploy.sh`** ([ADR 0046](0046-deploy-sequence-automation.md)) — it
   resolves one image tag and passes only `--set image.tag=`; it must resolve
   and check the frontend tag too. Publishing both images under the same
   `:<sha>` would keep the single `IMAGE_TAG` rollback.
5. **Docs** — the `--set-json` recipe under "Enabling the ALB ingress" in
   `k8s/infra/terraform/README.md` (add the `/` path), `frontend/CLAUDE.md`, the
   `vite.config.ts` comment (needs approval), and CLAUDE.md's Helm/K8s entry
   once built.
6. **Verification** — `helm lint --strict`; `helm template --set ingress.enabled=true` shows the seven prefixes → backend Service and `/` →
   frontend Service; a throwaway `kind` cluster with `helm install --wait` and
   the built image; a local `docker build` and run with a deep-link check. On
   the first live ALB: `GET /file` with no token returns the API's 401 JSON, not
   HTML; `/files`, `/posts/1`, and an unknown path return the SPA's HTML;
   `/health/live`, `/metrics`, and `/doc` return the SPA's HTML (or 404) and
   never a backend response.
7. **`admin/` hosting** — a separate decision (D4).

### Addendum (2026-09-21) — implementation landed

Follow-up items 1–4 landed; item 5 landed except the `vite.config.ts` comment (it needs explicit
approval); item 6 is done for everything that needs no cluster; item 7 is still open.

- **The "left to implementation" choices, now fixed.** `frontend.enabled` defaults to `false` in
  `values.yaml` and `true` in `values-prod.yaml` (the `ingress`/`metrics.serviceMonitor`/
  `networkPolicy` model). The image is `bluecode1775/sharenpo-frontend`, tagged `:<sha>` on every
  push and `:latest` on `main` (ADR 0048's split); `deploy.sh` passes the backend's tag as
  `frontend.image.tag`. `replicaCount` is 1. nginx sets the security headers at the server level and
  the cache policy through `expires` — an `add_header` inside a location would silently drop the
  server-level set. The CSP allows `https://*.amazonaws.com` for images, media, and `fetch` (the S3
  presigned redirect) and `blob:` for private-file previews.
- **`ingress.yaml`** takes an optional `service: app|frontend` per path (default `app`). A `frontend`
  path is skipped while `frontend.enabled` is false, and any other value fails the render, so
  existing values render as they did — the old seven-path recipe still renders unchanged.
- **Two deviations found while implementing.**
  (1) The frontend Service's port is named `web`, not `http`. `servicemonitor.yaml` selects Services
  by `sharenpo.selectorLabels`, which every Service inherits through `sharenpo.labels`, and scrapes
  the port named `http`; the same name here would have made Prometheus scrape nginx's `/metrics` —
  the SPA fallback's HTML. The clamav Service escapes only because its port is named `clamd`.
  (2) pnpm is pinned inside the Dockerfile (`corepack prepare pnpm@10.14.0`). `frontend/package.json`
  has no `packageManager`, so corepack resolved the latest pnpm (12.5.1), which corepack 0.34.0 in
  `node:24.8.0` cannot run (`bin/pnpm.cjs` missing). The `frontend-*` and `admin-*` CI jobs share
  that unpinned setup — green on 2026-09-17, but nothing keeps them so. Pinning `package.json` in
  `frontend/` and `admin/` is a separate decision.
- **Found, not fixed.** (a) The AWS Load Balancer Controller's default `target-type` is `instance`,
  which its docs say needs a `NodePort` or `LoadBalancer` Service. This chart's Services are
  `ClusterIP` and the commented-out prod annotations don't set `target-type: ip`, so enabling the
  Ingress is expected to fail for the backend's routes as much as the frontend's — not observed
  live; listed in `k8s/helm/README.md`'s pending checks. (b) `docker-tag-cleanup.yml` prunes only
  `bluecode1775/sharenpo`, so the frontend repository's sha tags accumulate.
- **Verified.** `helm lint --strict` and `helm template` across `frontend.enabled` × `ingress.enabled`
  (seven rules without the frontend, eight with `/` → `<release>-frontend:80`; a mistyped `service`
  fails the render). A local `docker build` for amd64 and arm64: nginx runs as uid 101, `nginx -t`
  passes, deep links fall back to `index.html`, a missing `/assets` file is a 404, hashed assets get
  a one-year cache, and no dev origin is baked into the bundle. The SPA loads under the CSP in a real
  browser (Playwright; its one console error is the 405 on `POST /auth/token/refresh`, because that
  container has no backend). `actionlint` (with shellcheck) on the workflows; `bash -n` on
  `deploy.sh`, with shellcheck reporting nothing in the changed region.
- **Not verified.** `helm install --wait` (no `kind` on the implementing machine), the CI job itself
  (never run on GitHub), the CSP against a real S3 presigned redirect, and the live-ALB ordering
  check in follow-up 6.
