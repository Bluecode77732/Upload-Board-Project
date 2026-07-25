// Purpose: the frozen machine-readable error-code catalog and wire shape for API error responses.
// Usage: services/controllers throw HttpExceptions with { code, message }; AllExceptionsFilter emits ErrorBody.
// Rationale: Stage F (ADR 0010) requires stable codes before a frontend hardcodes message strings or status-only branching.

export enum ErrorCode {
  // 400
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  BAD_REQUEST = 'BAD_REQUEST',
  AUTH_BAD_TOKEN_FORMAT = 'AUTH_BAD_TOKEN_FORMAT',
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_TAKEN = 'AUTH_EMAIL_TAKEN',
  FILE_TITLE_TAKEN = 'FILE_TITLE_TAKEN',
  FILE_INVALID_PATH = 'FILE_INVALID_PATH',
  UPLOAD_FILE_REQUIRED = 'UPLOAD_FILE_REQUIRED',
  UPLOAD_INVALID_TYPE = 'UPLOAD_INVALID_TYPE',
  // Refused: demoting the last remaining superadmin would lock the role system (ADR 0013).
  AUTH_LAST_SUPERADMIN = 'AUTH_LAST_SUPERADMIN',

  // 401
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  // A rotated-out refresh token was replayed — the whole session is invalidated (ADR 0012).
  AUTH_REFRESH_REUSED = 'AUTH_REFRESH_REUSED',

  // 403
  FORBIDDEN_NOT_OWNER = 'FORBIDDEN_NOT_OWNER',
  FORBIDDEN = 'FORBIDDEN',

  // 404
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  NOT_FOUND = 'NOT_FOUND',

  // 413
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',

  // 500
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// The frozen wire shape every error response follows (see ADR 0011).
export interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  // Human-readable and free to change; VALIDATION_FAILED keeps the pipe's string[].
  message: string | string[];
  timestamp: string;
  path: string;
  // Present only when ENV=dev.
  stack?: string;
}
