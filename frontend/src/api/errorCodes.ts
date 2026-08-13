// Purpose: mirrors the backend's frozen ErrorCode catalog + ErrorBody wire shape (backend ADR 0011).
// Usage: imported by the API client to type errors; components branch on `code`, never on `message`.
// Rationale: the backend froze `code` as the machine-readable contract — duplicating it here (until a
//   shared codegen exists) lets UI switch on stable codes instead of parsing human-readable text.

// Keep in sync with the backend `backend/common/error-code.ts`. `code` is the
// contract to branch on; `message` is human-readable and free to change.
export const ErrorCode = {
  // 400
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  AUTH_BAD_TOKEN_FORMAT: 'AUTH_BAD_TOKEN_FORMAT',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  FILE_TITLE_TAKEN: 'FILE_TITLE_TAKEN',
  FILE_INVALID_PATH: 'FILE_INVALID_PATH',
  // An unlisted file's content requested with a missing/wrong/expired share token (ADR 0025).
  FILE_SHARE_INVALID: 'FILE_SHARE_INVALID',
  UPLOAD_FILE_REQUIRED: 'UPLOAD_FILE_REQUIRED',
  UPLOAD_INVALID_TYPE: 'UPLOAD_INVALID_TYPE',
  // More than one of image/audio/video attached to one /upload/attach request (ADR 0025 D5).
  UPLOAD_MULTIPLE_FIELDS: 'UPLOAD_MULTIPLE_FIELDS',
  // Demoting the last remaining superadmin is refused (ADR 0013).
  AUTH_LAST_SUPERADMIN: 'AUTH_LAST_SUPERADMIN',

  // 401
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_REFRESH_REUSED: 'AUTH_REFRESH_REUSED',

  // 403
  FORBIDDEN_NOT_OWNER: 'FORBIDDEN_NOT_OWNER',
  FORBIDDEN: 'FORBIDDEN',

  // 404
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  POST_NOT_FOUND: 'POST_NOT_FOUND',
  COMMENT_NOT_FOUND: 'COMMENT_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',

  // 409
  // A temp upload already promoted by a different user — the one-shot claim is spent (ADR 0019).
  FILE_ALREADY_CLAIMED: 'FILE_ALREADY_CLAIMED',
  // Account still owns files and the delete did not confirm the cascade (ADR 0020).
  USER_HAS_FILES: 'USER_HAS_FILES',
  // Cascade confirmed, but another user's post references one of the account's files (ADR 0024).
  USER_FILES_IN_USE: 'USER_FILES_IN_USE',
  // File already attached to one of the requester's posts, repeat carries different text (ADR 0023 D1).
  POST_FILE_TAKEN: 'POST_FILE_TAKEN',
  // The file is referenced by a post, so its row cannot be deleted (ADR 0023 D4).
  FILE_IN_USE: 'FILE_IN_USE',

  // 413
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // 500
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
