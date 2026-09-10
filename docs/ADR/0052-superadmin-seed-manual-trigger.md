# ADR 0052: Superadmin Seed Becomes a Manual Trigger

- Status: Accepted — implemented
- Date: 2026-09-09
- Amends: [ADR 0013](0013-rbac-and-audit-log.md)
- 한국어: [0052-superadmin-seed-manual-trigger.ko.md](0052-superadmin-seed-manual-trigger.ko.md)

## Context

[ADR 0013](0013-rbac-and-audit-log.md)'s "First superadmin via env seed" bullet shipped
`SuperadminSeedService.onApplicationBootstrap()` (`backend/user/superadmin-seed.service.ts`):
on every boot, if `SUPERADMIN_EMAIL` is set and the matching account exists and is not
already `superadmin`, it is promoted unconditionally. ADR 0013 accepted this specifically to
avoid new infrastructure and a manual SQL step.

A 2026-09-09 security review found the gap that trade-off left open: the service verifies
only that an account with that email *exists* — never that the registrant is the intended
owner. Registration (`POST /auth/register`) is open to anyone. If an attacker registers
`SUPERADMIN_EMAIL` before the legitimate owner does — most plausibly in the window between a
fresh deploy (env var already set) and the owner's first sign-up — the next boot promotes the
attacker's account to `superadmin`, with no verification step of any kind.

Three resolutions were weighed against this project's actual constraints (no live users yet,
no SMTP infrastructure — confirmed absent from `package.json` and `.env.example`):

1. Gate promotion on "zero superadmins currently exist" — rejected. At the moment of the
   original race (fresh deploy, before the owner's first registration), the superadmin count
   is already zero, so this gate does not close the race it was proposed to close. It only
   helps a narrower, less likely scenario (re-registration of the email after the original
   superadmin account is deleted).
2. Add email verification before promotion — rejected for now. This project has no mail-
   sending infrastructure at all; standing one up (SMTP account, new dependency, schema
   change for a verification token, new endpoints, new env vars) is a real feature addition,
   not a scoped fix, and is disproportionate to the project's current stage.
3. Remove automatic promotion; require a deliberate manual step — **chosen**.

## Decision

### D1 — Remove `SuperadminSeedService`, promote via an explicit script instead

`backend/user/superadmin-seed.service.ts` and its `UserModule` registration are deleted.
Promotion is now `pnpm promote-superadmin` — a standalone script
(`backend/scripts/promote-superadmin.ts`) that an operator runs by hand, only when they have
confirmed the account belongs to the intended owner. This does not add automated identity
verification; it replaces an *unconditional automatic trust* with a *deliberate human
decision made at the moment of promotion* — the operator is the verification step.

### D2 — `SUPERADMIN_EMAIL` stays as the script's input, not removed

The env var's Joi schema entry (`backend/app.module.ts`, unchanged — optional, no default)
and `.env.example` documentation stay. The script reads `SUPERADMIN_EMAIL` the same way
`backend/data-source.ts` already reads DB connection vars outside the Nest DI container
(that file's `process.loadEnvFile()` side effect fires on import, since the script imports
its default-exported `DataSource`). This was chosen over requiring an explicit CLI argument
because the security property being fixed is *whether promotion happens automatically*, not
*where the target email is configured* — keeping the env var avoids a second edit to
`app.module.ts` (a high-blast-radius file under Scope Discipline) for no additional security
benefit, and keeps the local/CI/Helm configuration story unchanged.

### D3 — Reuse `backend/data-source.ts`'s `DataSource`, not a second `process.env` exception

CLAUDE.md's Config section names `backend/data-source.ts` as the *sole* sanctioned place
outside `ConfigService` that reads `process.env` directly, and says not to add a second
exception. `promote-superadmin.ts` imports that file's default-exported `DataSource`
(`initialize()` → single `UserRepository.update()` → `destroy()` in `finally`) instead of
reading `process.env` itself, so no second exception is created.

## Consequences

- **The identity-verification gap is closed for the steady-state deploy story**: no account
  is ever promoted without a human explicitly running the script and confirming ownership at
  that moment. The underlying trust model is unchanged for the *operator* (they are still
  trusted to run it correctly) — this ADR does not add cryptographic or email-based identity
  proof, and does not claim to.
- **`SuperadminSeedService` and its (nonexistent) spec file are gone.** No entity/schema
  change — `UserEntity.role` and its default (`'user'`) are untouched.
- **A new operational step exists**: standing up a fresh environment now requires the
  operator to register the intended superadmin account, then run
  `pnpm promote-superadmin`. This is documented in README.md/CLAUDE.md's Commands section
  and mirrors the already-accepted "one-time manual step in a runbook" pattern this project
  uses elsewhere (e.g. the `SecretStore`/`ExternalSecret` manual `kubectl apply` step in
  `k8s/infra/terraform/README.md`).
- **`admin/e2e/seed-superadmin.mjs` is unaffected in behavior** — it already promotes its
  test account via a direct `pg` upsert, independent of `SuperadminSeedService`. Its header
  comment, which cited the now-deleted service as "the real creation mechanism," is corrected
  to cite this ADR and the new script instead.
- **Email verification and the "zero-superadmin gate" remain open, unscheduled options** if
  this project ever carries real, adversarial-facing traffic (ROADMAP.md > Unscheduled) —
  this ADR does not foreclose them, it only declines them for the project's current stage.

### Addendum (2026-09-10) — `pnpm promote-superadmin` verified against an isolated throwaway DB

`pnpm build`/`pnpm lint:ci`/`pnpm test` (263/263) only prove the change compiles and
doesn't regress existing services — none of them exercise the script's own DB round trip,
since it sits outside the Nest DI container the same way `data-source.ts` does. Following
the isolation lesson from a prior incident (see CLAUDE.md > "Live-testing a sweep/reclaim
service"), this was verified against a disposable database on the same local Postgres
container the dev DB lives in, never the dev DB (`postgres`) itself:

1. `docker exec` created `sharenpo_promote_verify` (drop-if-exists + create, mirroring
   `test/e2e-utils.ts`'s throwaway-DB pattern).
2. `DB_DATABASE=sharenpo_promote_verify pnpm migration:run` built its schema through the
   real migration chain — not `synchronize`.
3. A test user was inserted directly, then four scenarios were run against the compiled
   `dist/scripts/promote-superadmin.js`, each read back via `psql`:
   - a `user`-role account → promoted to `superadmin` (confirmed in the DB)
   - re-run against the same, now-`superadmin` account → `"already superadmin — nothing
     to do."`, exit 0 (no-op, not a duplicate write)
   - `SUPERADMIN_EMAIL` pointed at an email with no account → clear error, exit 1
   - `SUPERADMIN_EMAIL` unset → clear error, exit 1
4. The throwaway database was dropped, and the dev database was confirmed to still hold
   zero rows for the test email — the isolation held.

**Still not automatically tested**: this script has no Jest spec (the same position
`data-source.ts` is already in — outside `coveragePathIgnorePatterns`, but genuinely
untestable with the mock-repository convention this project's coverage measures, since its
entire job is a real DB round trip). Coverage will show it as untested; that is the accepted
trade-off `data-source.ts` already set precedent for, not a new gap this addendum is
introducing.
