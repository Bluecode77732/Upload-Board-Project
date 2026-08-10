# Upload Board — 프론트엔드

Upload Board 프로젝트를 위한 React + Vite(TypeScript) SPA. 프로젝트 저장소의
`frontend/` 하위 폴더로 존재하며(리포지토리 루트의 백엔드와 나란히), 백엔드
REST API를 HTTP로 소비한다. 관리자 화면도 이 안에 `/admin` 라우트 섹션으로
들어 있다(백엔드 ADR 0010).

## 스택

- **React 19 + Vite** — SPA, SSR 없음 (API는 백엔드가 담당)
- **react-router-dom** — 라우팅, 보호된 라우트 가드 포함
- **TypeScript** — strict 빌드(`tsc -b`), `any` 사용 안 함
- **oxlint** — 린팅
- **Playwright** (`@playwright/test`, chromium만 설치) — 브라우저 수준 E2E, `frontend/e2e/`
  (`auth`/`upload`/`board`/`detail` 스펙이 회원가입-로그인-로그아웃, 2단계 영상 업로드,
  파일 보드의 검색/정렬/페이지네이션/visibility 배지, FileDetailPage의 접근 제어
  분기를 검증하고, `navigation` 스펙이 "/" ⇄ "/files" 라우트 분리와 NavBar, 그
  분리가 의존하는 dev 프록시 정규식 앵커링 수정을 검증한다; `posts` 스펙은
  PostForm으로 게시글을 작성하는 흐름을 — 파일을 첨부하는 경우와 첨부하지
  않는 경우 모두 — 그리고 그 결과로 보드 행/상세 링크가 반영되는지를 검증한다)
- 순수 `fetch` 래퍼(`src/api/client.ts`) — 데이터 페칭/상태 관리 라이브러리는 아직 없음
  (같은 파일에 업로드 진행률 보고용 `XMLHttpRequest` 경로도 함께 있다 —
  `fetch`는 업로드 진행률 이벤트를 제공하지 않기 때문)

## 빠른 시작

```bash
pnpm install
cp .env.example .env        # 개발 환경에서는 VITE_API_BASE를 비워 둔다 (Vite 프록시)
pnpm dev                    # http://localhost:5173
```

개발 서버는 `/auth`, `/file`, `/user`, `/upload`, `/post`, `/comment`를
`http://localhost:3000`의 백엔드로 프록시한다(`/file`과 `/post`는
`vite.config.ts`에서 정규식으로 앵커링돼 있는데, 프록시의 prefix 매칭이
클라이언트 라우트인 `/files`, `/posts/:id`까지 함께 삼켜버리지 않도록 하기
위해서다). 덕분에 개발 환경에서는 앱이 동일 출처(same-origin)로 동작해
httpOnly 리프레시 쿠키가 CORS 없이 작동한다. **백엔드를 먼저 실행해야 한다**
(해당 저장소에서: `pnpm run start:dev`).

## 구조

```
src/
├── api/          전송 계층: client (fetch 래퍼), authStore (인메모리 액세스 토큰),
│                 errorCodes + types (백엔드 계약의 미러, 이제 PostResponse/
│                 CommentResponse도 포함)
├── auth/         세션 상태: AuthProvider (사일런트 리프레시), useAuth, RequireAuth 가드
├── shared/       NavBar — 인증된 모든 화면에 표시되는 Posts/My Files/Sign out 헤더
└── features/
    ├── auth/     LoginPage (Basic 로그인/회원가입)
    ├── posts/    PostBoard (보호됨, "/" — 앱의 홈: PostForm + 게시글 목록 —
    │             FileBoard를 그대로 본뜬 검색/정렬/작성자 필터/페이지네이션,
    │             행마다 첨부파일 아이콘, ADR 0021/0023), PostForm (title/body +
    │             선택적으로 FilePicker가 고른 파일로 POST /post 호출 — 200
    │             재생(replay)과 201 신규 생성을 동일하게 처리한다), FilePicker
    │             (GET /file?creatorId=로 로그인한 사용자 소유 파일만 검색 —
    │             미첨부 상태 강제는 오직 서버가 409 POST_FILE_TAKEN으로
    │             수행한다). PostDetailPage(보호됨, "/posts/:id")는 아직
    │             자리표시자다 — 게시글 상세와 댓글 스레드가 남은 후속 작업이다
    └── files/    DashboardPage (보호됨, "/files" — 업로드 폼(이미지/오디오/비디오,
                  업로드 진행률 표시줄 포함) + 파일 보드: 검색/정렬/
                  작성자 필터/페이지네이션 + visibility 배지, FileBoard.tsx),
                  FileDetailPage (보호됨, "/view/:id" — 메타데이터 + visibility별
                  재생: public/unlisted은 <video src> 직접 재생, private은 인증된
                  blob+objectURL 페치; 작성자 또는 admin에게는 관리 섹션도 노출된다
                  — visibility 전환, unlisted 공유 링크 복사/회전, 삭제를 모두
                  PATCH/DELETE /file/:id로 처리)
```

여기에는 `admin/` 기능 폴더도 `/admin` 라우트도 없다 — 예약해 뒀던 stub은 저장소
루트의 형제 `admin/` 앱(ADR 0022)이 실제 백엔드에 맞게 적응되어 유일한 admin
화면으로 확정된 2026-08-06에 삭제됐다(ADR 0010의 두 번째 개정 노트).

## 인증 모델 (백엔드 ADR 0012)

- 액세스 토큰: **메모리에만 보관** (localStorage에는 절대 저장하지 않음) —
  새로고침하면 쿠키로부터 조용히 다시 리프레시된다.
- 리프레시 토큰: **httpOnly 쿠키**, 리프레시할 때마다 회전(rotate)된다. 이미
  회전되어 무효화된 토큰을 재사용하면 세션이 종료된다.
- 로그인: `POST /auth/signin`에 Basic 헤더로 요청한다 (`client.ts`에서 조립).

전체 소비 계약은 [docs/API-CONTRACT.ko.md](docs/API-CONTRACT.ko.md)를,
개발 컨벤션은 [CLAUDE.md](CLAUDE.md)를 참고한다.

## 명령어

```bash
pnpm dev        # 개발 서버 (:5173)
pnpm build      # 타입 체크 + 프로덕션 빌드
pnpm lint       # oxlint
pnpm preview    # 빌드된 앱 미리보기
pnpm test:e2e   # Playwright E2E — 백엔드(및 그 DB)가 :3000에서 떠 있어야 하며,
                # :5173 개발 서버는 직접 기동하거나 재사용한다 (playwright.config.ts)
```
