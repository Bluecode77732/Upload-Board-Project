# ADR 0039: Production DB TLS — Remove `rejectUnauthorized: false`, Verify via a Real CA When a Target Exists

- Status: Accepted
- Date: 2026-08-15
- Amends: commit `41c8c2c` (introduced the setting this ADR removes)
- 한국어: [0039-db-tls-verification-stance.ko.md](0039-db-tls-verification-stance.ko.md)

## Context

Commit `41c8c2c` ("Modified: app.module; Switched SSL validation on for
uploading images on DB...") added this to `backend/app.module.ts`'s
`TypeOrmModule.forRootAsync` factory:

```ts
...(configService.getOrThrow('NODE_ENV') === 'production' && {
  ssl: { rejectUnauthorized: false },
}),
```

Despite the commit message, `rejectUnauthorized: false` **disables** TLS
certificate validation on the database connection — the opposite of what
"switched SSL validation on" describes. Confirmed with the developer: this
was added deliberately at the time, to get a connection to an AWS-hosted
Postgres instance working during manual verification.

Investigating whether it is still necessary today:

- The same commit also touched `k8s/infra/terraform/main.tf`/`versions.tf` —
  diffed in isolation, those changes are a Helm-provider syntax update
  (`kubernetes { }` → `kubernetes = { }`, a Terraform/provider version bump)
  and nothing else. **No RDS or other managed-database resource is declared
  anywhere in this repository's Terraform**, before or after that commit.
- No CI job exercises `NODE_ENV=production` against a real database: the
  `e2e` job runs with `ENV: dev` against a plain `postgres:16` service
  container, and `docker-publish` only builds and pushes the image — it
  never runs it.
- ROADMAP.md's Stage 4 component-status table still marks **AWS** as 🆕 (not
  started) as of [ADR 0038](0038-terraform-iac-scaffold.md).

So nothing currently tracked in this repository depends on this setting.
It is not inert, though: `Dockerfile:53` pins `ENV NODE_ENV=production` for
the production stage, so the moment that image runs against any TLS-enabled
Postgres (which a real managed database almost certainly would be), the
setting activates and silently accepts any certificate — a live MITM
exposure with no current justification, since there is no real target it is
protecting a connection to.

A second, independent defect surfaced during the same investigation: the
setting branches on `NODE_ENV`, which is **not declared in the Joi
validation schema** (`app.module.ts`'s `ConfigModule.forRoot`) and is not
this project's established environment-gating convention. The codebase
already has a validated `ENV` (`'dev' | 'prod'`) used for exactly this kind
of production-only branching — e.g. `auth.controller.ts:164`'s refresh
cookie `Secure` flag: `this.configService.getOrThrow<string>('ENV') ===
'prod'`. The SSL block introduced a second, unvalidated, project-inconsistent
environment switch alongside the existing one instead of reusing it.

## Decision

- **Remove `rejectUnauthorized: false` now.** Nothing currently exercises
  it, so removing it changes no observed behavior in dev, CI, or the
  published image's boot sequence — it only removes a dormant liability.
- **Do not replace it with a stub gated on `ENV === 'prod'`.** There is no
  concrete production database target yet (Terraform is still an unadapted
  scaffold, [ADR 0038](0038-terraform-iac-scaffold.md)), so adding
  configuration for a target that doesn't exist is speculative
  (Scope Discipline / YAGNI) and risks guessing the wrong shape (a single
  CA file? a CA per environment? `sslmode=verify-full` semantics?) before
  the real requirement is known.
- **Record the correct pattern for when a real target exists**, so the next
  session reaches for it instead of re-adding `rejectUnauthorized: false`
  under time pressure: pass the actual CA certificate the database
  presents via `ssl: { ca: <certificate contents> }` (for AWS RDS
  specifically, AWS publishes a public CA bundle covering all regions), read
  through `ConfigService` from a new optional env var (e.g. `DB_SSL_CA`),
  declared in the Joi schema and `.env.example` in the same change that
  introduces it — following this project's existing Config convention
  (Architecture Decisions > Config). Gate it on the existing `ENV === 'prod'`
  check, not a second `NODE_ENV` branch.

## Alternatives rejected

- **Keep `rejectUnauthorized: false`, just fix the `NODE_ENV`→`ENV`
  inconsistency** — rejected: fixing the gating variable while leaving
  certificate validation disabled would fix the smaller, cosmetic problem
  and leave the actual security issue in place.
- **Add the full `DB_SSL_CA`/`ssl.ca` implementation now** — rejected: no
  database exists yet to test it against, and the concrete shape depends on
  a deployment-target decision (RDS vs. self-managed Postgres vs. something
  else) that Stage 4 hasn't made. Writing untestable config code now risks
  needing a rewrite once the real target is chosen — the same reasoning
  [ADR 0037](0037-helm-chart-scaffold.md)/[ADR 0038](0038-terraform-iac-scaffold.md)
  used to defer the Helm/Terraform adaptation itself.

## Consequences

- `backend/app.module.ts`'s `TypeOrmModule.forRootAsync` factory returns to
  its pre-`41c8c2c` shape — no `ssl` option, in every environment.
- Dev, CI, and the Docker image's boot sequence are unaffected: none of them
  currently sets up a TLS-enabled Postgres target, so none of them exercised
  the removed branch either way.
- Follow-up (not scheduled as its own task; lands naturally alongside the
  Terraform adaptation work [ADR 0038](0038-terraform-iac-scaffold.md)
  tracks): once a real production database target is chosen, add
  `DB_SSL_CA` (Joi schema + `.env.example`) and wire `ssl: { ca: ... }`
  gated on `ENV === 'prod'`, per the Decision above.
- No schema, entity, or API surface change.

### Addendum (2026-08-27/28) — the real target arrived, and the Decision was briefly violated before being corrected

The first live AWS deployment (ADR 0043/0044, RDS with `rds.force_ssl` enforced) hit
exactly the migration failure this ADR anticipated (`no pg_hba.conf entry ... no
encryption`). Under that pressure, the fix that landed first (commit `cf0cbfe`) added
`DB_SSL` (boolean) → `ssl: { rejectUnauthorized: false }` — reintroducing the precise
pattern this ADR's Decision rejected, gated on a new variable instead of reusing `ENV`.
It unblocked the deployment (`STATUS: deployed`, app pod `Running`) but left the RDS
connection encrypted with no certificate validation — a live MITM exposure, the same
category of risk this ADR removed in the first place.

Found and corrected the same day: `rejectUnauthorized: false` replaced with
`ssl: { ca: configService.get<string>('DB_SSL_CA') }` in both `app.module.ts` and
`data-source.ts`; `DB_SSL_CA` added to the Joi schema, required whenever `DB_SSL` is
`true` (`Joi.string().when('DB_SSL', { is: true, then: Joi.required() })`).
`k8s/helm/values-prod.yaml` carries the actual value: AWS's public `ap-northeast-2`
regional RDS root CA bundle (3 certificates — ECC384 and two RSA root CAs — from
`https://truststore.pki.rds.amazonaws.com/ap-northeast-2/ap-northeast-2-bundle.pem`),
inline as a YAML block scalar. Not secret — a CA certificate is public by design — so
it does not go through `secrets.existingSecret`. Re-deployed
(`bluecode1775/sharenpo:db-ssl-ca`, multi-arch, `helm upgrade` revision 4): the
pre-upgrade migration Job succeeded against the live RDS instance with real certificate
verification, not just a config-shape check — proof the regional bundle actually
validates that instance's presented certificate.

**Deliberate deviation kept from the original Decision, not reverted**: `DB_SSL` stays
a separate boolean rather than folding into the existing `ENV === 'prod'` gate the
Decision specified. Reasoning: whether a given DB target enforces TLS is a property of
that connection target, not of the deployment stage — a `dev`-environment developer
testing against a TLS-required RDS instance, or a `prod` deployment against a
non-TLS target, are both real possibilities under `ENV`-only gating. The Decision's
objection to a second gating variable was specifically about `NODE_ENV` being
*unvalidated* and *inconsistent with the project's existing convention*; `DB_SSL` is
Joi-validated and does not have that defect. `DB_SSL_CA` itself matches the Decision's
env-var name exactly.

**Prevention note for future sessions**: this addendum exists because the original fix
was written without first checking `docs/ADR/` for prior decisions on the exact
question being solved. Before adding TLS/certificate-handling code anywhere in this
repo, grep `docs/ADR/` for `TLS`/`SSL`/`certificate` first.
