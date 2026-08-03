# Upload Board — Frontend

React + Vite (TypeScript) SPA for the Upload Board project. Lives as the
`frontend/` subfolder of the project repository (alongside the backend at the
repo root) and consumes the backend REST API over HTTP; admin lives here as an
`/admin` route section (backend ADR 0010).

## Stack

- **React 19 + Vite** — SPA, no SSR (the backend owns the API)
- **react-router-dom** — routing, including a protected route guard
- **TypeScript** — strict build (`tsc -b`), no `any`
- **oxlint** — linting
- Plain `fetch` wrapper (`src/api/client.ts`) — no data-fetching or state library yet

## Quick start

```bash
pnpm install
cp .env.example .env        # VITE_API_BASE stays empty in dev (Vite proxy)
pnpm dev                    # http://localhost:5173
```

The dev server proxies `/auth`, `/file`, `/user`, `/upload` to the backend on
`http://localhost:3000`, so the app is same-origin in dev and the httpOnly
refresh cookie works without CORS. **Start the backend first** (its repo:
`pnpm run start:dev`).

## Structure

```
src/
├── api/          transport: client (fetch wrapper), authStore (in-memory access token),
│                 errorCodes + types (mirror of the backend contract)
├── auth/         session state: AuthProvider (silent refresh), useAuth, RequireAuth guard
└── features/
    ├── auth/     LoginPage (Basic signin/register)
    ├── files/    DashboardPage (protected — upload form + file board: search/sort/
    │             creator filter/pagination + visibility badges, FileBoard.tsx)
    └── admin/    AdminPage (/admin stub, awaits backend RBAC)
```

## Auth model (backend ADR 0012)

- Access token: **in memory only** (never localStorage) — a reload silently
  re-refreshes from the cookie.
- Refresh token: **httpOnly cookie**, rotated on every refresh; reuse of a
  rotated-out token ends the session.
- Sign-in: `POST /auth/signin` with a Basic header (assembled in `client.ts`).

See [docs/API-CONTRACT.md](docs/API-CONTRACT.md) for the full consumed contract
and [CLAUDE.md](CLAUDE.md) for development conventions.

## Commands

```bash
pnpm dev        # dev server (:5173)
pnpm build      # type-check + production build
pnpm lint       # oxlint
pnpm preview    # serve the built app
```
