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
6. Before writing code that calls a library or API, at any task scale, check whether
   `frontend/` already calls it. If every API is already used here, write "Minimum
   do-nots: none new" in one line. For an API nothing here calls yet — a new dependency,
   or a new API of an existing one (React, React Router, Vite, Playwright, ...) — read its
   official docs, changelog, or advisories in this session, not from recall, for what is
   removed, deprecated, or unsafe, and report it under a "Minimum do-nots" heading with the
   source, version, and date checked for each item; mark anything unreachable
   "unverified". Same rule as the root CLAUDE.md, Hallucination Prevention #12.

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
  headers. (`POST /auth/signin/local`, the Passport-local alternative, was removed
  from the backend 2026-09-07 — it never had a live caller here.)
- On refresh failure (including `AUTH_REFRESH_REUSED`), the session is over:
  clear the token and route to `/login`.
- **Every refresh goes through `tryRefresh()`** (`client.ts`, single-flight). The backend keeps one
  refresh anchor per account and has no grace window, so a second `POST /auth/token/refresh` that
  carries the cookie the first one just rotated reads as a replay: 401 `AUTH_REFRESH_REUSED`, session
  over. `AuthProvider`'s startup recovery and the 401-retry paths in `client.ts` therefore share one
  in-flight call. Never call `refreshAccessToken()` from a component or an effect — React StrictMode
  runs mount effects twice in `pnpm dev`, which is how a second reload while signed in used to end at
  the login screen (fixed 2026-10-02). The guard is module memory, so it serializes calls within one
  tab only; two tabs refreshing at the same instant are not covered (tried once, both got `201`).

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
- **UI text is bilingual (en/ko)**: every user-visible string goes through `useLanguage().t(key)`
  with an entry in both dictionaries of `src/i18n/messages.ts` — `ko` is a
  `Record<MessageKey, string>`, so a missing translation fails `tsc`. English is the default and
  what the e2e specs assert, so keep an existing English sentence unchanged unless the spec that
  asserts it changes with it. Use singular nouns in English text (Post, File, Setting). An empty
  list says "No post yet." / "No file yet." until a filter is set, and only then "No … matches the
  current filter." (`PostBoard`/`FileBoard`, `e2e/empty-state.spec.ts`). An
  `ApiError` mapper (`messageForError`) returns a `Translatable` (a key, or `{ raw }` for server
  text shown as received) and the component stores that in state and calls `t()` at render, so a
  language switch re-renders an error that is already on screen. The URL paths `/posts/:id` and
  `/files` stay plural on purpose (`/post`, `/file` are API prefixes — see Production image).
- **Page shell**: every authenticated screen's `<main>` takes its box from `src/shared/page.module.css`
  (`.page { composes: page from '../../shared/page.module.css' }`) — never its own width, margin or
  padding. The direct children of `main` (nav header, title, card, list) sit in one 720px column;
  only an element that composes `wide` from the same file (the File preview grid) is wider, and it
  must be a direct child of `main` (which is why `FileBoard` returns a fragment). A page that sets
  its own `margin: auto` inside the flex-column `#root` shrinks to its content, which is what once
  made the header, main and forms differ per screen. `LoginPage` is the one deliberate exception (a
  centered card). `e2e/layout.spec.ts` guards this.
- **Long text wraps**: any box that shows text a user typed (an email, a title, a pasted URL) must be
  able to break an unbroken string — `overflow-wrap: anywhere`, plus `min-width: 0` on a flex child
  that holds it. `white-space: pre-wrap` alone does not break a long URL, and the box then stretches
  the whole page sideways. The nav bar wraps its controls onto a second row instead of clipping them
  at 320px. A `display: grid` list needs `grid-template-columns: minmax(0, 1fr)`: the default `auto`
  column takes its content's min-content, so `nowrap` titles and emails stretched the Post list past
  1400px above 640px. `e2e/overflow.spec.ts` checks every authenticated screen at 320, 375, 667, 768
  and 1366px.
- **Tap targets**: at phone widths (`max-width: 640px`) or with a coarse pointer, every link, button,
  select, input and radio label is at least 40px tall (the size of the 40×40 toggles). Text links
  get `padding-block` rather than `min-height`/`display: flex`, so `text-overflow: ellipsis` and
  wrapping keep working; the browser's grey Choose File button is replaced by a themed
  `::file-selector-button`. Wide mouse layouts stay as they were. `e2e/touch-targets.spec.ts` checks
  all five screens at 375px.
- **Fonts**: `--sans` is Noto Sans KR and `--heading` is Hahmlet (variable, 100–900), for Hangul and
  Latin alike, from `@fontsource-variable/*` imported in `main.tsx` and emitted into `/assets`. Never
  link a CDN (Google Fonts etc.) — the nginx CSP is `font-src 'self'`. The families are named
  `'Noto Sans KR Variable'` and `'Hahmlet Variable'`; the old system stacks stay after them as the
  fallback. `button, input, select, textarea` inherit `font-family` only (never `font`, which would
  grow the 13px controls). A computed `font-family` cannot tell a web font from a silent fallback, so
  `e2e/fonts.spec.ts` reads the platform font the browser actually used.
- **File header comment** (new files only): three lines — 목적 (Purpose) / 사용처
  (Usage) / 근거 (Rationale) — above the imports, matching the existing files.
  (Switched from English labels to Korean 2026-09-09, matching the root
  CLAUDE.md's File Creation Convention.)
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
  `{ exact: true }` on any label/role query whose text is a short common word — the nav
  links and headings are now the single words "Post" and "File", which also substring-match
  "New post", "Upload a file" and any post or file title containing them. `getByLabel` also reads
  `aria-label`: the login form's show/hide button is named "Show password", so the password box is
  `getByLabel('Password', { exact: true })`.
- **A running Vite dev server can serve stale CSS-module copies.** When a file that other CSS Modules
  `composes` (such as `src/shared/page.module.css`) changes, `pnpm dev` keeps old hashed copies, so a
  rule added to it may not reach every page and a spec measures the old layout. Restart the dev server
  (or stop it, so Playwright starts a fresh one) before trusting a CSS-only check.

### UI-only specs stub the API (`frontend/e2e/`)

`layout`, `language`, `fonts`, `empty-state`, `overflow`, `post-body` and `touch-targets` check how the
UI looks and behaves, not what the backend does.
They call `stubAuthenticatedApi(page)` (`e2e/helpers.ts`) instead of `registerAndSignIn`: it answers
the silent refresh with an unsigned token (the client only reads `sub`) and returns fixed data for
the list, detail, comment and content requests. No account is created in the shared dev DB, none of
the 5/minute auth limit (backend ADR 0054) is spent, and the backend does not have to be running
(the dev server still does).

- **Anchor every stub route as a regex that ends at the path** (`/\/post(\?.*)?$/`, as the helper
  does). The client routes `/posts/:id` and `/files` share a prefix with the API's `/post` and
  `/file`, so a loose pattern such as `/\/post/` also matches the page navigations and would answer
  them with JSON.
- **A stub says nothing about the backend contract.** Specs that depend on real responses (`auth`,
  `upload`, `board`, `detail`, `posts`, `navigation`) keep using real accounts. `auth.spec.ts`'s 429
  test stubs only the one response it needs, and its weak-password test hits the real backend.

## Commands

```bash
pnpm dev      # Vite dev server on :5173 (proxies /auth,/file,/user,/upload,/post,/comment → :3000)
pnpm build    # tsc -b type-check + vite production build
pnpm lint     # oxlint
pnpm preview  # serve the production build
```

The dev server needs the backend running on `:3000` for API calls to succeed (the stub-based specs
under "UI-only specs stub the API" are the exception).

### Production image (ADR 0060)

`Dockerfile` builds the SPA and serves it from nginx on `:8080` (`nginx.conf`). Production is
same-origin behind the ALB — `/` goes to this image, the API prefixes go to the backend — so
`VITE_API_BASE` must stay **unset** in the image build: the `Dockerfile` pins it empty and
`.dockerignore` keeps `.env*` out of the build context. Build and try it locally:

```bash
docker build -t sharenpo-frontend:local .   # from frontend/
docker run --rm -p 8080:8080 sharenpo-frontend:local
```

- `nginx.conf` owns the SPA's security headers (helmet covers only API responses). Its CSP allows
  `https://*.amazonaws.com` for images, media, and `fetch` because `STORAGE_DRIVER=s3` redirects
  content reads to S3 — unverified in a browser.
- A new top-level route must not start with an API prefix (`/auth`, `/user`, `/post`, `/comment`,
  `/file`, `/upload`, `/audit-log`) or with `/admin`: the ALB would send it to the backend, or to
  the admin console (ADR 0062). `/posts` and `/files` are fine — the match is by whole path segment.
- `pnpm` is pinned in `frontend/package.json` (`packageManager`) and again inside the `Dockerfile`
  — the Node image's corepack cannot run the latest pnpm; read ADR 0060's implementation
  addendum before changing that.

**Stopping a backgrounded `pnpm dev`/`pnpm preview` does not free its port on Windows.**
`pnpm` runs vite as a child process and Windows has no POSIX process-group signalling, so
killing the task leaves an orphaned `node` holding the socket — the next `--strictPort`
run then fails with a misleading "port in use". Always check `netstat -ano | grep ":<port>"`
after stopping one, and kill the listener by PID if it is still there. Full procedure:
root [CLAUDE.md](../CLAUDE.md) > Commands > "Background servers: kill by port, not by task".
