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

// GET /file, GET /file/:id — FileResponseDto. `creator` is present when the
// backend joins the relation (list + detail); `fileUrl` is a public URL (ADR 0010,
// unauthenticated until the backend's Stage 4 VOD access-control task).
export interface FileResponse {
  id: number
  title: string
  fileUrl: string
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
