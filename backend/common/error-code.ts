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
  POST_NOT_FOUND = 'POST_NOT_FOUND',
  COMMENT_NOT_FOUND = 'COMMENT_NOT_FOUND',
  NOT_FOUND = 'NOT_FOUND',

  // 409
  // The referenced temp upload was already promoted by a different user — the
  // one-shot claim token is spent (ADR 0019).
  FILE_ALREADY_CLAIMED = 'FILE_ALREADY_CLAIMED',
  // The account still owns files, and the request did not confirm the cascade —
  // deleting it would irreversibly destroy those files too (ADR 0020).
  USER_HAS_FILES = 'USER_HAS_FILES',
  // The cascade is confirmed, but another user's post references one of the account's
  // files, so the file rows cannot go. Raised from the FK violation itself, since
  // FileService cannot query post_entity without a module cycle (ADR 0024).
  USER_FILES_IN_USE = 'USER_FILES_IN_USE',
  // The file is already attached to one of the requester's posts, and the repeated
  // submission carries different text — so it is a new post, not a retry (ADR 0023 D1).
  POST_FILE_TAKEN = 'POST_FILE_TAKEN',
  // The file is referenced by a post, so its row cannot be deleted. Raised from the
  // FK violation itself rather than a pre-check, which would race (ADR 0023 D4).
  FILE_IN_USE = 'FILE_IN_USE',

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
