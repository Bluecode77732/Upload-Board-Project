# Frontend Style Overhaul Plan

Plan for a full visual overhaul of every screen in this app, decided via a
comparison-table Q&A pass on 2026-08-14. This document is the design record
for that work — implementation happens in separate, dispatched sessions (see
"Ready-to-paste prompts" below), each of which should re-read this file first.

**Status (2026-08-14): all 7 page-conversion items complete** — see the
"Page-by-page task list" below for the per-item landing notes and
[ROADMAP.md](../../docs/ROADMAP.md) > 7 for the plan-level record. Two related
items surfaced during the initial walkthrough stay deliberately out of scope
and open — see "Related but out of scope" and "Open questions" below.

## Decisions (confirmed this session)

| Axis | Decision | Why |
|---|---|---|
| Styling mechanism | **CSS Modules** (`*.module.css`, colocated per component) | Zero new dependency — Vite supports `*.module.css` natively, so this doesn't trip frontend/CLAUDE.md's "propose a CSS framework before adding" gate the way Tailwind/styled-components would. Keeps scoped, plain-CSS authoring; drops the current inline-`style={{}}` convention. |
| Visual direction | Brand-forward, with an explicit light/dark toggle | User choice; goes beyond the current OS-only `prefers-color-scheme` split in `index.css`. |
| Palette source | Proposed by this session, **confirmed 2026-08-14** (below) | No existing brand asset (logo, style guide) in this repo to derive from. |
| Scope | All 5 route pages + the shared `NavBar` | User choice — no page deferred to a later pass. |
| Document location | `frontend/docs/STYLE-PLAN.md` (+ `.ko.md`) | User choice. |

## Investigation summary (current state)

Every screen currently styles itself with inline `style={{...}}` objects —
there is no CSS Modules/Tailwind/styled-components usage anywhere in
`frontend/src`. `index.css` already defines a small CSS-custom-property token
set (`--text`, `--text-h`, `--bg`, `--border`, `--accent`, `--shadow`, …) with
a `@media (prefers-color-scheme: dark)` override block — this is the seed the
new token system should extend, not replace.

| Page (route) | File(s) | Lines | Notes |
|---|---|---|---|
| Sign in / Register (`/login`) | `features/auth/LoginPage.tsx` | 96 | Simple centered card form. |
| Post board (`/`, home) | `features/posts/PostBoard.tsx`, `PostForm.tsx`, `FilePicker.tsx` | 210 + 84 + 109 | New-post form, search/sort/paginate list. |
| Post detail (`/posts/:id`) | `features/posts/PostDetailPage.tsx`, `CommentThread.tsx`, `CommentForm.tsx` | 294 + 209 + 65 | Inline edit/delete, embedded file playback, comment thread. |
| File board (`/files`) | `features/files/DashboardPage.tsx`, `FileBoard.tsx`, `UploadForm.tsx` | 24 + 200 + 147 | Upload form, search/sort/paginate list. |
| File detail (`/view/:id`) | `features/files/FileDetailPage.tsx`, `VisibilityBadge.tsx` | 276 + 31 | Video/audio/image playback, visibility + share-token management. |
| Shared nav | `shared/NavBar.tsx` | 40 | Rendered on every authenticated screen. |

Total: ~1,785 lines across 13 files touch some form of inline styling.

## Brand palette (confirmed 2026-08-14)

`index.css` already seeds an accent purple (`#aa3bff` light / `#c084fc`
dark). **Confirmed: kept as the brand color** (lowest-risk — it's already
live and the video/file/post-management "creative tooling" feel suits
purple) and built out into a fuller token system rather than replaced with
an unrelated hue.

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--brand` | `#8a2be2` | `#c084fc` | primary buttons, active nav link, links |
| `--brand-hover` | `#7422c9` | `#d4a6fd` | hover/active state of the above |
| `--brand-contrast` | `#ffffff` | `#1b0e2e` | text/icon color drawn on `--brand` |
| `--surface` | `#ffffff` | `#16171d` | page background |
| `--surface-raised` | `#f8f7fb` | `#1f2028` | cards, form panels, table rows |
| `--border` | `#e5e4e7` | `#2e303a` | dividers, input/card borders |
| `--text` | `#3f3a46` | `#c8c6d0` | body text |
| `--text-muted` | `#6b6375` | `#9ca3af` | secondary/meta text (emails, timestamps) |
| `--text-heading` | `#08060d` | `#f3f4f6` | h1/h2 |
| `--success` | `#1a7f37` | `#3fb950` | e.g. "replayed"/upload-complete states |
| `--danger` | `#c92a2a` | `#f87171` | delete buttons, error text |
| `--danger-bg` | `#fdecec` | `#3b1b1b` | error banners |

This table **replaces and extends** `index.css`'s current token block; it
doesn't sit alongside it.

## Dark/light mode toggle (design sketch)

Current state: `index.css` follows `prefers-color-scheme` only — no
in-app toggle, no persistence. To add an explicit switch:

- A `data-theme="light" | "dark"` attribute on `<html>`, defaulting to unset
  (falls through to `prefers-color-scheme`, same as today).
- `:root[data-theme="dark"] { ... }` overrides mirroring the existing
  `@media (prefers-color-scheme: dark)` block — same token values, just
  re-triggerable without an OS change.
- A small `ThemeProvider` (`src/theme/`, new folder) holding the current
  choice in React state, mirrored to `localStorage` (`ui-theme`) so a reload
  keeps the user's explicit pick; falls back to `prefers-color-scheme` when
  nothing is stored.
- A toggle control added to `NavBar`.

This is a new small abstraction (a context provider) — flagged here per
Scope Discipline, but it's what "다크/라이트 모드 구현" (explicit toggle, not
just OS-level) requires; no separate confirmation needed since the user
already asked for the toggle specifically.

## Page-by-page task list

| # | Page/component | Work |
|---|---|---|
| 1 | ~~Token foundation~~ | **Done 2026-08-14** (see CHANGELOG.md). Replaced `index.css`'s token block with the palette above; added `ThemeProvider` + `data-theme` CSS; no visual change to page layouts other than NavBar (verified live). |
| 2 | ~~`NavBar`~~ | **Done 2026-08-14**, bundled with item 1 (see CHANGELOG.md). Converted to CSS Module; added the theme toggle control. |
| 3 | ~~`LoginPage`~~ | **Done 2026-08-14** (see CHANGELOG.md). Converted to CSS Module; restyled the card, inputs, mode-switch link. |
| 4 | ~~`FileBoard` + `DashboardPage` + `UploadForm`~~ | **Done 2026-08-14**, bundled with item 3 (see CHANGELOG.md). Converted to CSS Modules; restyled upload form, filter bar, file list rows, pagination. |
| 5 | ~~`FileDetailPage` + `VisibilityBadge`~~ | **Done 2026-08-14** (see CHANGELOG.md). Converted to CSS Modules; restyled header/player/share-link/Manage panel; fixed the title-wrap overlap bug at its root cause (see below). |
| 6 | ~~`PostBoard` + `PostForm` + `FilePicker`~~ | **Done 2026-08-14** (see CHANGELOG.md). Converted to CSS Modules; restyled new-post form, file-attach picker, post list rows, pagination — same filters/list/pagination shapes as item 4's `FileBoard`, plus a page-wrapper class since `PostBoard` (unlike `DashboardPage`) hosts the NavBar/heading/form/list in one file. |
| 7 | ~~`PostDetailPage` + `CommentThread` + `CommentForm`~~ | **Done 2026-08-14** (see CHANGELOG.md). Converted to CSS Modules; restyled post header, edit/delete controls, comment thread (list, inline edit/delete) and the comment form — last of the 5 pages. Korean hardcoded UI text left untouched (separate i18n decision, see below). Also removed `PostDetailPage.tsx`'s now-redundant inline `lineHeight: 1.25` `<h1>` override, flagged by item 5 as ready to delete once this item converted the file. |

Suggested dispatch order matches the numbering (foundation first, since every
later page depends on the token set existing).

## Resolved during this work

- **File detail title overlap** — **fixed 2026-08-14** as part of item 5. Root
  cause confirmed: the global `h1` rule (`index.css`) sets `font-size: 56px`
  but never its own `line-height`, so it inherited `:root`'s `line-height: 145%`
  computed against the *root* font-size (18px ≈ 26px) — far smaller than 56px
  glyphs, so a wrapped title's lines overlapped. Fixed with an explicit
  `line-height: 118%` on the global `h1` rule itself (matching `h2`'s existing
  ratio), not a per-page override — this is the root-cause fix the diagnosis
  below anticipated. **Discovered while fixing this**: `PostDetailPage.tsx`
  hit the identical bug when its detail page shipped and worked around it with
  a scoped inline `lineHeight: 1.25` on that one `<h1>` (see CHANGELOG.md's
  post-detail entry) — that inline override was redundant (the global rule
  covers it) but was deliberately left alone at the time, since `PostDetailPage`
  was item 7's file, not item 5's. **Removed 2026-08-14** when item 7 converted
  that page to CSS Modules.

## Related but out of scope (surfaced during the 2026-08-14 UI/UX pass)

Not part of this styling work unless separately requested — noted here only
because whoever touches these files for restyling will see them:

- **S3 CORS on video playback**: `GET /file/:id/content` redirects to a
  presigned S3 URL (backend ADR 0036) that the browser can't fetch — the
  bucket has no CORS policy allowing the frontend origin. This is an AWS
  bucket configuration issue, not frontend or backend source code — separate
  task, separate owner. **Root-caused 2026-08-15**: this is specifically the
  `FileDetailPage.tsx` private-tier blob-fetch path (`requestBlob()` in
  `src/api/client.ts`) hitting the redirect's cross-origin body read — not a
  separate defect from the `pnpm test:e2e` failure at `detail.spec.ts:73`.
  Full trace and two undecided candidate fixes: ADR 0036 > "Addendum
  (2026-08-15)". **Both candidate fixes landed 2026-08-16**: bucket CORS
  configured (private-tier playback verified working live via Playwright),
  and `detail.spec.ts:73`'s stale redirect-leg assertion fixed the same day —
  nothing from this finding remains open. See ADR 0036 > "Addendum
  (2026-08-16)".
- **Korean/English UI-text split**: `features/posts/*` (PostForm, PostDetailPage,
  CommentThread, CommentForm) hardcodes Korean UI strings and error messages;
  `features/auth/*` and `features/files/*` are English-only. Not an i18n
  framework decision to make silently inside a styling pass — separate task.

## Open questions

1. ~~Confirm the proposed palette~~ — **confirmed 2026-08-14**, kept the
   existing purple brand seed. Item 1 is clear to dispatch.
2. Confirm whether the two remaining "related but out of scope" items above
   should be picked up later as their own tasks, or intentionally left alone.

## Ready-to-paste prompts

See `frontend/CLAUDE.md`-governed dispatch prompts recorded in this
session's memory (`session-prompts.md`, "Ready-to-paste: frontend style
overhaul") — each prompt re-reads this document first so a fresh session has
the full decision trail without re-deriving it.
