# 백엔드 API 소비 계약

프론트엔드는 (이 `frontend/` 폴더 위, 저장소 루트에 있는) Upload Board
백엔드를 HTTP로 소비한다. 이 문서는 앱이 의존하는 계약 중 고정된(frozen)
부분을 담는다. 백엔드가 계약을 바꾸면 이 문서와 `src/api/`의 미러 타입을
**같은 변경**에서 함께 갱신한다.

여기서 참조하는 백엔드 결정 사항은 저장소 루트의 `ADR/`(0001, 0010,
0011, 0012)에 있다 — 이 문서는 클라이언트가 지켜야 할 부분만 다시 정리한다.

## Base URL과 전송

- 개발: Vite 프록시를 통해 동일 출처로 호출한다 (`vite.config.ts`가
  `/auth`, `/file`, `/user`, `/upload`를 `http://localhost:3000`으로
  전달한다). `VITE_API_BASE`는 비워 둔다.
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
