# CLAUDE.md — Frontend

Operating contract for AI-assisted development in this directory. These
instructions override default behavior. This is the **frontend** of the Upload
Board project — a `frontend/` subfolder inside the same repository as the
backend (backend `ADR/0010`); it consumes the backend over HTTP. This file
governs work under `frontend/`; the repo-root `CLAUDE.md` governs the backend.

## Hallucination Prevention

Before any change:
1. Inspect the actual code — read the file, trace the call chain, grep for
   symbols. Never invent components, hooks, props, or API fields you have not
   confirmed exist.
2. The backend contract is authoritative and **frozen** — do not assume routes,
   error codes, or token behavior. Read [docs/API-CONTRACT.md](docs/API-CONTRACT.md)
   and `src/api/`; if something isn't there, it isn't part of the contract. The
   backend lives at the repo root (`../backend`, `../ADR/`) — but never edit backend
   files from a frontend task; that is the root CLAUDE.md's domain.
3. Reuse existing patterns (the `src/api/client.ts` wrapper, `useAuth`, the
   feature-folder layout) rather than introducing new abstractions.
4. Run `pnpm build` (type-check) and `pnpm lint` before claiming success.
5. Show the exact diff, state uncertainties explicitly.

## Scope Discipline

Do not, unless explicitly asked:
- Add a state manager, data-fetching library, UI kit, or CSS framework — the
  app uses plain React + the fetch wrapper. Propose, with rationale, before adding.
- Add a dependency without checking license (MIT/Apache-2/BSD preferred) and
  running `pnpm audit`.
- Restructure routing or the api/ layer as a "cleanup".
- Persist the access token to `localStorage`/`sessionStorage` — it is
  **memory-only by design** (see Auth below). This is a security invariant, not
  a preference.

High-blast-radius — require explicit approval: `src/api/client.ts`,
`src/api/authStore.ts`, `src/auth/AuthProvider.tsx`, `vite.config.ts`.

## Auth Invariants (backend ADR 0012 — do not violate)

- The **access token lives in module memory only** (`src/api/authStore.ts`).
  Never write it to storage; a reload re-establishes the session via the silent
  refresh in `AuthProvider`.
- The **refresh token is an httpOnly cookie** the JS cannot read. Never try to.
  All calls send `credentials: 'include'` (centralized in `client.ts`).
- The **canonical signin path is `POST /auth/signin` (Basic header)**. The
  `btoa` header assembly lives in `client.ts` only — components never build auth
  headers. (`POST /auth/signin/local` exists on the backend but is a removal
  candidate; do not build against it.)
- On refresh failure (including `AUTH_REFRESH_REUSED`), the session is over:
  clear the token and route to `/login`.

## API & Error Handling

- All backend calls go through `src/api/client.ts` (`api.get/post/patch/delete`
  or the auth functions). Do not call `fetch` directly in components.
- Branch on the backend's stable error **`code`** (`src/api/errorCodes.ts`),
  never on the human-readable `message`. `VALIDATION_FAILED` carries a
  `message` array.
- Keep `src/api/errorCodes.ts` and `src/api/types.ts` in sync with the backend
  when its contract changes — update [docs/API-CONTRACT.md](docs/API-CONTRACT.md)
  in the same change.
- Every `DELETE` route in this API returns a plain-text `200` body, not JSON
  (see [docs/API-CONTRACT.md](docs/API-CONTRACT.md#delete-responses-are-plain-text-not-json)).
  `client.ts`'s `request()` handles this centrally (Content-Type-gated JSON parse,
  `undefined` otherwise) — found after it originally crashed every successful
  delete with a `SyntaxError` that surfaced as a generic "Network error". Don't
  add a caller that expects a parsed body from `api.delete()`.

## Conventions

- **Structure**: `src/api/` (transport), `src/auth/` (session state/guards),
  `src/features/<domain>/` (screens). New screens go in a feature folder.
- **Fast-refresh**: a file that exports a component must not also export a
  context object or hook — keep context/provider/hook in separate files (see
  `src/auth/`).
- **File header comment** (new files only): three lines — Purpose / Usage /
  Rationale — above the imports, matching the existing files.
- **Admin**: there is no `/admin` route in this app. ADR 0010 originally reserved one
  as a stub; ADR 0022 imported a standalone Chat Project console to `admin/` instead as
  the operator surface, and once that console's role-management slice was adapted to
  this backend (2026-08-06), the stub route was deleted rather than built out — see
  ROADMAP.md's Stage 5 "resolve the duplicate admin surface" row. Do not re-add an
  `/admin` route here; the operator surface lives in the sibling `admin/` app.
- **TypeScript**: no `any`; the build runs `tsc -b` with `noUnusedLocals`/
  `noUnusedParameters` — keep it green.

### Playwright E2E gotchas (`frontend/e2e/`)

Two failure modes discovered writing `auth`/`upload`/`board.spec.ts` (2026-08-03)
that will resurface in any new spec unless avoided up front:

- **Re-setting the same file input path is a silent no-op.** `locator.setInputFiles(path)`
  called twice in a row with the *identical* path (e.g. re-attaching the same fixture
  after a form reset) does not reliably fire the input's `change` event, so React state
  never updates and the form submits as if no file were chosen. Clear first:
  `await input.setInputFiles([]); await input.setInputFiles(path)`.
- **`getByLabel`/`getByRole` name matching is substring + case-insensitive by default**,
  and this app's generated content can collide with it: a `<select>` nested inside a
  `<label>` exposes its accessible name as the label text concatenated with every
  `<option>` text (`getByLabel('Title')` matched FileBoard's "Sort by" select because
  its options spell out "...title..."), and a test-generated email containing a common
  word can match an unrelated button (`getByRole('button', { name: 'Upload' })` matched
  a creator-filter button whose accessible name was `e2e-upload-...@example.com`). Pass
  `{ exact: true }` on any label/role query whose text is a short common word.

## Commands

```bash
pnpm dev      # Vite dev server on :5173 (proxies /auth,/file,/user,/upload → :3000)
pnpm build    # tsc -b type-check + vite production build
pnpm lint     # oxlint
pnpm preview  # serve the production build
```

The dev server needs the backend running on `:3000` for API calls to succeed.
