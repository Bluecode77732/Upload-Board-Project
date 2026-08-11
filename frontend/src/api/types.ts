// Purpose: request/response DTO types for the backend REST contract this app consumes.
// Usage: imported by the API client and feature modules for typed calls.
// Rationale: no shared package exists yet, so the consumed slice of the backend contract is
//   declared here by hand; keep in sync with the backend DTOs/ResponseDtos until codegen exists.

// POST /auth/signin, /auth/token/refresh, /auth/signin/local → body
export interface AccessTokenResponse {
  accessToken: string
}

// GET /user, GET /user/:id — password/refreshTokenHash are stripped server-side.
export interface User {
  id: number
  email: string
  createdAt: string
  updatedAt: string
}

// A file's access level (backend FileVisibility enum, ADR 0025 D1). New rows default
// to `private`; only `public` is readable without the owner/admin or a share token.
export type FileVisibility = 'public' | 'private' | 'unlisted'

// GET /file, GET /file/:id — FileResponseDto. `creator` is present when the backend
// joins the relation (list + detail). `fileUrl` is the access-controlled content
// endpoint (`/file/:id/content`, ADR 0025/0026), NOT a static path — reading it obeys
// `visibility`. `shareUrl` appears only for a manager of an unlisted file (ADR 0025 D3).
export interface FileResponse {
  id: number
  title: string
  fileUrl: string
  visibility: FileVisibility
  shareUrl?: string
  creator?: {
    id: number
    email: string
  }
  createdAt: string
  updatedAt: string
}

// GET /file?take=&skip= — the backend returns a [rows, total] tuple (getManyAndCount),
// not a bare array; `total` drives client pagination.
export type FileListResponse = [FileResponse[], number]

// GET /file query — mirrors backend GetFilesDto (ADR 0021). sortBy/order are a
// whitelist (IsIn), not free strings: a value outside these tuples is 400 VALIDATION_FAILED.
export const FILE_SORT_FIELDS = ['createdAt', 'title', 'id'] as const
export type FileSortField = (typeof FILE_SORT_FIELDS)[number]
export const SORT_ORDERS = ['DESC', 'ASC'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

// POST /upload/attach — returns the server-generated temp_ filename to hand to POST /file.
export interface AttachResponse {
  filename: string
}

// PATCH /file/:id body for visibility management (ADR 0025 D1/D3) — only the fields this
// app's UI sends; the backend's UpdateFileDto has more fields (title/userId/filePath/
// shareExpiresAt) this app does not use yet.
export interface UpdateFileVisibilityRequest {
  visibility?: FileVisibility
  // Regenerates the share token; only takes effect when the resulting visibility is
  // 'unlisted' (ADR 0025 D3) — invalidates every previously shared link.
  rotateShareToken?: boolean
}

// GET /post, GET /post/:id — PostResponseDto. `creator` is present when the backend joins
// the relation (list + detail). `file` is present only for a post with an attached file,
// composed by FileService so the BASE_URL/content-endpoint logic has one home (ADR 0023).
export interface PostResponse {
  id: number
  title: string
  body: string
  creator?: {
    id: number
    email: string
  }
  file?: FileResponse
  createdAt: string
  updatedAt: string
}

// GET /post?take=&skip=... — the backend returns a [rows, total] tuple, same shape as
// FileListResponse.
export type PostListResponse = [PostResponse[], number]

// GET /post query — mirrors backend GetPostsDto (ADR 0021/0023). sortBy/order are a
// whitelist (IsIn), not free strings: a value outside these tuples is 400 VALIDATION_FAILED.
export const POST_SORT_FIELDS = ['createdAt', 'title', 'id'] as const
export type PostSortField = (typeof POST_SORT_FIELDS)[number]

// POST /post body — mirrors backend CreatePostDto (ADR 0023 D1). `fileId` must be a file
// the requester created and that no other post already holds; an identical resubmit for
// the same fileId replays 200, a differing title/body 409s POST_FILE_TAKEN.
export interface CreatePostRequest {
  title: string
  body: string
  fileId?: number
}

// GET /post/:postId/comment, PATCH /comment/:id — CommentResponseDto. `postId` is the bare
// id, never an embedded post — a thread of comments would otherwise repeat the same post
// body/file on every row.
export interface CommentResponse {
  id: number
  body: string
  creator?: {
    id: number
    email: string
  }
  postId: number
  createdAt: string
  updatedAt: string
}

// GET /post/:postId/comment?take=&skip= — [rows, total] tuple. The thread order is fixed
// at createdAt ASC server-side (ADR 0023) — this endpoint takes no sortBy/order params, so
// unlike FileListResponse/PostListResponse there is no corresponding sort-field constant.
export type CommentListResponse = [CommentResponse[], number]

// PATCH /post/:id body — mirrors backend UpdatePostDto. fileId is deliberately absent:
// the attachment is fixed at creation and cannot be moved by an edit (ADR 0023 D1).
export interface UpdatePostRequest {
  title?: string
  body?: string
}

// POST /post/:postId/comment body — mirrors backend CreateCommentDto.
export interface CreateCommentRequest {
  body: string
}

// PATCH /comment/:id body — mirrors backend UpdateCommentDto. Only `body` is editable.
export interface UpdateCommentRequest {
  body: string
}
