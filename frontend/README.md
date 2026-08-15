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
- **Playwright** (`@playwright/test`, chromium only) — browser-level E2E, `frontend/e2e/`
  (`auth`/`upload`/`board`/`detail` specs cover register-signin-signout, the two-phase
  video upload, the file board's search/sort/pagination/visibility badges, and
  FileDetailPage's access-control branches; `navigation` covers the "/" ⇄ "/files"
  route split, the NavBar, the dev-proxy regex-anchor fix that split depends on, and a
  direct load of `/posts/:id` rendering the real `PostDetailPage`; `posts` covers
  creating a post through PostForm — with and without an attached file — and the
  resulting board row/detail link, landing on the post's own title/body once
  `PostDetailPage` stopped being a placeholder)
- Plain `fetch` wrapper (`src/api/client.ts`) — no data-fetching or state library yet
  (plus an `XMLHttpRequest` path in the same file for upload-progress reporting,
  since `fetch` exposes no upload-progress event)

## Quick start

```bash
pnpm install
cp .env.example .env        # VITE_API_BASE stays empty in dev (Vite proxy)
pnpm dev                    # http://localhost:5173
```

The dev server proxies `/auth`, `/file`, `/user`, `/upload`, `/post`, `/comment`
to the backend on `http://localhost:3000` (`/file` and `/post` are regex-anchored
in `vite.config.ts` so the proxy's prefix match doesn't also swallow the client
routes `/files` and `/posts/:id`), so the app is same-origin in dev and the
httpOnly refresh cookie works without CORS. **Start the backend first** (its
repo: `pnpm run start:dev`).

## Structure

```
src/
├── api/          transport: client (fetch wrapper), authStore (in-memory access token),
│                 errorCodes + types (mirror of the backend contract, now including
│                 PostResponse/CommentResponse)
├── auth/         session state: AuthProvider (silent refresh), useAuth, RequireAuth guard
├── shared/       NavBar — the Posts/My Files/Sign out header shown on every
│                 authenticated screen
└── features/
    ├── auth/     LoginPage (Basic signin/register)
    ├── posts/    PostBoard (protected, "/" — the app's home: PostForm + the post list —
    │             search/sort/creator filter/pagination mirroring FileBoard, attachment
    │             icon per row, ADR 0021/0023), PostForm (title/body + an optional
    │             FilePicker-selected file, POST /post — a 200 replay and a 201 fresh
    │             post are handled identically), and FilePicker (searches the signed-in
    │             user's own files via GET /file?creatorId=; the server alone enforces
    │             the unclaimed invariant via 409 POST_FILE_TAKEN). PostDetailPage
    │             (protected, "/posts/:id" — loads GET /post/:id; renders the attached
    │             file, if any, via the same visibility-gated pattern FileDetailPage uses;
    │             inline title/body edit and delete for the creator/admin, PATCH/DELETE
    │             /post/:id), CommentThread (GET /post/:id/comment, thread order fixed at
    │             createdAt ASC server-side so paging is an appending "load more" button,
    │             not a prev/next pager; inline edit/delete per comment for that comment's
    │             own author/admin, PATCH/DELETE /comment/:id), and CommentForm (POST
    │             /post/:id/comment, triggers a refetch on success — no realtime/polling
    │             infrastructure exists in this app)
    └── files/    DashboardPage (protected, "/files" — upload form (image/audio/video,
                  with upload-progress bar) + file board: search/sort/
                  creator filter/pagination + visibility badges, FileBoard.tsx) and
                  FileDetailPage (protected, "/view/:id" — metadata + visibility-gated
                  playback: direct src for public/unlisted, an authenticated
                  blob+objectURL fetch for private, rendered as <img>/<audio>/<video>
                  per the file's mediaType (ADR 0040); for the creator or an admin, a
                  management section — visibility toggle, unlisted share-link copy/
                  rotation, and delete — all via PATCH/DELETE /file/:id)
```

There is no `admin/` feature folder or `/admin` route here — the reserved stub was
deleted 2026-08-06 once the sibling `admin/` app (repo root, ADR 0022) was adapted
against the real backend and confirmed as the sole admin surface (ADR 0010's second
amendment note).

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
pnpm test:e2e   # Playwright E2E — needs the backend (+ its DB) reachable on :3000;
                # starts/reuses the :5173 dev server itself (playwright.config.ts)
```
