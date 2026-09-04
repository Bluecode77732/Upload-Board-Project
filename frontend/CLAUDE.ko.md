# CLAUDE.md — 프론트엔드

이 디렉터리에서 AI 지원 개발을 진행할 때 따르는 운영 계약이다. 이 지침은 기본
동작보다 우선한다. 이 저장소는 Upload Board 프로젝트의 **프론트엔드**로, 백엔드와
같은 저장소 안의 `frontend/` 하위 폴더이며(백엔드 `ADR/0010`) 백엔드를 HTTP로
소비한다. 이 파일은 `frontend/` 아래 작업을 관장하고, 저장소 루트의 `CLAUDE.md`는
백엔드를 관장한다.

## 환각 방지

변경 전에 항상:
1. 실제 코드를 검사한다 — 파일을 읽고, 호출 체인을 추적하고, 심볼을 grep한다.
   확인하지 않은 컴포넌트·훅·prop·API 필드를 지어내지 않는다.
2. 백엔드 계약은 권위 있고 **고정**되어 있다 — 라우트·에러 코드·토큰 동작을
   추측하지 않는다. [docs/API-CONTRACT.md](docs/API-CONTRACT.md)와 `src/api/`를
   읽는다; 거기 없으면 계약의 일부가 아니다. 백엔드는 저장소 루트(`../backend`,
   `../ADR/`)에 있지만 — 프론트엔드 작업에서 백엔드 파일을 편집하지 않는다; 그건
   루트 `CLAUDE.md`의 영역이다.
3. 기존 패턴(`src/api/client.ts` 래퍼, `useAuth`, 기능-폴더 레이아웃)을 재사용하고
   새 추상화를 도입하지 않는다.
4. 성공을 주장하기 전에 `pnpm build`(타입 체크)와 `pnpm lint`를 실행한다.
5. 정확한 diff를 보여주고, 불확실한 점은 명시적으로 밝힌다.

## 범위 준수

명시적으로 요청받지 않는 한 하지 않는다:
- 상태 관리자, 데이터 페칭 라이브러리, UI 킷, CSS 프레임워크 추가 — 이 앱은
  일반 React + fetch 래퍼를 쓴다. 추가하려면 근거와 함께 먼저 제안한다.
- 라이선스(MIT/Apache-2/BSD 선호) 확인과 `pnpm audit` 실행 없이 의존성 추가.
- "정리"라는 명목으로 라우팅이나 api/ 레이어를 재구성.
- 액세스 토큰을 `localStorage`/`sessionStorage`에 저장 — 설계상 **메모리에만**
  둔다(아래 인증 참고). 이건 취향이 아니라 보안 불변식이다.

블래스트 반경이 큰 파일 — 명시적 승인 필요: `src/api/client.ts`,
`src/api/authStore.ts`, `src/auth/AuthProvider.tsx`, `vite.config.ts`.

## 인증 불변식 (백엔드 ADR 0012 — 위반 금지)

- **액세스 토큰은 모듈 메모리에만 존재한다**(`src/api/authStore.ts`). 절대
  스토리지에 쓰지 않는다; 새로고침하면 `AuthProvider`의 silent refresh가 세션을
  다시 세운다.
- **리프레시 토큰은 JS가 읽을 수 없는 httpOnly 쿠키다.** 읽으려고 시도하지
  않는다. 모든 호출은 `credentials: 'include'`를 보낸다(`client.ts`에 집중돼
  있다).
- **정식 로그인 경로는 `POST /auth/signin`(Basic 헤더)이다.** `btoa` 헤더
  조립은 `client.ts`에만 있다 — 컴포넌트가 직접 인증 헤더를 만들지 않는다.
  (`POST /auth/signin/local`이 백엔드에 있지만 제거 후보다; 이걸 대상으로
  코드를 만들지 않는다.)
- 리프레시 실패 시(`AUTH_REFRESH_REUSED` 포함) 세션은 끝난 것이다: 토큰을
  지우고 `/login`으로 라우팅한다.

## API 및 에러 처리

- 백엔드 호출은 모두 `src/api/client.ts`(`api.get/post/patch/delete` 또는 인증
  함수)를 거친다. 컴포넌트에서 직접 `fetch`를 호출하지 않는다.
- 사람이 읽는 `message`가 아니라 백엔드의 안정적인 **`code`**
  (`src/api/errorCodes.ts`)로 분기한다. `VALIDATION_FAILED`는 `message` 배열을
  가진다.
- 백엔드 계약이 바뀌면 `src/api/errorCodes.ts`와 `src/api/types.ts`를 함께
  맞춘다 — 같은 변경에서 [docs/API-CONTRACT.md](docs/API-CONTRACT.md)도
  갱신한다.
- 이 API의 모든 `DELETE` 라우트는 JSON이 아니라 순수 텍스트 `200` 본문을
  반환한다([docs/API-CONTRACT.md](docs/API-CONTRACT.md#delete-responses-are-plain-text-not-json)
  참고). `client.ts`의 `request()`가 이를 중앙에서 처리한다(Content-Type로
  분기해 JSON 파싱, 아니면 `undefined`) — 원래 이게 없어서 삭제가 성공할
  때마다 `SyntaxError`로 죽었고, 그게 겉으로는 그냥 "Network error"로
  보였다. `api.delete()`가 파싱된 본문을 기대하는 호출부를 추가하지 않는다.

## 컨벤션

- **구조**: `src/api/`(전송), `src/auth/`(세션 상태/가드),
  `src/features/<domain>/`(화면). 새 화면은 기능 폴더 안에 만든다.
- **Fast-refresh**: 컴포넌트를 export하는 파일은 context 객체나 훅을 같이
  export하면 안 된다 — context/provider/훅은 별도 파일에 둔다(`src/auth/`
  참고).
- **파일 헤더 주석**(새 파일에만): imports 위에 세 줄 — Purpose / Usage /
  Rationale — 기존 파일과 동일한 형식으로.
- **Admin**: 이 앱에는 `/admin` 라우트가 없다. ADR 0010이 처음에 스텁으로
  하나를 자리 잡아 뒀지만, ADR 0022가 독립된 Chat Project 콘솔을 `admin/`으로
  대신 들여와 운영자 화면으로 삼았고, 그 콘솔의 역할-관리 슬라이스가 이
  백엔드에 맞춰 조정된 뒤(2026-08-06) 스텁 라우트는 만들어 채우는 대신
  삭제됐다 — ROADMAP.md의 Stage 5 "중복 admin 화면 해소" 항목 참고. 여기에
  `/admin` 라우트를 다시 추가하지 않는다; 운영자 화면은 형제 디렉터리인
  `admin/` 앱에 있다.
- **TypeScript**: `any` 금지; 빌드는 `noUnusedLocals`/`noUnusedParameters`를
  켠 `tsc -b`로 돈다 — 계속 통과 상태를 유지한다.

### Playwright E2E 함정 (`frontend/e2e/`)

`auth`/`upload`/`board.spec.ts`를 작성하며(2026-08-03) 발견한 두 가지 실패
모드로, 미리 피하지 않으면 새 spec 어디서든 다시 나타난다:

- **같은 파일 입력 경로를 다시 설정하면 조용히 아무 일도 안 일어난다.**
  `locator.setInputFiles(path)`를 *동일한* 경로로 연달아 두 번 호출하면(예:
  폼 리셋 후 같은 픽스처를 다시 붙이는 경우) 입력의 `change` 이벤트가 안정적으로
  발생하지 않아서, React 상태가 갱신되지 않고 폼은 마치 파일이 선택되지 않은
  것처럼 제출된다. 먼저 비운다:
  `await input.setInputFiles([]); await input.setInputFiles(path)`.
- **`getByLabel`/`getByRole`의 이름 매칭은 기본적으로 부분 문자열 + 대소문자
  무시**이고, 이 앱이 생성하는 콘텐츠가 여기에 걸려든다: `<label>` 안에 중첩된
  `<select>`는 접근성 이름을 라벨 텍스트에 모든 `<option>` 텍스트를 이어붙인
  값으로 노출한다(`getByLabel('Title')`이 FileBoard의 "Sort by" select에
  매칭됐는데, 그 옵션들이 "...title..."이라는 문자열을 담고 있었기 때문이다),
  그리고 테스트가 생성한 이메일에 흔한 단어가 들어 있으면 관계없는 버튼과
  매칭될 수 있다(`getByRole('button', { name: 'Upload' })`가 접근성 이름이
  `e2e-upload-...@example.com`인 creator-filter 버튼에 매칭됐다). 텍스트가
  짧고 흔한 단어인 라벨/role 쿼리에는 `{ exact: true }`를 준다.

## 명령어

```bash
pnpm dev      # Vite dev server on :5173 (proxies /auth,/file,/user,/upload,/post,/comment → :3000)
pnpm build    # tsc -b type-check + vite production build
pnpm lint     # oxlint
pnpm preview  # serve the production build
```

dev 서버가 API 호출을 성공시키려면 백엔드가 `:3000`에서 실행 중이어야 한다.

**Windows에서는 백그라운드로 띄운 `pnpm dev`/`pnpm preview`를 멈춰도 포트가
풀리지 않는다.** `pnpm`이 vite를 자식 프로세스로 실행하고 Windows에는 POSIX
프로세스 그룹 시그널링이 없어서, 태스크를 죽여도 고아가 된 `node`가 소켓을
계속 붙들고 있다 — 그러면 다음 `--strictPort` 실행이 헷갈리는 "port in use"
에러로 실패한다. 하나를 멈춘 뒤에는 항상 `netstat -ano | grep ":<port>"`로
확인하고, 여전히 남아 있으면 PID로 리스너를 죽인다. 전체 절차: 루트
[CLAUDE.md](../CLAUDE.ko.md) > 명령어 > "Background servers: kill by port, not
by task".
