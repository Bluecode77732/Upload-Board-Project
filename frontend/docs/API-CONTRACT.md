# Backend API Consumption Contract

The frontend consumes the Upload Board backend (at the repository root, above
this `frontend/` folder) over HTTP. This document is the frozen slice of that
contract the app depends on. When the backend changes it, update this file
**and** the mirrored types in `src/api/` in the same change.

Backend decisions referenced here live in the repo-root `ADR/` (0001, 0010,
0011, 0012) — this file restates only what a client must obey.

## Base URL & transport

- Dev: calls are same-origin via the Vite proxy (`vite.config.ts` forwards
  `/auth`, `/file`, `/user`, `/upload` to `http://localhost:3000`). `VITE_API_BASE`
  stays empty.
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
| `GET` | `/file?take=&skip=` | paginated (`take` 1–100 default 20) |
| `GET` | `/file/:id` | metadata + creator |
| `POST` | `/file` | promote a temp upload to permanent |
| `PATCH` | `/file/:id` | creator-only |
| `DELETE` | `/file/:id` | creator-only |
| `POST` | `/upload/attach` | multipart field `video`, 100 MB, mp4/mov/webm |
| `GET` | `/user`, `/user/:id` | |
| `PATCH`/`DELETE` | `/user/:id` | self-only |

Uploading is two-phase: `POST /upload/attach` (multipart field `video`, sent via
`api.postForm` so the browser sets the boundary `Content-Type`) returns `{ filename }`,
then `POST /file` `{ title, filePath: filename }` promotes it (backend `temp_`→`granted_`).

Uploaded files are served at public URLs (`fileUrl` in responses) — unauthenticated
until the backend's Stage 4 VOD access-control task. Treat those URLs as public.
