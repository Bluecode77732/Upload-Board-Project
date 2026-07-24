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

// GET /file, GET /file/:id — FileResponseDto
export interface FileResponse {
  id: number
  title: string
  fileUrl: string
  createdAt: string
  updatedAt: string
}
