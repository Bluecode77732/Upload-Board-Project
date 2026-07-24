// Purpose: mirrors the backend's frozen ErrorCode catalog + ErrorBody wire shape (backend ADR 0011).
// Usage: imported by the API client to type errors; components branch on `code`, never on `message`.
// Rationale: the backend froze `code` as the machine-readable contract — duplicating it here (until a
//   shared codegen exists) lets UI switch on stable codes instead of parsing human-readable text.

// Keep in sync with the backend `src/common/error-code.ts`. `code` is the
// contract to branch on; `message` is human-readable and free to change.
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  AUTH_BAD_TOKEN_FORMAT: 'AUTH_BAD_TOKEN_FORMAT',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  FILE_TITLE_TAKEN: 'FILE_TITLE_TAKEN',
  FILE_INVALID_PATH: 'FILE_INVALID_PATH',
  UPLOAD_FILE_REQUIRED: 'UPLOAD_FILE_REQUIRED',
  UPLOAD_INVALID_TYPE: 'UPLOAD_INVALID_TYPE',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_REFRESH_REUSED: 'AUTH_REFRESH_REUSED',
  FORBIDDEN_NOT_OWNER: 'FORBIDDEN_NOT_OWNER',
  FORBIDDEN: 'FORBIDDEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// The backend's frozen error response shape (ADR 0011).
export interface ErrorBody {
  statusCode: number
  code: ErrorCode
  message: string | string[]
  timestamp: string
  path: string
  stack?: string
}
