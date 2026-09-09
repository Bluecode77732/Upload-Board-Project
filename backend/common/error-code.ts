// 목적: API 에러 응답에 쓰이는, 고정된 기계 판독용 에러 코드 목록과 wire shape.
// 사용처: 서비스/컨트롤러가 { code, message }로 HttpException을 던지고; AllExceptionsFilter가 ErrorBody를 내보낸다.
// 근거: Stage F(ADR 0010)는 프론트엔드가 메시지 문자열을 하드코딩하거나 상태코드로만 분기하기 전에 안정적인 코드가 필요하다.

export enum ErrorCode {
  // 400
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  BAD_REQUEST = 'BAD_REQUEST',
  AUTH_BAD_TOKEN_FORMAT = 'AUTH_BAD_TOKEN_FORMAT',
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_TAKEN = 'AUTH_EMAIL_TAKEN',
  FILE_TITLE_TAKEN = 'FILE_TITLE_TAKEN',
  FILE_INVALID_PATH = 'FILE_INVALID_PATH',
  // unlisted 파일의 콘텐츠를 요청했는데 share 토큰이 없거나, 틀렸거나, 만료됐다
  // (ADR 0025 D2/D6).
  FILE_SHARE_INVALID = 'FILE_SHARE_INVALID',
  UPLOAD_FILE_REQUIRED = 'UPLOAD_FILE_REQUIRED',
  UPLOAD_INVALID_TYPE = 'UPLOAD_INVALID_TYPE',
  // 같은 POST /upload/attach 요청에 타입별 필드(image/audio/video) 세 개 중
  // 둘 이상이 첨부됐다(ADR 0025 D5).
  UPLOAD_MULTIPLE_FIELDS = 'UPLOAD_MULTIPLE_FIELDS',
  // 거부됨: 마지막 남은 superadmin을 강등시키면 역할 체계 자체가 잠긴다(ADR 0013).
  AUTH_LAST_SUPERADMIN = 'AUTH_LAST_SUPERADMIN',
  // 이전 대상을 파일의 현재 소유자 본인으로 지정한 채 이전이 제안됐다(ADR 0050).
  FILE_TRANSFER_INVALID_TARGET = 'FILE_TRANSFER_INVALID_TARGET',
  // accept/reject/cancel이 호출됐지만 지금 이 파일에는 대기 중인 이전이 없다
  // (ADR 0050 D1) — 애초에 제안된 적이 없거나 이미 처리됐다.
  FILE_NO_PENDING_TRANSFER = 'FILE_NO_PENDING_TRANSFER',

  // 401
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  // 이미 회전으로 무효화된 리프레시 토큰이 재생됐다 — 세션 전체가 무효화된다(ADR 0012).
  AUTH_REFRESH_REUSED = 'AUTH_REFRESH_REUSED',

  // 403
  FORBIDDEN_NOT_OWNER = 'FORBIDDEN_NOT_OWNER',
  FORBIDDEN = 'FORBIDDEN',
  // 파일의 대기 중인 이전 대상이 아닌 다른 사람이 accept/reject를 호출했다 —
  // 동의는 admin이라도 그 유저 본인만 할 수 있다(ADR 0050 D4).
  FORBIDDEN_NOT_TRANSFER_TARGET = 'FORBIDDEN_NOT_TRANSFER_TARGET',

  // 404
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  POST_NOT_FOUND = 'POST_NOT_FOUND',
  COMMENT_NOT_FOUND = 'COMMENT_NOT_FOUND',
  NOT_FOUND = 'NOT_FOUND',

  // 409
  // 참조된 temp 업로드가 이미 다른 유저에 의해 promote됐다 — 일회성
  // 클레임 토큰은 이미 소진됐다(ADR 0019).
  FILE_ALREADY_CLAIMED = 'FILE_ALREADY_CLAIMED',
  // 계정이 아직 파일을 소유하고 있는데 요청에서 캐스케이드를 확인하지 않았다 —
  // 그대로 삭제하면 그 파일들도 되돌릴 수 없이 함께 사라진다(ADR 0020).
  USER_HAS_FILES = 'USER_HAS_FILES',
  // 캐스케이드는 확인됐지만, 다른 유저의 게시글이 이 계정의 파일 중 하나를 참조하고
  // 있어서 그 파일 행은 삭제될 수 없다. FK 위반 자체에서 발생시킨다 — FileService는
  // 모듈 순환 없이 post_entity를 조회할 수 없기 때문이다(ADR 0024).
  USER_FILES_IN_USE = 'USER_FILES_IN_USE',
  // 이 파일은 이미 요청자의 게시글 중 하나에 첨부돼 있는데, 재제출된 내용이 다르다 —
  // 그러므로 재시도가 아니라 새 게시글이다(ADR 0023 D1).
  POST_FILE_TAKEN = 'POST_FILE_TAKEN',
  // 이 파일은 어떤 게시글이 참조하고 있어서 행을 삭제할 수 없다. 사전 검사는
  // 경합이 생기므로, FK 위반 자체에서 발생시킨다(ADR 0023 D4).
  FILE_IN_USE = 'FILE_IN_USE',
  // 이미 대기 중인 이전이 있는데 새로 이전이 제안됐다 — 제안자는 새 대상을
  // 제안하기 전에 먼저 취소해야 하며, 조용히 덮어써지는 일은 없다(ADR 0050 D3).
  FILE_TRANSFER_PENDING = 'FILE_TRANSFER_PENDING',

  // 413
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',

  // 500
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// 모든 에러 응답이 따르는 고정된 wire shape(ADR 0011 참고).
export interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  // 사람이 읽기 위한 것이라 자유롭게 바뀔 수 있다; VALIDATION_FAILED는 파이프의 string[]을 그대로 담는다.
  message: string | string[];
  timestamp: string;
  path: string;
  // ENV=dev일 때만 존재한다.
  stack?: string;
}
