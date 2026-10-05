# Sharenpo — 프론트엔드

Sharenpo를 위한 React + Vite(TypeScript) SPA. 프로젝트 저장소의
`frontend/` 하위 폴더로 존재하며(리포지토리 루트의 백엔드와 나란히), 백엔드
REST API를 HTTP로 소비한다. 이 앱에는 `/admin` 라우트가 **없다** — ADR 0010이
처음에 자리를 잡아 뒀지만 그 스텁은 2026-08-06에 삭제됐고, 운영자 화면은 형제
디렉터리인 `admin/` 콘솔이 맡는다(백엔드 ROADMAP.md > Stage 5).

## 스택

- **React 19 + Vite** — SPA, SSR 없음 (API는 백엔드가 담당)
- **react-router-dom** — 라우팅, 보호된 라우트 가드 포함
- **TypeScript** — strict 빌드(`tsc -b`), `any` 사용 안 함
- **oxlint** — 린팅
- **Noto Sans KR + Hahmlet** (`@fontsource-variable/*`, OFL-1.1, 굵기 100–900 가변) — 한글과
  영문 모두에 쓰는 UI 글꼴이며 `/assets`로 자체 호스팅한다(nginx CSP가 `font-src 'self'`다)
- **Playwright** (`@playwright/test`, chromium만 설치) — 브라우저 수준 E2E, `frontend/e2e/`
  (`auth`/`upload`/`board`/`detail` 스펙이 회원가입·로그인·로그아웃(새로고침 뒤에도 세션이 유지되고 페이지를
  불러올 때마다 silent refresh가 정확히 한 번 나가는지까지), 2단계 영상 업로드,
  파일 보드의 검색/정렬/페이지네이션/visibility 배지, FileDetailPage의 접근 제어
  분기를 검증하고, `navigation` 스펙이 "/" ⇄ "/files" 라우트 분리와 NavBar, 그
  분리가 의존하는 dev 프록시 정규식 앵커링 수정, 그리고 `/posts/:id`를 직접 열었을 때
  실제 `PostDetailPage`가 렌더링되는지를 검증한다; `posts` 스펙은 PostForm으로
  게시글을 작성하는 흐름을 — 파일을 첨부하는 경우와 첨부하지 않는 경우 모두 —
  그리고 그 결과로 보드 행/상세 링크가 반영되는지를 검증하며, `PostDetailPage`가
  더 이상 자리표시자가 아니게 되면서 게시글 자신의 title/body에 도착하는지까지
  확인한다; `language` 스펙은 NavBar의 한/영 토글, 새로고침 후 유지, 그리고 테마
  토글 옆에서의 크기와 위치를 검증하고, `layout` 스펙은 인증된 모든 화면이 하나의 `main`
  박스와 720px 칼럼을 쓰는지 검증하며, `fonts` 스펙은 제목과 본문이 조용한 시스템 글꼴
  폴백이 아니라 Hahmlet·Noto Sans KR 웹 폰트로 실제 그려지는지 검증한다; `empty-state` 스펙은 필터를 걸기
  전까지 빈 목록이 "아직 없음"이라고 말하는지, `overflow` 스펙은 긴 이메일·제목·URL이 있어도 인증된 모든
  화면이 320·375·667·768·1366px에서 가로로 스크롤되지 않는지, `post-body` 스펙은 Post 본문 박스와 댓글 박스를 사용자가
  끌어서 키울 수 없는지, `touch-targets` 스펙은 누를 수 있는 모든 요소가 375px에서 세로 40px 이상인지
  검증한다; 이 일곱 스펙은 API를 스텁해서 계정을 만들지 않고 백엔드도 필요 없다 —
  `frontend/CLAUDE.md` 참고)
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
├── auth/         세션 상태: AuthProvider (silent refresh), useAuth, RequireAuth 가드
├── i18n/         영어/한국어 UI 문구: LanguageProvider (선택값은 localStorage
│                 `ui-lang`에 저장, 기본값은 영어), useLanguage의 `t()`, messages.ts
│                 (영어 사전 + 같은 키를 쓰는 Record인 `ko` — 번역이 빠지면 `tsc`가
│                 실패한다). 서버가 보낸 메시지 문구는 받은 그대로 표시한다
├── shared/       NavBar — 인증된 모든 화면에 표시되는 Post/File/Setting 링크,
│                 언어·테마 토글, 로그아웃 헤더; page.module.css — 인증된 모든 화면이
│                 composes하는 하나의 `<main>` 박스(와 720px 칼럼)
└── features/
    ├── auth/     LoginPage (Basic 로그인/회원가입. 비밀번호 입력창 오른쪽 끝의 반투명 눈 버튼으로
    │             입력한 비밀번호를 보거나 가린다)
    ├── posts/    PostBoard (보호됨, "/" — 앱의 홈: PostForm + 게시글 목록 —
    │             FileBoard를 그대로 본뜬 검색/정렬/작성자 필터/페이지네이션,
    │             행마다 첨부파일 아이콘, ADR 0021/0023), PostForm (title/body +
    │             선택적으로 FilePicker가 고른 파일로 POST /post 호출 — 200
    │             재생(replay)과 201 신규 생성을 동일하게 처리한다), FilePicker
    │             (GET /file?creatorId=로 로그인한 사용자 소유 파일만 검색 —
    │             미첨부 상태 강제는 오직 서버가 409 POST_FILE_TAKEN으로
    │             수행한다). PostDetailPage(보호됨, "/posts/:id" — GET /post/:id로
    │             불러오며, 첨부파일이 있으면 FileDetailPage와 동일한 visibility
    │             기반 재생 패턴을 그대로 따른다; 작성자/admin에게는 인라인
    │             제목/본문 수정과 삭제 제공, PATCH/DELETE /post/:id), CommentThread
    │             (GET /post/:id/comment — 스레드 순서는 서버에서 createdAt ASC로
    │             고정되어 있어 페이징이 prev/next가 아니라 이어붙이는 "더 보기"
    │             버튼이다; 각 댓글은 그 댓글의 작성자 본인/admin만 인라인
    │             수정/삭제 가능, PATCH/DELETE /comment/:id), CommentForm(POST
    │             /post/:id/comment — 성공 시 재fetch를 트리거한다, 이 앱에는
    │             실시간/폴링 인프라가 없기 때문)
    ├── files/    DashboardPage (보호됨, "/files" — 업로드 폼(이미지/오디오/비디오,
                  업로드 진행률 표시줄 포함) + 파일 보드: 검색/정렬/
                  작성자 필터/페이지네이션 + visibility 배지, FileBoard.tsx),
                  FileDetailPage (보호됨, "/view/:id" — 메타데이터 + visibility별
                  재생: public/unlisted은 src 직접 재생, private은 인증된
                  blob+objectURL 페치이며, 파일의 mediaType(ADR 0040)에 따라
                  <img>/<audio>/<video>로 렌더링된다; 작성자 또는 admin에게는 관리
                  섹션도 노출된다
                  — visibility 전환, unlisted 공유 링크 복사/회전, 삭제를 모두
                  PATCH/DELETE /file/:id로 처리)
    └── account/  SettingsPage (보호됨, "/settings" — dev 프록시가 선점한 "/user"나
                  "/account"가 아님; NavBar에서 링크). 백엔드 ADR 0020의
                  DELETE /user/:id?deleteFiles= 확인 흐름을 그대로 구현: 삭제 시도 →
                  409 USER_HAS_FILES면 백엔드 메시지(이미 보유 파일 개수 포함)를
                  2차 확인 뒤에 노출 → deleteFiles=true로 재요청 → 성공 시 로그아웃
                  후 /login으로 이동
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
개발 컨벤션은 [CLAUDE.md](CLAUDE.ko.md)를 참고한다.

## 명령어

```bash
pnpm dev        # 개발 서버 (:5173)
pnpm build      # 타입 체크 + 프로덕션 빌드
pnpm lint       # oxlint
pnpm preview    # 빌드된 앱 미리보기
pnpm test:e2e   # Playwright E2E — 백엔드(및 그 DB)가 :3000에서 떠 있어야 하며,
                # :5173 개발 서버는 알아서 기동하거나 재사용한다 (playwright.config.ts)
```

`pnpm test:e2e`는 두 종류의 spec을 돌린다([CLAUDE.md](CLAUDE.ko.md#ui만-검증하는-spec은-api를-스텁한다-frontende2e)
참고). UI만 검증하는 spec은 API를 스텁하므로 dev 서버만 있으면 된다. `auth`, `upload`, `board`,
`detail`, `posts`, `navigation`은 실제 계정을 만들고, 그중 `upload`, `board`, `detail`, `posts`는
UI로 파일도 올리므로 `:3000`의 백엔드가 이를 받을 수 있게 설정돼 있어야 한다:

- 마이그레이션이 적용된, 접속 가능한 Postgres. 이 spec들이 만든 계정과 파일은 그 DB에 그대로
  남는다. 비워 주는 곳은 없다.
- `STORAGE_DRIVER=local`. `s3`인데 버킷이 이미 없으면 `POST /upload/attach`가 500
  (`NoSuchBucket`)을 돌려준다.
- 접속 가능한 ClamAV(`CLAMD_HOST`/`CLAMD_PORT`, 로컬에서는 compose의 `clamav` 서비스).
  업로드는 모두 검사를 거치고, 검사기에 닿지 못하면 503 `UPLOAD_SCAN_UNAVAILABLE`이 나온다(백엔드 ADR
  0059).
- `THROTTLE_ENABLED=false`. spec마다 다시 회원가입하고 로그인하므로 분당 5회 인증 제한(백엔드 ADR
  0054)을 쓰게 되고, 제한이 켜져 있으면 429로 끝난다.
- `BASE_URL`은 기본값 `http://localhost:3000`으로 둔다. `detail.spec.ts`가 그 origin으로 백엔드를
  직접 호출하며(`BACKEND_BASE_URL`), `BASE_URL`을 `:5173`으로 돌리면 그 spec의 테스트 두 개가 실패했다.

CI는 `.github/workflows/ci.yml`의 `frontend-e2e` job에서 이 값들을 설정한다. compose의 `api`는
이 머신에서만 쓰는 값을 gitignore된 `.env.local`에 넣는다
([ADR 0015](../docs/ADR/0015-docker-and-compose.ko.md) Addendum).
