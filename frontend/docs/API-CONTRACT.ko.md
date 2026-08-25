# 백엔드 API 소비 계약

프론트엔드는 (이 `frontend/` 폴더 위, 저장소 루트에 있는) Sharenpo
백엔드를 HTTP로 소비한다. 이 문서는 앱이 의존하는 계약 중 고정된(frozen)
부분을 담는다. 백엔드가 계약을 바꾸면 이 문서와 `src/api/`의 미러 타입을
**같은 변경**에서 함께 갱신한다.

여기서 참조하는 백엔드 결정 사항은 저장소 루트의 `ADR/`(0001, 0010,
0011, 0012, 0021, 0023, 0024)에 있다 — 이 문서는 클라이언트가 지켜야 할 부분만 다시 정리한다.

## Base URL과 전송

- 개발: Vite 프록시를 통해 동일 출처로 호출한다 (`vite.config.ts`가
  `/auth`, `/file`, `/user`, `/upload`, `/post`, `/comment`를
  `http://localhost:3000`으로 전달한다. `/file`과 `/post`는 정규식으로
  앵커링돼 있는데, 프록시의 prefix 매칭이 클라이언트 라우트인 `/files`,
  `/posts/:id`까지 함께 삼켜버리지 않도록 하기 위해서다). `VITE_API_BASE`는
  비워 둔다.
- 프로덕션: `VITE_API_BASE`를 실제 백엔드 origin으로 설정한다. 백엔드는
  `CORS_ORIGIN` env로 그 origin을 허용해야 한다(백엔드 ADR 0008).
- **모든** 요청은 `credentials: 'include'`를 보내 httpOnly 리프레시
  쿠키가 함께 실린다. 이는 `src/api/client.ts`에 중앙화되어 있다.

## 인증 (백엔드 ADR 0001 + ADR 0012)

### 액세스 토큰 vs 리프레시 토큰

| 토큰 | 보관 위치 | 전송 방식 |
|---|---|---|
| Access | **메모리에만** (`src/api/authStore.ts`) — localStorage 사용 안 함 | `Authorization: Bearer <token>` |
| Refresh | **httpOnly 쿠키** `refreshToken` (JS로 읽을 수 없음) | 자동(브라우저), `/auth/token/*`에만 |

액세스 토큰을 메모리에만 두는 것은 의도된 설계다: 페이지를 새로고침하면
토큰이 사라지고, 앱은 마운트 시 쿠키로부터 조용히 다시 리프레시한다
(`AuthProvider`). 이는 XSS 공격이 영속화 가능한 자격 증명을 유출할 수
없게 만든다.

### 엔드포인트

| 호출 | 요청 | 응답 |
|---|---|---|
| `POST /auth/register` | `Authorization: Basic base64(email:password)` | `201` user (세션 없음) |
| `POST /auth/signin` | `Authorization: Basic base64(email:password)` | `{ accessToken }` + `Set-Cookie: refreshToken` |
| `POST /auth/token/refresh` | refresh 쿠키 (자동) | `{ accessToken }` + 회전된 쿠키 |
| `POST /auth/signout` | `Authorization: Bearer <access>` | `{ success: true }` + 쿠키 삭제 |

**Basic 헤더 형식** (`src/api/client.ts`에서만 조립하며, 컴포넌트에서는 절대 만들지 않는다):

```ts
`Authorization: Basic ${btoa(`${email}:${password}`)}`
```

#### 왜 Base64 / `btoa()`인가

1. HTTP Header는 원래 ASCII 문자만 안전하게 전달하도록 설계되었다.
2. 따라서 바이너리 데이터나 ASCII 범위를 벗어나는 데이터를 그대로 Header에
   넣을 수 없다.
3. 이 문제를 해결하기 위해 Base64 인코딩을 사용하여 데이터를 ASCII 문자열로
   변환한다.
4. Base64는 데이터를 암호화하는 것이 아니라, 전송 가능한 ASCII 문자열로
   표현하는 인코딩 방식이다.
5. Basic Authentication은 `username:password` 문자열을 Base64로 인코딩한 뒤
   `Authorization: Basic <Base64>` 형식의 Header에 담아 전송한다.
6. JavaScript에서는 브라우저 환경의 `btoa()`와 `atob()`가 Base64
   인코딩·디코딩을 제공하지만, 이는 여러 구현 방법 중 하나일 뿐이며 환경마다
   사용하는 API는 다를 수 있다.

인코딩은 보안이 아니므로 기밀성은 HTTPS가 담당한다.

### 회전과 재사용

`/auth/token/refresh`를 호출할 때마다 쿠키가 회전한다. 이미 회전되어
무효화된(rotated-out) **예전** 리프레시 쿠키를 다시 사용하면 백엔드는
전체 세션을 무효화하고 `code: AUTH_REFRESH_REUSED`와 함께 `401`을
반환한다. 클라이언트는 어떤 리프레시 실패든 "세션 종료"로 취급한다 →
액세스 토큰을 버린다 → `/login`으로 이동한다.

계정당 세션은 하나다(백엔드가 해시 하나만 앵커로 둔다): 다른 곳에서 새로
로그인하면 다음 리프레시 시점에 이 세션은 로그아웃된다.

## 에러 계약 (백엔드 ADR 0011)

모든 에러는 고정된 `ErrorBody` 형태를 따른다:

```json
{ "statusCode": 400, "code": "FILE_TITLE_TAKEN", "message": "…", "timestamp": "…", "path": "…" }
```

- **`code`로 분기한다** (안정적이며 `src/api/errorCodes.ts`에 미러링됨),
  `message`(사람이 읽기 위한 것으로 자유롭게 바뀔 수 있음)로는 절대 분기하지 않는다.
- 검증 실패는 `code: VALIDATION_FAILED`와 배열 형태의 `message`를 사용한다.
- `ApiError`(`src/api/client.ts`)는 UI 분기를 위해 `status`와 `code`를 갖고 있다.

## 리소스 라우트 (정식, 고정 — 백엔드 ADR 0010)

| 메서드 | 경로 | 비고 |
|---|---|---|
| `GET` | `/file?take=&skip=&search=&sortBy=&order=&creatorId=` | `[rows, total]` 튜플; 소유자·admin이 아니면 public이 아닌 행은 숨김 (ADR 0026 D7) |
| — | — | `take` 1–100 (기본값 20), `skip` ≥0 (기본값 0), `search` ≤100자 (제목 ILIKE, 공백이면 없는 것으로 취급), `sortBy`는 `createdAt`\|`title`\|`id` 중 하나 (기본값 `createdAt`), `order`는 `ASC`\|`DESC` (기본값 `DESC`), `creatorId`는 양의 정수 — 그 외 값은 모두 `400 VALIDATION_FAILED` (ADR 0021, 백엔드 `GetFilesDto`) |
| `GET` | `/file/:id` | 메타데이터 + creator; 숨겨진 파일은 404 (존재 자체를 숨김, ADR 0026 D8) |
| `GET` | `/file/:id/content?share=` | 실제 바이트를 서빙하는 **유일한** 경로 — visibility로 접근을 게이트함 (ADR 0025/0026); Range 지원 |
| `POST` | `/file` | temp 업로드를 정식 파일로 승격 (새 행은 기본값 `visibility: private`) |
| `PATCH` | `/file/:id` | creator/admin; 여기서 visibility 토글 + 공유 토큰 회전 |
| `DELETE` | `/file/:id` | creator/admin; 게시글이 참조 중이면 409 `FILE_IN_USE` |
| `POST` | `/upload/attach` | multipart — `image`/`audio`/`video` 중 정확히 하나, 100MB (ADR 0027) |
| `GET` | `/user`, `/user/:id` | |
| `PATCH`/`DELETE` | `/user/:id` | self/admin |
| `GET` | `/post?take=&skip=&search=&sortBy=&order=&creatorId=` | `[rows, total]` 튜플; `/file`과 같은 쿼리 형태(ADR 0021 read layer 재사용), `sortBy`는 `createdAt`\|`title`\|`id` 중 하나 |
| `GET` | `/post/:id` | 게시글 + creator + 첨부된 `file`(`FileResponseDto`, 텍스트만 있는 글이면 없음); 없으면 404 `POST_NOT_FOUND` |
| `POST` | `/post` | `{ title, body, fileId? }`; `fileId`는 요청자 본인의 파일이면서 다른 게시글이 아직 점유하지 않은 것이어야 한다 — 같은 `fileId`로 동일하게 재요청하면 `200`으로 재생(replay)되고, title/body가 다르면 `409 POST_FILE_TAKEN` (ADR 0023 D1) |
| `PATCH` | `/post/:id` | `{ title?, body? }`만 — creator/admin; `fileId`는 수정 대상이 아니다. 첨부는 생성 시점에 고정된다 (ADR 0023 D1) |
| `DELETE` | `/post/:id` | creator/admin; 댓글까지 함께 지워지지만(이 스키마의 유일한 `ON DELETE CASCADE`, ADR 0023 D3) 첨부된 파일 행은 그대로 남는다 |
| `GET` | `/post/:postId/comment?take=&skip=` | `[rows, total]` 튜플; 정렬은 `createdAt` 오름차순으로 **고정**(스레드는 오래된 순으로 읽힌다) — 여기엔 `sortBy`/`order` 파라미터가 아예 없다 |
| `POST` | `/post/:postId/comment` | `{ body }`(≤1,000자); 멱등성 키가 없어 동일하게 재요청하면 댓글이 하나 더 생긴다 (ADR 0023 D1) |
| `PATCH` | `/comment/:id` | `{ body? }` — creator/admin; 그 댓글이 달린 게시글의 작성자라 해도 자신이 쓰지 않은 댓글에 대해서는 별도 권한을 갖지 않는다 |
| `DELETE` | `/comment/:id` | creator/admin |

업로드는 2단계다: `POST /upload/attach`(multipart — 타입별 필드 중 정확히
하나, `image` jpg/jpeg/png/webp · `audio` mp3 · `video` mp4/mov/webm를
`api.postForm`으로 전송해 브라우저가 boundary `Content-Type`을 직접
설정하게 한다)는 `{ filename }`을 반환한다; 두 개 이상의 필드를 첨부하면
`400 UPLOAD_MULTIPLE_FIELDS`다. 그다음 `POST /file`에
`{ title, filePath: filename }`을 보내 승격한다(백엔드에서
`temp_`→`granted_`), 응답은 `201`(신규) 또는 `200`(같은 claim의 멱등
재생, ADR 0019)이다.

응답의 `fileUrl`은 **접근이 제어되는** 콘텐츠 엔드포인트
`/file/:id/content`이며, 정적/공개 경로가 아니다(ADR 0025/0026): `public`
파일은 토큰 없이 스트리밍되고, `private`은 creator/admin의 bearer가
필요하며, `unlisted`는 일치하는 `?share=<token>`이 필요하다. 새 파일은
기본값으로 `private`이다. `shareUrl`은 unlisted 파일을 관리할 수 있는
사람에게만 반환된다.

`FileResponseDto`는 `mediaType`(`image`\|`audio`\|`video`, ADR 0040)도
가지고 있다 — 업로드된 파일의 확장자로부터 서버가 판정한 값이며,
클라이언트가 보내는 값이 아니다. 재생 태그를 고를 때는 이 값을 쓰고,
`fileUrl`의 확장자나 `POST /upload/attach`에서 어느 필드를 썼는지로
추론하지 않는다.

댓글 응답의 `postId`는 순수한 id 값일 뿐, 게시글 전체를 담아 보내지
않는다 — 그렇지 않으면 댓글 20개짜리 스레드가 같은 게시글 본문과 파일을
행마다 반복해서 실어 보내게 된다. 댓글 라우트는 두 prefix로 나뉜다:
목록 조회/작성은 게시글에 걸려 있고(`/post/:postId/comment`), 수정/삭제는
댓글 자신의 id로 주소를 지정한다(`/comment/:id`) — `GET /comment/:id`는
의도적으로 존재하지 않는다.

### DELETE 응답은 JSON이 아니라 순수 텍스트다

이 API의 모든 `DELETE` 라우트(`/file/:id`, `/user/:id`, `/post/:id`,
`/comment/:id`)는 핸들러가 그냥 문자열을 반환하며(예: `"File 12 deleted."`),
Nest는 이를 `200 text/html` 본문으로 내려보낸다 — 파싱할 `ErrorBody` 형태나
JSON 성공 페이로드가 애초에 없다. `src/api/client.ts`의 `request()`가 이를
중앙에서 처리한다: 응답의 `Content-Type`이 JSON일 때만 `response.json()`을
호출하고, 그 외에는 `undefined`를 반환한다. 이는 실제로 겪고 나서 알게 된
문제였다 — 이전 버전은 204가 아닌 모든 2xx 응답에 무조건 `response.json()`을
호출했는데, 이 때문에 성공한 삭제마다 `SyntaxError`가 나서 `FileDetailPage`의
삭제가 실제로는 백엔드에서 행이 이미 지워졌는데도 네트워크 오류처럼 보였다.
`api.delete()`의 반환값에서 파싱된 본문을 기대하는 호출부를 새로 추가하지
말 것.
