# Backend API Consumption Contract

The frontend consumes the Upload Board backend (at the repository root, above
this `frontend/` folder) over HTTP. This document is the frozen slice of that
contract the app depends on. When the backend changes it, update this file
**and** the mirrored types in `src/api/` in the same change.

Backend decisions referenced here live in the repo-root `ADR/` (0001, 0010,
0011, 0012, 0021, 0023, 0024) — this file restates only what a client must obey.

## Base URL & transport

- Dev: calls are same-origin via the Vite proxy (`vite.config.ts` forwards
  `/auth`, `/file`, `/user`, `/upload`, `/post`, `/comment` to
  `http://localhost:3000`; `/file` and `/post` are regex-anchored there so the
  proxy's prefix match doesn't also swallow the client routes `/files` and
  `/posts/:id`). `VITE_API_BASE` stays empty.
- Prod: set `VITE_API_BASE` to the real backend origin; the backend must allow
  that origin via its `CORS_ORIGIN` env (backend ADR 0008).
- **Every** request sends `credentials: 'include'` so the httpOnly refresh
  cookie rides along. This is centralized in `src/api/client.ts`.

## Authentication (backend ADR 0001 + ADR 0012)

### Access vs refresh token

| Token | Where it lives | Sent as |
|---|---|---|
| Access | **in-memory only** (`src/api/authStore.ts`) — never localStorage | `Authorization: Bearer <token>` |
| Refresh | **httpOnly cookie** `refreshToken` (JS cannot read it) | automatic (browser), only to `/auth/token/*` |

The access token is memory-only on purpose: a page reload drops it and the app
silently re-refreshes from the cookie on mount (`AuthProvider`). This means an
XSS payload cannot exfiltrate a persistable credential.

### Endpoints

| Call | Request | Response |
|---|---|---|
| `POST /auth/register` | `Authorization: Basic base64(email:password)` | `201` user (no session) |
| `POST /auth/signin` | `Authorization: Basic base64(email:password)` | `{ accessToken }` + `Set-Cookie: refreshToken` |
| `POST /auth/token/refresh` | refresh cookie (automatic) | `{ accessToken }` + rotated cookie |
| `POST /auth/signout` | `Authorization: Bearer <access>` | `{ success: true }` + cookie cleared |

**Basic header format** (assembled in `src/api/client.ts`, never in components):

```ts
`Authorization: Basic ${btoa(`${email}:${password}`)}`
```

#### Why Base64 / `btoa()`

1. HTTP Header는 원래 ASCII 문자만 안전하게 전달하도록 설계되었다.
2. 따라서 바이너리 데이터나 ASCII 범위를 벗어나는 데이터를 그대로 Header에
   넣을 수 없다.
3. 이 문제를 해결하기 위해 Base64 인코딩을 사용하여 데이터를 ASCII 문자열로
   변환한다.
4. Base64는 데이터를 암호화하는 것이 아니라, 전송 가능한 ASCII 문자열로
   표현하는 인코딩 방식이다.
5. Basic Authentication은 `username:password` 문자열을 Base64로 인코딩한 뒤
   `Authorization: Basic <Base64>` 형식의 Header에 담아 전송한다.
6. JavaScript에서는 브라우저 환경의 `btoa()`와 `atob()`가 Base64
   인코딩·디코딩을 제공하지만, 이는 여러 구현 방법 중 하나일 뿐이며 환경마다
   사용하는 API는 다를 수 있다.

인코딩은 보안이 아니므로 기밀성은 HTTPS가 담당한다.

### Rotation & reuse

Each `/auth/token/refresh` rotates the cookie. Replaying an **old** (rotated-out)
refresh cookie makes the backend invalidate the whole session and return `401`
with `code: AUTH_REFRESH_REUSED`. The client treats any refresh failure as
"session over" → drop the access token → route to `/login`.

One session per account (backend anchors a single hash): a new sign-in
elsewhere logs this one out on its next refresh.

## Error contract (backend ADR 0011)

Every error is the frozen `ErrorBody` shape:

```json
{ "statusCode": 400, "code": "FILE_TITLE_TAKEN", "message": "…", "timestamp": "…", "path": "…" }
```

- **Branch on `code`** (stable, mirrored in `src/api/errorCodes.ts`), never on
  `message` (human-readable, free to change).
- Validation failures use `code: VALIDATION_FAILED` with a `message` **array**.
- `ApiError` (`src/api/client.ts`) carries `status` and `code` for UI branching.

## Resource routes (canonical, frozen — backend ADR 0010)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/file?take=&skip=&search=&sortBy=&order=&creatorId=` | tuple `[rows, total]`; hides non-public rows from non-owner/admin (ADR 0026 D7) |
| — | — | `take` 1–100 (default 20), `skip` ≥0 (default 0), `search` ≤100 chars (title ILIKE, blank = absent), `sortBy` one of `createdAt`\|`title`\|`id` (default `createdAt`), `order` `ASC`\|`DESC` (default `DESC`), `creatorId` a positive integer — any other value is `400 VALIDATION_FAILED` (ADR 0021, backend `GetFilesDto`) |
| `GET` | `/file/:id` | metadata + creator; 404 for a hidden file (existence hidden, ADR 0026 D8) |
| `GET` | `/file/:id/content?share=` | the **only** path serving bytes — access-gated by visibility (ADR 0025/0026); Range-aware |
| `POST` | `/file` | promote a temp upload to permanent (new rows default `visibility: private`) |
| `PATCH` | `/file/:id` | creator/admin; toggles visibility + rotates share token here |
| `DELETE` | `/file/:id` | creator/admin; 409 `FILE_IN_USE` if a post references it |
| `POST` | `/upload/attach` | multipart — exactly one of `image`/`audio`/`video`, 100 MB (ADR 0027) |
| `GET` | `/user`, `/user/:id` | |
| `PATCH`/`DELETE` | `/user/:id` | self/admin |
| `GET` | `/post?take=&skip=&search=&sortBy=&order=&creatorId=` | tuple `[rows, total]`; same query shape as `/file` (ADR 0021 read layer reused), `sortBy` one of `createdAt`\|`title`\|`id` |
| `GET` | `/post/:id` | post + creator + attached `file` (`FileResponseDto`, absent for a text-only post); 404 `POST_NOT_FOUND` |
| `POST` | `/post` | `{ title, body, fileId? }`; `fileId` must be the requester's own file, unclaimed by another post — identical resubmit for the same `fileId` replays `200`, a differing title/body is `409 POST_FILE_TAKEN` (ADR 0023 D1) |
| `PATCH` | `/post/:id` | `{ title?, body? }` only — creator/admin; `fileId` is not editable, an attachment is fixed at creation (ADR 0023 D1) |
| `DELETE` | `/post/:id` | creator/admin; takes its comments with it (the schema's only `ON DELETE CASCADE`, ADR 0023 D3) but leaves the attached file row untouched |
| `GET` | `/post/:postId/comment?take=&skip=` | tuple `[rows, total]`; order is **fixed** `createdAt` ASC (a thread reads oldest-first) — no `sortBy`/`order` params exist here |
| `POST` | `/post/:postId/comment` | `{ body }` (≤1,000 chars); no idempotency key — an identical resubmit creates a second comment (ADR 0023 D1) |
| `PATCH` | `/comment/:id` | `{ body? }` — creator/admin; the post's own author gains no extra power over a comment they didn't write |
| `DELETE` | `/comment/:id` | creator/admin |

Uploading is two-phase: `POST /upload/attach` (multipart — exactly one of the
type-specific fields `image` jpg/jpeg/png/webp · `audio` mp3 · `video` mp4/mov/webm,
sent via `api.postForm` so the browser sets the boundary `Content-Type`) returns
`{ filename }`; attaching more than one field is `400 UPLOAD_MULTIPLE_FIELDS`. Then
`POST /file` `{ title, filePath: filename }` promotes it (backend `temp_`→`granted_`),
returning `201` (fresh) or `200` (idempotent replay of the same claim, ADR 0019).

`fileUrl` in responses is the **access-controlled** content endpoint
`/file/:id/content`, NOT a static/public path (ADR 0025/0026): a `public` file streams
without a token, `private` needs the creator/admin bearer, `unlisted` needs a matching
`?share=<token>`. New files default to `private`. `shareUrl` is returned only to a
manager of an unlisted file.

`FileResponseDto` also carries `mediaType` (`image`\|`audio`\|`video`, ADR 0040) —
server-derived from the upload's extension, never client-supplied. Use it to pick a
playback tag; do not infer media type from `fileUrl`'s extension or from which
`POST /upload/attach` field was used.

A comment's `postId` in its response is the bare id, never an embedded post — a
20-comment thread would otherwise repeat the same post body and file on every
row. Comment routes span two prefixes: listing/creating hang off the post
(`/post/:postId/comment`), while editing/deleting address a comment by its own
id (`/comment/:id`) — there is deliberately no `GET /comment/:id`.

### DELETE responses are plain text, not JSON

Every `DELETE` route in this API (`/file/:id`, `/user/:id`, `/post/:id`, `/comment/:id`)
resolves its handler to a bare string (e.g. `"File 12 deleted."`), which Nest sends as a
`200 text/html` body — there is no `ErrorBody`-shaped or JSON success payload to parse.
`src/api/client.ts`'s `request()` handles this centrally: it only calls `response.json()`
when the response's `Content-Type` says so, otherwise resolving `undefined`. This was
found the hard way — an earlier version called `response.json()` unconditionally on every
non-204 2xx response, which threw a `SyntaxError` on every successful delete and made
`FileDetailPage`'s delete look like a network failure even though the backend had already
deleted the row. Do not add a caller that expects a parsed body from `api.delete()`.

