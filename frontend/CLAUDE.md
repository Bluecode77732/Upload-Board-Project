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

## Conventions

- **Structure**: `src/api/` (transport), `src/auth/` (session state/guards),
  `src/features/<domain>/` (screens). New screens go in a feature folder.
- **Fast-refresh**: a file that exports a component must not also export a
  context object or hook — keep context/provider/hook in separate files (see
  `src/auth/`).
- **File header comment** (new files only): three lines — Purpose / Usage /
  Rationale — above the imports, matching the existing files.
- **Admin**: `/admin` is a route section inside this app (backend ADR 0010),
  a stub until backend RBAC lands — it must not imply elevated access yet.
- **TypeScript**: no `any`; the build runs `tsc -b` with `noUnusedLocals`/
  `noUnusedParameters` — keep it green.

## Commands

```bash
pnpm dev      # Vite dev server on :5173 (proxies /auth,/file,/user,/upload → :3000)
pnpm build    # tsc -b type-check + vite production build
pnpm lint     # oxlint
pnpm preview  # serve the production build
```

The dev server needs the backend running on `:3000` for API calls to succeed.
