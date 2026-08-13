# 프론트엔드 스타일 전면 개편 계획

2026-08-14에 비교표 기반 Q&A를 거쳐 확정한, 이 앱의 모든 화면을 대상으로 한
전면 비주얼 개편 계획서입니다. 이 문서는 그 작업의 설계 기록이며, 실제
구현은 별도로 디스패치되는 세션에서 진행합니다(아래 "붙여넣기용 프롬프트"
참고) — 각 세션은 작업 전에 반드시 이 문서를 먼저 읽어야 합니다.

## 이번 세션에서 확정한 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 스타일링 방식 | **CSS Modules** (`*.module.css`, 컴포넌트별 동일 위치 배치) | 신규 의존성 없음 — Vite가 `*.module.css`를 기본 내장 지원하므로, Tailwind/styled-components와 달리 frontend/CLAUDE.md의 "CSS 프레임워크 도입 전 제안 필요" 조건에 걸리지 않음. 순수 CSS 문법을 스코프 단위로 유지하면서, 현재의 인라인 `style={{}}` 컨벤션은 대체함. |
| 비주얼 방향 | 브랜드 지향 + 명시적 다크/라이트 토글 | 사용자 선택. 현재 `index.css`의 OS 설정(`prefers-color-scheme`) 의존 방식을 넘어서는 요구. |
| 팔레트 출처 | 이 세션이 제안, **2026-08-14 확정**(아래) | 이 저장소에 참조할 기존 브랜드 자산(로고, 스타일 가이드)이 없음. |
| 적용 범위 | 전체 5개 라우트 페이지 + 공통 `NavBar` | 사용자 선택 — 이번 패스에서 제외되는 페이지 없음. |
| 문서 위치 | `frontend/docs/STYLE-PLAN.md` (+ `.ko.md`) | 사용자 선택. |

## 조사 요약 (현재 상태)

현재 모든 화면은 인라인 `style={{...}}` 객체로 스타일링되어 있습니다 —
`frontend/src` 어디에도 CSS Modules/Tailwind/styled-components가 쓰이고
있지 않습니다. `index.css`에는 이미 작은 규모의 CSS 커스텀 프로퍼티
토큰 세트(`--text`, `--text-h`, `--bg`, `--border`, `--accent`, `--shadow`
등)와 `@media (prefers-color-scheme: dark)` 오버라이드 블록이 정의돼
있습니다 — 새 토큰 체계는 이것을 대체하는 것이 아니라 이 씨앗을
확장하는 방향이어야 합니다.

| 페이지 (라우트) | 파일 | 라인 수 | 비고 |
|---|---|---|---|
| 로그인/회원가입 (`/login`) | `features/auth/LoginPage.tsx` | 96 | 중앙 정렬된 단순 카드 폼. |
| 게시글 게시판 (`/`, 홈) | `features/posts/PostBoard.tsx`, `PostForm.tsx`, `FilePicker.tsx` | 210 + 84 + 109 | 새 글 작성 폼, 검색/정렬/페이지네이션 목록. |
| 게시글 상세 (`/posts/:id`) | `features/posts/PostDetailPage.tsx`, `CommentThread.tsx`, `CommentForm.tsx` | 294 + 209 + 65 | 인라인 수정/삭제, 첨부 파일 재생, 댓글 스레드. |
| 파일 게시판 (`/files`) | `features/files/DashboardPage.tsx`, `FileBoard.tsx`, `UploadForm.tsx` | 24 + 200 + 147 | 업로드 폼, 검색/정렬/페이지네이션 목록. |
| 파일 상세 (`/view/:id`) | `features/files/FileDetailPage.tsx`, `VisibilityBadge.tsx` | 276 + 31 | 영상/오디오/이미지 재생, 가시성 및 공유 토큰 관리. |
| 공통 네비게이션 | `shared/NavBar.tsx` | 40 | 인증된 모든 화면에서 렌더링. |

합계: 13개 파일, 약 1,785줄이 어떤 형태로든 인라인 스타일을 사용 중입니다.

## 브랜드 팔레트 (2026-08-14 확정)

`index.css`에는 이미 포인트 퍼플(`#aa3bff` 라이트 / `#c084fc` 다크)이
씨앗으로 심어져 있습니다. **확정: 이 색을 브랜드 컬러로 유지**하고(이미
실제 적용 중이라 위험이 가장 낮고, 영상/파일/게시글 관리라는 "창작 도구"
느낌에도 퍼플이 어울림) 전혀 다른 색조로 바꾸는 대신 더 완전한 토큰
체계로 확장했습니다.

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--brand` | `#8a2be2` | `#c084fc` | 주요 버튼, 활성 네비게이션 링크, 링크 |
| `--brand-hover` | `#7422c9` | `#d4a6fd` | 위 요소의 hover/active 상태 |
| `--brand-contrast` | `#ffffff` | `#1b0e2e` | `--brand` 위에 올라가는 텍스트/아이콘 색 |
| `--surface` | `#ffffff` | `#16171d` | 페이지 배경 |
| `--surface-raised` | `#f8f7fb` | `#1f2028` | 카드, 폼 패널, 테이블 행 |
| `--border` | `#e5e4e7` | `#2e303a` | 구분선, 입력창/카드 테두리 |
| `--text` | `#3f3a46` | `#c8c6d0` | 본문 텍스트 |
| `--text-muted` | `#6b6375` | `#9ca3af` | 보조/메타 텍스트(이메일, 타임스탬프) |
| `--text-heading` | `#08060d` | `#f3f4f6` | h1/h2 |
| `--success` | `#1a7f37` | `#3fb950` | 예: "replayed"/업로드 완료 상태 |
| `--danger` | `#c92a2a` | `#f87171` | 삭제 버튼, 에러 텍스트 |
| `--danger-bg` | `#fdecec` | `#3b1b1b` | 에러 배너 |

이 표는 `index.css`의 현재 토큰 블록을 **대체하며 확장**합니다 — 기존
블록과 나란히 두는 것이 아닙니다.

## 다크/라이트 모드 토글 (설계 스케치)

현재 상태: `index.css`는 `prefers-color-scheme`만 따르며, 앱 내 토글도
영속화도 없습니다. 명시적 전환 스위치를 추가하려면:

- `<html>`에 `data-theme="light" | "dark"` 속성을 두고, 기본값은 미설정
  상태로 두어(오늘과 동일하게 `prefers-color-scheme`로 폴백).
- `:root[data-theme="dark"] { ... }` 오버라이드를 기존
  `@media (prefers-color-scheme: dark)` 블록과 동일한 토큰 값으로 미러링 —
  OS 설정 변경 없이도 다시 트리거할 수 있게 함.
- 작은 `ThemeProvider`(`src/theme/`, 신규 폴더)를 두어 현재 선택을 React
  상태로 들고, `localStorage`(`ui-theme`)에 미러링해 새로고침 후에도
  사용자가 명시적으로 고른 값을 유지 — 저장된 값이 없으면
  `prefers-color-scheme`로 폴백.
- `NavBar`에 토글 컨트롤 추가.

이것은 작은 신규 추상화(컨텍스트 프로바이더)이며 Scope Discipline에 따라
여기 명시합니다 — 다만 "다크/라이트 모드 구현"(OS 레벨이 아닌 명시적
토글)을 사용자가 이미 구체적으로 요청했으므로 별도 승인 없이 진행합니다.

## 페이지별 작업 목록

| # | 페이지/컴포넌트 | 작업 |
|---|---|---|
| 1 | 토큰 기반 작업 | `index.css`의 토큰 블록을 위 팔레트로 교체; `ThemeProvider` + `data-theme` CSS 추가; 이 단계에서는 페이지 레이아웃 비주얼 변경 없음. |
| 2 | `NavBar` | CSS Module로 전환; 테마 토글 컨트롤 추가. |
| 3 | `LoginPage` | CSS Module로 전환; 카드/입력창/모드 전환 링크 재디자인. |
| 4 | `FileBoard` + `DashboardPage` + `UploadForm` | CSS Modules로 전환; 업로드 폼, 필터 바, 파일 목록 행, 페이지네이션 재디자인. |
| 5 | `FileDetailPage` + `VisibilityBadge` | CSS Modules로 전환; 헤더 재디자인과 함께 제목 겹침 버그(아래 참고) 수정; Manage 패널 재디자인. |
| 6 | `PostBoard` + `PostForm` + `FilePicker` | CSS Modules로 전환; 새 글 작성 폼, 파일 첨부 피커, 게시글 목록 행, 페이지네이션 재디자인. |
| 7 | `PostDetailPage` + `CommentThread` + `CommentForm` | CSS Modules로 전환; 게시글 헤더, 수정/삭제 컨트롤, 댓글 스레드/폼 재디자인. |

권장 디스패치 순서는 번호 순서와 동일합니다 — 이후 모든 페이지가 토큰
체계 존재를 전제하므로 토큰 기반 작업을 가장 먼저 처리합니다.

## 범위 밖이지만 관련된 사항 (2026-08-14 UI/UX 점검 중 발견)

별도로 요청되지 않는 한 이번 스타일 작업에 포함되지 않습니다 — 재디자인을
위해 해당 파일을 만질 사람이 보게 될 것이므로 여기 기록만 해둡니다:

- **파일 상세 제목 겹침**: `/view/:id`(`FileDetailPage.tsx`)에서 제목이
  길면 텍스트가 스스로 겹쳐 보임 — `index.css`의 전역 `h1` 규칙과
  `line-height`/`margin`이 상호작용하는 문제로 추정. 별도 작업이 아니라
  위 5번 항목(해당 페이지 재디자인)에 묻어가는 수정으로 포함.
- **영상 재생 S3 CORS 오류**: `GET /file/:id/content`가 presigned S3 URL로
  리다이렉트하는데(백엔드 ADR 0036) 브라우저가 이를 fetch하지 못함 —
  버킷에 프론트엔드 origin을 허용하는 CORS 정책이 없음. 이것은 프론트엔드나
  백엔드 소스 코드가 아니라 AWS 버킷 설정 문제 — 별도 작업, 별도 담당.
- **한글/영어 UI 텍스트 혼용**: `features/posts/*`(PostForm, PostDetailPage,
  CommentThread, CommentForm)는 UI 문자열과 에러 메시지가 한글로
  하드코딩돼 있고, `features/auth/*`와 `features/files/*`는 영어만
  사용합니다. 스타일 작업 도중 암묵적으로 결정할 i18n 프레임워크 사안이
  아님 — 별도 작업.

## 확인 필요 사항

1. ~~제안된 팔레트 확정~~ — **2026-08-14 확정**, 기존 퍼플 브랜드 시드를
   유지. 1번 항목 디스패치 가능.
2. 위 "범위 밖이지만 관련된 사항" 3건을 이후 별도 작업으로 진행할지,
   의도적으로 그대로 둘지 확인.

## 붙여넣기용 프롬프트

이 세션의 메모리(`session-prompts.md`, "Ready-to-paste: frontend style
overhaul" 항목)에 기록된, `frontend/CLAUDE.md`가 적용되는 디스패치
프롬프트를 참고하세요 — 각 프롬프트는 작업 전에 이 문서를 먼저 다시
읽도록 되어 있어, 새 세션이 결정 과정을 처음부터 다시 유추할 필요가
없습니다.
