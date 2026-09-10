// 목적: 이 앱이 사용하는 백엔드 REST 계약의 요청/응답 DTO 타입.
// 사용처: API 클라이언트와 각 기능 모듈이 타입 있는 호출을 위해 임포트한다.
// 근거: 아직 공유 패키지가 없어 백엔드 계약 중 실제로 쓰는 부분만 직접 손으로 선언해 둔 것 —
//   codegen이 생기기 전까지 백엔드 DTO/ResponseDto와 동기화 상태를 유지해야 한다.

// POST /auth/signin, /auth/token/refresh 의 응답 본문
export interface AccessTokenResponse {
  accessToken: string
}

// GET /user, GET /user/:id — password/refreshTokenHash는 서버에서 제거된 상태로 온다.
export interface User {
  id: number
  email: string
  createdAt: string
  updatedAt: string
}

// 파일의 접근 수준(백엔드 FileVisibility enum, ADR 0025 D1). 새로 생성되는 행은 기본값이
// `private`이며, 소유자/관리자이거나 공유 토큰이 없으면 `public`만 읽을 수 있다.
export type FileVisibility = 'public' | 'private' | 'unlisted'

// 콘텐츠를 어떤 재생 태그로 다룰지(백엔드 FileMediaType enum, ADR 0040) — 업로드 확장자에서
// 서버가 판단한 값이며 클라이언트가 지정하는 값이 아니다.
export type FileMediaType = 'image' | 'audio' | 'video'

// GET /file, GET /file/:id — FileResponseDto. `creator`는 백엔드가 relation을 조인했을 때만
// (목록+상세) 존재한다. `fileUrl`은 접근 제어가 걸린 콘텐츠 엔드포인트(`/file/:id/content`,
// ADR 0025/0026)이지 정적 경로가 아니다 — 읽을 때 `visibility`를 그대로 따른다. `shareUrl`은
// unlisted 파일의 관리자(매니저)에게만 나타난다(ADR 0025 D3). `pendingTransferTo`(ADR 0050)는
// 이전이 대기 중이고 요청자가 매니저(creator/admin)이거나 대기 중인 대상 본인일 때만 존재한다 —
// 백엔드가 이미 무관한 제3자에게는 숨기므로 프론트가 따로 처리할 필요가 없다.
// GET /file(목록)은 이 필드를 조인하지 않는다 — GET /file/:id만 담아 온다.
export interface FileResponse {
  id: number
  title: string
  fileUrl: string
  visibility: FileVisibility
  mediaType: FileMediaType
  shareUrl?: string
  creator?: {
    id: number
    email: string
  }
  pendingTransferTo?: {
    id: number
    email: string
  }
  createdAt: string
  updatedAt: string
}

// GET /file?take=&skip= — 백엔드는 순수 배열이 아니라 [rows, total] 튜플(getManyAndCount)을
// 반환한다 — `total`이 클라이언트 페이지네이션을 구동한다.
export type FileListResponse = [FileResponse[], number]

// GET /file 쿼리 — 백엔드 GetFilesDto(ADR 0021)를 그대로 반영한다. sortBy/order는 자유
// 문자열이 아니라 화이트리스트(IsIn)이므로, 이 튜플 밖의 값은 400 VALIDATION_FAILED가 된다.
export const FILE_SORT_FIELDS = ['createdAt', 'title', 'id'] as const
export type FileSortField = (typeof FILE_SORT_FIELDS)[number]
export const SORT_ORDERS = ['DESC', 'ASC'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

// POST /upload/attach — POST /file에 넘길, 서버가 생성한 temp_ 파일명을 반환한다.
export interface AttachResponse {
  filename: string
}

// visibility 관리를 위한 PATCH /file/:id 본문(ADR 0025 D1/D3) — 이 앱의 UI가 실제로 보내는
// 필드만 담는다. 백엔드 UpdateFileDto에는 이 앱이 아직 쓰지 않는 필드(title/userId/filePath/
// shareExpiresAt)가 더 있다.
export interface UpdateFileVisibilityRequest {
  visibility?: FileVisibility
  // 공유 토큰을 재발급한다; 결과 visibility가 'unlisted'일 때만 실제로 적용되며
  // (ADR 0025 D3) 이전에 공유된 링크는 전부 무효화된다.
  rotateShareToken?: boolean
}

// GET /post, GET /post/:id — PostResponseDto. `creator`는 백엔드가 relation을 조인했을 때만
// (목록+상세) 존재한다. `file`은 파일이 첨부된 게시글에만 존재하며, BASE_URL/콘텐츠-엔드포인트
// 로직이 한 곳에만 있도록 FileService가 구성한다(ADR 0023).
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

// GET /post?take=&skip=... — 백엔드는 FileListResponse와 동일한 형태로 [rows, total]
// 튜플을 반환한다.
export type PostListResponse = [PostResponse[], number]

// GET /post 쿼리 — 백엔드 GetPostsDto(ADR 0021/0023)를 그대로 반영한다. sortBy/order는
// 자유 문자열이 아니라 화이트리스트(IsIn)이므로, 이 튜플 밖의 값은 400 VALIDATION_FAILED가 된다.
export const POST_SORT_FIELDS = ['createdAt', 'title', 'id'] as const
export type PostSortField = (typeof POST_SORT_FIELDS)[number]

// POST /post 본문 — 백엔드 CreatePostDto(ADR 0023 D1)를 그대로 반영한다. `fileId`는
// 요청자 본인이 만든 파일이면서 다른 게시글이 아직 물고 있지 않은 파일이어야 한다 — 같은
// fileId로 동일하게 재요청하면 200으로 replay되고, title/body가 다르면 409 POST_FILE_TAKEN이다.
export interface CreatePostRequest {
  title: string
  body: string
  fileId?: number
}

// GET /post/:postId/comment, PATCH /comment/:id — CommentResponseDto. `postId`는 게시글을
// 통째로 embed하지 않은 순수 id다 — 그렇지 않으면 댓글 스레드의 모든 행마다 같은 게시글의
// body/file이 반복되기 때문이다.
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

// GET /post/:postId/comment?take=&skip= — [rows, total] 튜플. 스레드 순서는 서버에서
// createdAt ASC로 고정돼 있고(ADR 0023) 이 엔드포인트는 sortBy/order 파라미터를 받지
// 않는다 — 그래서 FileListResponse/PostListResponse와 달리 대응하는 정렬 필드 상수가 없다.
export type CommentListResponse = [CommentResponse[], number]

// PATCH /post/:id 본문 — 백엔드 UpdatePostDto를 그대로 반영한다. fileId는 의도적으로
// 뺐다 — 첨부는 생성 시점에 고정되며 수정으로 옮길 수 없다(ADR 0023 D1).
export interface UpdatePostRequest {
  title?: string
  body?: string
}

// POST /post/:postId/comment 본문 — 백엔드 CreateCommentDto를 그대로 반영한다.
export interface CreateCommentRequest {
  body: string
}

// PATCH /comment/:id 본문 — 백엔드 UpdateCommentDto를 그대로 반영한다. 수정 가능한 필드는 `body`뿐이다.
export interface UpdateCommentRequest {
  body: string
}

// POST /file/:id/transfer 본문 — 백엔드 ProposeFileTransferDto(ADR 0050)를 그대로 반영한다.
// 대상은 숫자 id이며, UI는 이메일을 먼저 GET /user/lookup으로 id로 변환한다.
export interface ProposeFileTransferRequest {
  userId: number
}
