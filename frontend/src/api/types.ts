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

// POST /upload/attach — returns the server-generated temp_ filename to hand to POST /file.
export interface AttachResponse {
  filename: string
}
