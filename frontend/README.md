# Sharenpo — Frontend

React + Vite (TypeScript) SPA for Sharenpo. Lives as the
`frontend/` subfolder of the project repository (alongside the backend at the
repo root) and consumes the backend REST API over HTTP. There is **no** `/admin`
route in this app — ADR 0010 originally reserved one, but the stub was deleted
2026-08-06 and the operator surface lives in the sibling `admin/` console
instead (backend ROADMAP.md > Stage 5).

## Stack

- **React 19 + Vite** — SPA, no SSR (the backend owns the API)
- **react-router-dom** — routing, including a protected route guard
- **TypeScript** — strict build (`tsc -b`), no `any`
- **oxlint** — linting
- **Noto Sans KR + Hahmlet** (`@fontsource-variable/*`, OFL-1.1, variable 100–900) — the UI
  fonts for Hangul and Latin alike, self-hosted into `/assets` (the nginx CSP is `font-src 'self'`)
- **Playwright** (`@playwright/test`, chromium only) — browser-level E2E, `frontend/e2e/`
  (`auth`/`upload`/`board`/`detail` specs cover register-signin-signout (and a reload keeping the
  session, with exactly one silent refresh per page load), the two-phase
  video upload, the file board's search/sort/pagination/visibility badges, and
  FileDetailPage's access-control branches; `navigation` covers the "/" ⇄ "/files"
  route split, the NavBar, the dev-proxy regex-anchor fix that split depends on, and a
  direct load of `/posts/:id` rendering the real `PostDetailPage`; `posts` covers
  creating a post through PostForm — with and without an attached file — and the
  resulting board row/detail link, landing on the post's own title/body once
  `PostDetailPage` stopped being a placeholder; `language` covers the NavBar en/ko toggle,
  its persistence across a reload, and its size and position next to the theme toggle;
  `layout` checks that every authenticated screen shares one `main` box and one 720px column;
  `fonts` checks that headings and body text are really drawn with the Hahmlet and Noto Sans
  KR web fonts rather than a silent system fallback; `empty-state` checks that an empty list says
  "none yet" until a filter is set; `overflow` checks that no authenticated screen scrolls sideways at
  320, 375, 667, 768 and 1366px with a long email, title or URL, nor do the forms with a text input
  those screens do not open by themselves (sign-in, a chosen upload row, Post edit, ownership
  transfer) at 320 and 375px; `post-body` checks that the Post body and comment
  boxes cannot be resized; `touch-targets` checks that every tappable element is at least 40px tall
  at 375px; those seven stub the API, so they create no account and need no backend — see
  `frontend/CLAUDE.md`)
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
├── i18n/         English/Korean UI text: LanguageProvider (choice saved in localStorage
│                 `ui-lang`, English by default), useLanguage's `t()`, and messages.ts
│                 (the en dictionary plus `ko`, a Record over the same keys — a missing
│                 translation fails `tsc`). Server-sent message text is shown as received
├── shared/       NavBar — the Post/File/Setting links, language and theme toggles, and
│                 Sign out, shown on every authenticated screen; page.module.css — the one
│                 `<main>` box (and 720px column) every authenticated screen composes
└── features/
    ├── auth/     LoginPage (Basic signin/register; a half-transparent eye button at the
    │             right end of the password box shows or hides what was typed)
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
    ├── files/    DashboardPage (protected, "/files" — upload form (several files at once,
                  sent one by one with a progress bar per file) + file board: search/sort/
                  creator filter/pagination + visibility badges, FileBoard.tsx) and
                  FileDetailPage (protected, "/view/:id" — metadata + visibility-gated
                  playback: direct src for public/unlisted, an authenticated
                  blob+objectURL fetch for private, rendered as <img>/<audio>/<video>
                  per the file's mediaType (ADR 0040); for the creator or an admin, a
                  management section — visibility toggle, unlisted share-link copy/
                  rotation, and delete — all via PATCH/DELETE /file/:id)
    └── account/  SettingsPage (protected, "/settings" — not "/user" or "/account", which
                  the dev proxy claims; linked from NavBar). Backend ADR 0020's
                  DELETE /user/:id?deleteFiles= confirmation flow: delete → on 409
                  USER_HAS_FILES show the backend's message (already names the file
                  count) behind a second confirm → retry with deleteFiles=true → on
                  success sign out and redirect to /login
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

`pnpm test:e2e` runs two kinds of specs (see
[CLAUDE.md](CLAUDE.md#ui-only-specs-stub-the-api-frontende2e)). The UI-only ones stub the API and
need only the dev server. `auth`, `upload`, `board`, `detail`, `posts` and `navigation` register
real accounts, and `upload`, `board`, `detail` and `posts` also upload a file through the UI, so
the backend on `:3000` has to be set up for that:

- A reachable Postgres with the migrations applied. The accounts and files these specs create stay
  in that database; nothing truncates it.
- `STORAGE_DRIVER=local`. With `s3` and a bucket that no longer exists, `POST /upload/attach`
  returns 500 (`NoSuchBucket`).
- A reachable ClamAV (`CLAMD_HOST`/`CLAMD_PORT`; the compose `clamav` service locally). Every
  upload is scanned, and an unreachable scanner answers 503 `UPLOAD_SCAN_UNAVAILABLE` (backend ADR
  0059).
- `THROTTLE_ENABLED=false`. Each spec registers and signs in again, which spends the 5/minute auth
  limit (backend ADR 0054) and ends in 429 if the limit is on.
- `BASE_URL` left at its default `http://localhost:3000`. `detail.spec.ts` calls the backend at
  that origin (`BACKEND_BASE_URL`), and pointing `BASE_URL` at `:5173` made two of its tests fail.

CI sets these in the `frontend-e2e` job of `.github/workflows/ci.yml`. For the compose `api`, put
the per-machine values in a gitignored `.env.local`
([ADR 0015](../docs/ADR/0015-docker-and-compose.md) Addendum).
