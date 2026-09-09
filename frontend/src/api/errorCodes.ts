// 목적: 백엔드가 고정한 ErrorCode 목록 + ErrorBody 전송 형식을 그대로 반영한다(backend ADR 0011).
// 사용처: API 클라이언트가 에러 타입을 지정할 때 임포트한다; 컴포넌트는 `message`가 아니라 `code`로 분기한다.
// 근거: 백엔드가 `code`를 기계가 읽는 계약으로 고정했다 — 공유 codegen이 생기기 전까지는 여기 그대로
//   복제해 둬야 UI가 사람이 읽는 텍스트를 파싱하지 않고 고정된 code로 분기할 수 있다.

// 백엔드의 `backend/common/error-code.ts`와 동기화 상태를 유지할 것. 분기 기준은
// `code`이고, `message`는 사람이 읽는 텍스트라 자유롭게 바뀔 수 있다.
export const ErrorCode = {
  // 400
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  AUTH_BAD_TOKEN_FORMAT: 'AUTH_BAD_TOKEN_FORMAT',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  FILE_TITLE_TAKEN: 'FILE_TITLE_TAKEN',
  FILE_INVALID_PATH: 'FILE_INVALID_PATH',
  // unlisted 파일의 콘텐츠를 공유 토큰 없이/틀린 토큰으로/만료된 토큰으로 요청한 경우(ADR 0025).
  FILE_SHARE_INVALID: 'FILE_SHARE_INVALID',
  UPLOAD_FILE_REQUIRED: 'UPLOAD_FILE_REQUIRED',
  UPLOAD_INVALID_TYPE: 'UPLOAD_INVALID_TYPE',
  // 하나의 /upload/attach 요청에 image/audio/video 중 둘 이상을 첨부한 경우(ADR 0025 D5).
  UPLOAD_MULTIPLE_FIELDS: 'UPLOAD_MULTIPLE_FIELDS',
  // 마지막 남은 superadmin의 강등은 거절된다(ADR 0013).
  AUTH_LAST_SUPERADMIN: 'AUTH_LAST_SUPERADMIN',
  // 파일 이전을 그 파일의 현재 소유자 본인 앞으로 제안한 경우(ADR 0050).
  FILE_TRANSFER_INVALID_TARGET: 'FILE_TRANSFER_INVALID_TARGET',
  // accept/reject/cancel을 호출했지만 이 파일에 대기 중인 이전이 없는 경우(ADR 0050).
  FILE_NO_PENDING_TRANSFER: 'FILE_NO_PENDING_TRANSFER',

  // 401
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_REFRESH_REUSED: 'AUTH_REFRESH_REUSED',

  // 403
  FORBIDDEN_NOT_OWNER: 'FORBIDDEN_NOT_OWNER',
  FORBIDDEN: 'FORBIDDEN',
  // 파일의 대기 중인 이전 대상이 아닌 사람이 accept/reject를 호출한 경우 — admin이라도
  // 대상을 대신해 응답할 수 없다(ADR 0050 D4).
  FORBIDDEN_NOT_TRANSFER_TARGET: 'FORBIDDEN_NOT_TRANSFER_TARGET',

  // 404
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  POST_NOT_FOUND: 'POST_NOT_FOUND',
  COMMENT_NOT_FOUND: 'COMMENT_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',

  // 409
  // 이미 다른 사용자가 승격시킨 temp 업로드 — 일회성 청구권이 이미 소진됐다(ADR 0019).
  FILE_ALREADY_CLAIMED: 'FILE_ALREADY_CLAIMED',
  // 계정이 아직 파일을 보유 중인데 삭제 요청이 cascade를 확인하지 않은 경우(ADR 0020).
  USER_HAS_FILES: 'USER_HAS_FILES',
  // cascade는 확인됐지만, 다른 사용자의 게시글이 이 계정의 파일 중 하나를 참조 중인 경우(ADR 0024).
  USER_FILES_IN_USE: 'USER_FILES_IN_USE',
  // 파일이 이미 요청자 본인의 다른 게시글에 첨부돼 있고, 재요청 텍스트가 다른 경우(ADR 0023 D1).
  POST_FILE_TAKEN: 'POST_FILE_TAKEN',
  // 게시글이 이 파일을 참조 중이라 행을 삭제할 수 없는 경우(ADR 0023 D4).
  FILE_IN_USE: 'FILE_IN_USE',
  // 이미 대기 중인 이전이 있는 상태에서 새 이전을 제안한 경우 — 먼저 취소해야 하며,
  // 조용히 덮어써지지 않는다(ADR 0050 D3).
  FILE_TRANSFER_PENDING: 'FILE_TRANSFER_PENDING',

  // 413
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // 500
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// 백엔드가 고정한 에러 응답 형식(ADR 0011).
export interface ErrorBody {
  statusCode: number
  code: ErrorCode
  message: string | string[]
  timestamp: string
  path: string
  stack?: string
}
