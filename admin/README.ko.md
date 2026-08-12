# `admin/` — admin 콘솔 (2026-08-06 적응: 역할 관리 부분)

> English version: [README.md](README.md)

## 먼저 읽을 것

**이 폴더의 모든 파일은 원래 다른 프로젝트 애플리케이션의 사본으로 시작했다.** 저자의
**Chat Project**(NestJS + GraphQL + Redis + Socket.IO)에서 가져와 2026-07-30에 **수정하지
않은 상태로** 커밋했다. 당시에는 이 저장소가 아니라 Chat Project의 API를 대상으로 하는
코드였다.

**2026-08-06부터 역할 관리 부분(로그인, 대시보드, 사용자, 감사 로그)이 이 백엔드의 실제
REST 계약에 맞게 적응됐다** — 아래 "무엇을 적응시켰는가" 참고. 채팅 도메인 화면(채팅방,
접속 상태, Apollo/GraphQL)은 여기 대응물이 아예 없었으므로 재작성이 아니라 삭제됐다.

## 왜 여기 있는가 — 두 가지 목적

1. **사용자 권한 계층 관리.** RBAC은 [ADR 0013](../ADR/0013-rbac-and-audit-log.ko.md)에서
   도입됐다 — `ROLE_RANK` 순위를 가진 3단계(`user`/`admin`/`superadmin`), superadmin 전용
   `PATCH /user/:id/role`, `ROLE_CHANGE` 감사 기록 — 그런데 **그것을 운영할 수단은 함께 나오지
   않았다.** 지금 첫 superadmin은 `SUPERADMIN_EMAIL` 부팅 시딩으로 생기고, 그 이후의 모든
   승격·강등은 직접 HTTP 요청이거나 Swagger 폼이다. 더 문제는 계층을 보호하는 두 불변식이
   그것을 쓰는 사람에게 보이지 않는다는 점이다: **마지막** superadmin 강등은 거부되고
   (400 `AUTH_LAST_SUPERADMIN`), **모든** 역할 변경은 대상의 `refreshTokenHash`를 null로 만들어
   세션을 즉시 끊는다. 이 콘솔이 바로 그 운영 화면이다.
2. **토큰 절약.** Chat Project의 콘솔은 **같은** 3단계 계층을 대상으로 이미 만들어져 있었고
   (이 프로젝트의 RBAC 설계는 ROADMAP에 "Chat-project style"로 기록돼 있다), 그 사용자
   페이지에는 역할 컬럼, 배정 컨트롤, 사용자별 상세 패널이 이미 있었다. 이것과 골격(라우터,
   라우트 가드, 인증 스토어, 단일 비행 무음 갱신, axios 인터셉터, Playwright·Vitest
   하네스)을 함께 가져오는 비용은 프롬프트로 하나씩 재생성하는 LLM 토큰의 극히 일부였다.

목적 1이 요구사항 — admin 콘솔이 필요한 이유다. 목적 2가 수단 — 그것이 새 코드가 아니라
사본으로 도착한 이유이자, 아래 적응이 처음부터 다시 쓰는 게 아니라 표적 교정인 이유다.

- 이식 결정 전문, 기각한 대안, 결과:
  [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.ko.md)
- 이번 적응은 **ROADMAP Stage 5의 두 번째 행**("이식된 `admin/` 콘솔 적응")이며, 첫 행이 이를
  막고 있었다 — 액세스 토큰이 [ADR 0028](../ADR/0028-access-token-role-claim.ko.md)(실행순서
  #3)에서 `role` 클레임을 얻었고, 이 콘솔의 라우트 가드가 `/dashboard`, `/users`, `/logs`를
  게이팅하는 데 그것을 쓴다.

## 상태

| | |
|---|---|
| 출처 | Chat Project admin 콘솔, 2026-07-30 이식; 역할 관리 부분 2026-08-06 적응 |
| 이 API에 적응됐는가? | **그렇다** — 로그인/대시보드/사용자/로그("무엇을 적응시켰는가" 참고). `vercel.json`의 죽은 Chat Project CSP 호스트는 2026-08-13에 고쳤다(아래 "출처 정리" 참고), 여전히 배포 대상은 없다 |
| 루트 도구 체계에 연결됐는가? | **아니다** — 린트 glob, Jest `roots`, `tsconfig.build.json`, `docker-compose.yml`, CI 모두의 바깥이다. 이것은 의도된 것이지(ADR 0022) 빈틈이 아니다 |
| 의존성 | 자체 `package.json` / `node_modules`. pnpm 워크스페이스가 **아니다**(`frontend/`와 같은 선례). 채팅 도메인 삭제와 함께 `@apollo/client`, `graphql`, `rxjs`를 제거했다 |
| 지금 실행되는가? | 그렇다, 실제 백엔드(`:3000`)를 대상으로 동작한다 — 필요한 일회성 `CORS_ORIGIN` 설정은 "로컬 명령" 참고(`admin`은 `frontend/`의 동일 출처 Vite 프록시와 달리 자체 출처 `:5174`에서 동작한다) |

루트의 `pnpm lint`, `pnpm test`, `pnpm test:e2e`는 이 폴더에 닿을 수 없으므로, 여기 있는 어떤
것도 백엔드 파이프라인을 깨뜨릴 수 없다.

## 출처 정리 (2026-08-13)

Chat Project 이식의 흔적 중 남아있던, 아래 기능 적응과는 무관한 두 가지 — 겉모습/죽은
설정 문제를 정리했다. 색상과 레이아웃은 그대로 뒀다.

- `index.html`의 `<title>`이 제네릭한 `"Admin Panel"`이었다 — `"Upload Board Admin"`으로
  바꾸고, `<head>`에 연결한 `admin/public/favicon.svg`(단순한 "UB" 이니셜 마크)를 추가했다.
- `vercel.json`의 CSP `connect-src`가 여전히 Chat Project의 실제 Railway 배포 주소
  (`https://chat-project-production-3b22.up.railway.app`)를 가리키고 있었다 — 닿을 수 없는
  죽은 설정이지만, 누군가 템플릿으로 참고하면 틀린 값이 된다. `http://localhost:3000`(이
  백엔드의 로컬 개발 기본값 — 루트 `.env.example`의 `BASE_URL` 참고)으로 교체했다.
  **이것은 실제 배포 도메인이 아니라 플레이스홀더다** — Stage 4(프로덕션 DevOps 스택,
  CLAUDE.md > 알려진 미해결 지점 및 로드맵)가 아직 이 백엔드를 어디에 호스팅할지 정하지
  않았으므로, 그 origin이 정해지면 `connect-src`를 다시 갱신해야 한다. 이 콘솔의 배포
  대상은 여전히 Vercel로 유지하기로 했으나(개발자와 확인함), 실제 배포는 아직 설정되지
  않았다.

## 무엇을 적응시켰는가

아래 각 행은 Chat Project에서는 *올바른* 코드였고, 이 프로젝트를 기준으로만 결함이었다.
2026-08-06에 이 저장소 코드를 다시 확인했다(2026-07-30 조사 재검증 — 그사이 백엔드 변경이
하나 있었다. `FORBIDDEN` 행 참고).

| 영역 | 이식 코드가 기대하던 것 | 이 프로젝트의 실제 | 해결 방법 |
|---|---|---|---|
| 역할 인코딩 | `{ role: 1 }`(숫자), 라벨은 `Record<number, string>` | `UserRole` **문자열 enum**(`'user' \| 'admin' \| 'superadmin'`) | `auth.store.ts`의 `role`을 `UserRole`로 바꿨다; `ROLE_RANK`/`ROLE_LABEL` 조회표(`src/auth/role.ts`, 신규)가 모든 숫자 비교를 대체한다 |
| 역할 출처 | `jwtDecode<{ sub, role }>(accessToken)` | 액세스 토큰 페이로드가 이제 `role`을 담는다([ADR 0028](../ADR/0028-access-token-role-claim.ko.md)) | `session-guard.ts`, `login-page.tsx`, `protected-route.tsx`가 `role`을 `UserRole \| undefined`로 디코드하고 `ROLE_RANK[role] >= ROLE_RANK.admin`으로 게이팅한다 |
| 누가 역할을 배정하는가 | admin이면 누구나 역할 컨트롤을 본다 | `PATCH /user/:id/role`은 **superadmin 전용**이며, `updateRole`은 대상 등급에 상한이 없다(마지막 superadmin 강등만 거부) | `users-page.tsx`는 `myRole === 'superadmin'`일 때만 역할 `<select>`를 렌더링하되, 본인 행과 다른 superadmin 행을 포함해 모든 행에 렌더링한다 — 엔드포인트가 실제로 허용하는 범위와 일치시켰다 |
| 계층 불변식 | 어느 쪽도 분기가 없다 | 마지막 superadmin 강등 거부(400 `AUTH_LAST_SUPERADMIN`), 모든 역할 변경이 대상 세션을 종료(`refreshTokenHash` null) | `users-page.tsx`의 `updateRole()`이 `AUTH_LAST_SUPERADMIN` 코드를 분기해 별도 메시지를 보여준다; 세션 종료 부수효과는 클라이언트 처리가 필요 없다(그대로가 맞다) |
| 역할 라벨 | `role === 1 ? 'admin' : 'user'`(이진) | 3단계 | 승격/강등 토글을 3단계 `<select>`(user/admin/superadmin)로 교체했다 — 아래 "역할 변경 UI" 결정 참고 |
| 권한 역전 방지 가드 *(이번 작업 중 발견 — 2026-07-30 조사에는 없었다)* | 이런 검사가 어디에도 없었다 | `PATCH`/`DELETE /user/:id`가 이제 동급/상위 등급 대상에 대한 admin의 조작을 403 `FORBIDDEN`으로 거부한다 — 이번 적응과 같은 날 닫힌 결함 | `users-page.tsx`는 `ROLE_RANK[myRole] > ROLE_RANK[target.role]`일 때만 삭제 버튼을 렌더링하고, `deleteUser()`는 여전히 `FORBIDDEN`을 방어적으로 분기한다(화면 로드와 클릭 사이에 역할이 바뀔 수 있으므로) |
| 감사 액션 | `FORCE_LOGOUT`, `USER_BANNED`, `USER_MUTED`, `USER_UNBAN`을 포함한 6개에 색 지정 | `AUDIT_ACTIONS`는 정확히 `ROLE_CHANGE`, `USER_DELETE`, `FILE_DELETE`, `POST_DELETE`, `COMMENT_DELETE` | `logs-page.tsx`의 `ACTIONS` 목록과 두 페이지의 `actionColor()`를 정확히 맞췄다 |
| superadmin 부트스트랩 문서 | `e2e/.env.example`과 `e2e/seed-superadmin.mjs`가 "CLAUDE.md의 Role Population Invariants"를 인용 | 이 저장소 어디에도 그런 절이 없다 — 실제 메커니즘은 `SUPERADMIN_EMAIL` + `superadmin-seed.service.ts` | 두 파일의 인용을 고쳤다; `seed-superadmin.mjs`의 SQL은 이제 문자열 `'superadmin'`을 넣는다(`role=2, "isAI"=false`가 아니다 — `isAI`는 `UserEntity`에 없다), `.env` 탐색 경로도 실제 루트 `.env`로 고쳤다(`backend/.env`는 존재하지 않는다) |
| 전송 계층 | `/graphql`을 향한 Apollo Client(`src/api/apollo.ts`, `src/api/graphql-operations.ts`, `dashboard-page`/`rooms-page`/`logs-page`의 Apollo 훅) | **REST 전용 — `/graphql` 라우트가 없다**([ADR 0009](../ADR/0009-rest-only-api-with-swagger.ko.md)) | 두 파일 삭제; `main.tsx`의 `ApolloProvider` 제거; `package.json`에서 `@apollo/client`/`graphql` 제거 |
| 갱신 라우트 | `POST /auth/token/refreshaccess` | `POST /auth/token/refresh` ([ADR 0012](../ADR/0012-refresh-cookie-rotation.ko.md)) | `session-guard.ts`에서 수정 |
| 로그아웃 라우트 | `POST /auth/signOut` | `POST /auth/signout` (소문자) | 로그아웃하는 모든 페이지에서 수정 |
| 도메인 페이지 | `rooms-page.tsx`, `getOnlineUser`, `getUserNicknames` | 채팅방·접속 상태·닉네임이 없다 — 이 도메인은 **업로드된 영상 파일**이다 | `rooms-page.tsx`와 `graphql-operations.ts` 삭제; `App.tsx`에서 `/rooms` 라우트 제거; 삭제된 Apollo 계층에서만 쓰던 `rxjs`를 `package.json`에서 제거 |
| 사용자 조작 | `POST /user/:id/ban` \| `/unban` \| `/force-logout` | **하나도 없다** — ROADMAP의 기본값은 여전히 "모더레이션 액션 없음" | `users-page.tsx`에서 세 가지 모두 삭제, 백엔드 쪽 대체 구현은 만들지 않았다(그것은 적응이 아니라 새 범위가 된다) |
| 사용자 목록 조회 | `GET /user?page&take&sort&sortBy&search&status` | `take`/`skip`만, 고정 `createdAt DESC` 순서, 검색·정렬·상태 없음([ROADMAP 실행순서 #2](../ROADMAP.ko.md)) | `users-page.tsx`는 `take`/`skip`으로 페이지네이션한다; 검색창·정렬 토글 헤더·상태 필터는 제거했다(지금 보내면 400 `VALIDATION_FAILED` — `forbidNonWhitelisted`). ~~제거~~ **2026-08-12 재도입**: `GetUsersDto`에 `search`(이메일 `ILIKE`)와 `sortBy`/`order`(`id`/`email`/`createdAt`, `role`은 제외)가 추가됐다; 검색창과 클릭 가능한 ID/Email/Created 헤더가 다시 생겼고, 서버에 존재하지 않는 `status` 필터는 여전히 없다 |
| 감사 로그 | `?action&page&sort&userId&from&to` + `GET /audit-log/export` | `action`, `take`, `skip`만; 고정 `createdAt DESC`; **`/export` 없음**, **`userId` 필터 없음**(이식 당시 기준) | `logs-page.tsx`는 처음엔 액션 필터 + 페이지네이션만 남겼다; CSV 내보내기 버튼, 날짜 범위 필터, 사용자 필터는 제거했다. `userId` ~~없음~~ **2026-08-12 추가**: `AuditLogQueryDto`가 이제 `userId`를 받고(actor 또는 target과 매칭), 같은 커밋에서 `logs-page.tsx`도 자신의 URL(`?userId=`)에서 이를 읽는다 — `users-page.tsx`의 "View all" 링크(`/logs?userId=…`)는 죽은 필터가 아니라 실제로 동작하는 필터다. CSV 내보내기는 ~~제거~~ **2026-08-12 클라이언트 쪽으로 재도입**: `/audit-log/export`는 여전히 없으므로, `exportCsv()`가 DTO의 `take` 상한(페이지당 100)만큼 `GET /audit-log`를 순회해 최대 1000건까지 모은 뒤 다운로드한다 |
| 페이징 모델 | `page` + `take` | `take` + `skip`(오프셋) ([ADR 0021](../ADR/0021-list-query-search-filter-sort.ko.md)) | 두 목록 페이지 모두 `skip = (page - 1) * take`를 계산하고, `{ data, total, page, take }`가 아니라 `[data, total]` 튜플 응답을 읽는다 |
| 사용자별 감사 조각 | 사용자 페이지 상세 패널이 `GET /audit-log?userId=…`를 호출 | `userId` 필터가 존재하지 않는다 | **근사하지 않고 제거했다** — 아래 "열린 사항" 참고. ~~제거~~ **2026-08-12 복원**: `AuditLogQueryDto`에 `userId`가 생기면서, 상세 패널이 `GET /audit-log?userId={id}&take=5`(actor 또는 target)를 호출해 "Recent activity" 절을 보여준다 |
| 사용자 삭제 | 확인 없는 `DELETE /user/:id` | 계정이 파일을 가진 경우 `?deleteFiles=true` 필수, 없으면 409 `USER_HAS_FILES` ([ADR 0020](../ADR/0020-account-deletion-cascade.ko.md)) | `deleteUser()`가 `USER_HAS_FILES`를 잡아 응답 `message`의 파일 개수를 보여주고, 재확인 후 `?deleteFiles=true`로 재시도한다 |
| 에러 처리 | 그때그때의 상태 코드·메시지 검사 | 동결된 `{ code, message }` 계약 — `code`로 분기 ([ADR 0011](../ADR/0011-error-code-contract.ko.md)) | `users-page.tsx`는 모든 분기(`AUTH_LAST_SUPERADMIN`, `USER_HAS_FILES`, `USER_FILES_IN_USE`, `FORBIDDEN`)에서 `axios.isAxiosError`로 `err.response.data.code`를 읽는다 |
| 배포 설정 | CSP가 Chat Project의 Railway 호스트로 고정된 `vercel.json` | **배포 대상이 없다**; AWS는 Stage 4 로드맵 항목 | 이전처럼 손대지 않았다 — 이번 작업 범위 밖 |

위 표는 2026-08-06 기능 적응 작업만을 반영한다; `vercel.json`의 죽은 CSP 호스트는 별도로
2026-08-13에 고쳤다(위 "출처 정리" 참고) — 이 콘솔은 여전히 배포 대상이 없다.

## 이번 적응에서 내린 두 가지 결정

1. **사용자별 감사 조각: 근사하지 않고 제거했다(2026-08-06); 2026-08-12 복원.**
   `GET /audit-log`에는 `userId` 필터가 없어서, 이식된 패널의 "이 사용자의 최근 로그" 절은
   필터 없는 페이지를 가져와 클라이언트 쪽에서 걸러내는 방식으로만 흉내 낼 수 있었다 — 이
   방식은 사용자의 실제 활동이 그 페이지 밖으로 밀려나면 오래된 항목을 조용히 빠뜨린다.
   절을 제거하는 쪽이 정확했고, 흉내 내는 쪽은 그렇지 않았다. 백엔드가
   `AuditLogQueryDto.userId`를 얻으면서(2026-08-12, 이 결정이 기록해 둔
   [ROADMAP.md](../ROADMAP.ko.md) > 미예정 항목의 후속 작업이 닫혔다) 패널의 "Recent
   activity" 절이 클라이언트 쪽 필터링 없이 정확한 `GET /audit-log?userId={id}&take=5`
   호출로 돌아왔다.
2. **역할 변경 UI: 이식된 이진 토글이 아니라 3단계 `<select>`.** 이식된 승격/강등 토글은
   행을 두 상태 사이로만 옮길 수 있고 `superadmin`을 전혀 표현하지 못한다 —
   [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.ko.md)가 이 콘솔이
   존재하는 이유로 정확히 지목한 그 빈틈이다. 드롭다운은 여전히 actor가 superadmin일
   때만 렌더링되며(서버 쪽 `RolesGuard` 검사를 클라이언트에서 거울처럼 반영), 여전히
   `AUTH_LAST_SUPERADMIN`을 자체 메시지로 분기한다.

## 로컬 명령

`admin/` 안에서 실행한다.

```bash
pnpm install     # admin/는 자체 의존성 트리를 갖는다
pnpm dev         # 5174 포트 Vite 개발 서버
pnpm build       # tsc -b && vite build
pnpm lint        # admin/ 자체 eslint 설정
pnpm test        # Vitest (src/**/*.{test,spec}.{ts,tsx})
pnpm e2e         # Playwright — 이제 이 백엔드의 실제 라우트를 대상으로 한다
pnpm e2e:seed    # superadmin 시딩. e2e/.env 필요(git 무시 대상)
```

`.env.example`을 `.env`로, `e2e/.env.example`을 `e2e/.env`로 복사한다. 두 `.env` 파일과
`node_modules/`, `dist/`는 `admin/.gitignore`가 무시하므로 추적되는 비밀 값은 없다.

**`frontend/`에는 필요 없는, 이 콘솔에만 필요한 일회성 백엔드 설정**: `admin/`은 백엔드를
교차 출처로 호출한다(`:5174` → `:3000`, 개발 프록시 없음, 갱신 쿠키를 위해 `axios`가
`withCredentials: true`로 설정돼 있다). 그래서 백엔드 루트 `.env`에
`CORS_ORIGIN=http://localhost:5174`가 필요하다(`frontend/`의 `:5173` 출처와 함께 쓰려면
쉼표로 연결). 이것이 없으면 브라우저가 모든 요청을 막고, 콘솔의 로그인은 읽을 수 있는
에러 없이 조용히 실패한다 — 이것은 이 폴더의 코드로 우회할 수 없는 백엔드 설정 변경이며,
기본값으로는 꺼져 있다(`backend/.env.example`).

## 열린 사항 (이번 작업으로 해결되지 않음)

- ~~`GET /audit-log`에 `userId` 필터가 없다~~ — **2026-08-12 해소**: `AuditLogQueryDto`가
  이제 `userId`를 받는다; 위 "두 가지 결정" 참고.
- ~~`logs-page.tsx`는 아직 자신의 URL에서 `userId` 쿼리 파라미터를 읽지 않는다~~ —
  **2026-08-12, 같은 커밋에서 해소**: `useSearchParams`로 `?userId=`를 읽어 `GET /audit-log`
  쿼리에 적용한다; `users-page.tsx`의 "View all" 링크(`/logs?userId={id}`)는 실제로 동작하는
  필터다. ("무엇을 적응시켰는가" 표의 감사 로그 행이 예전엔 여전히 미해결이라고 적혀
  있었다 — 2026-08-13에 바로잡았다.)
- **2026-08-12에 추가된 기능들에 대한 e2e 커버리지가 없다.** `admin/e2e/logs.spec.ts`와
  `admin/e2e/users.spec.ts` 어디에도 `userId` 필터/"View all" 링크, CSV 내보내기,
  `users-page.tsx`의 검색창·정렬 가능 헤더에 대한 검증이 없다. 두 스펙의 헤더 주석은
  2026-08-13에 이 기능들이 없다고 잘못 말하는 부분을 고쳤지만, 테스트 자체는 추가하지
  않았다 — 테스트 작성은 이번 작업(문서·주석 정리)의 범위를 벗어나는 새 작업이다.
- **`PATCH /file/:id { userId }` 파일 이전 필드는 어떤 결정으로도 정당화된 적이 없다**
  (CLAUDE.md > 알려진 미해결 지점) — 이 콘솔과는 무관하지만, 이번 작업이 손대지 않았고
  해결된 것으로 가정해서는 안 되므로 여기 적어둔다.
- ~~두 admin 화면 중 무엇이 살아남을지~~ — **2026-08-06 해소**: 이 콘솔의 적응이 성공하면서
  이식본이 "대부분 삭제 가능"하지 않았음이 드러났다(삭제 가능했던 건 채팅 도메인 잔재뿐) —
  그래서 이 콘솔이 유일한 admin 화면이다. `frontend/src/features/admin/AdminPage.tsx`는
  삭제됐다. [ROADMAP.md](../ROADMAP.ko.md) > Stage 5 참고.

## 관련 결정

- [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.ko.md) — 이번 이식. ADR 0010의
  admin 배치 조항을 개정한다
- [ADR 0028](../ADR/0028-access-token-role-claim.ko.md) — 이 콘솔의 라우트 가드가 의존하는
  액세스 토큰 `role` 클레임을 추가했다
- [ADR 0010](../ADR/0010-frontend-split-and-api-surface-freeze.ko.md) — 원래 admin을
  `frontend/` 안의 `/admin` 라우트 구역으로 배치했다. 그 구역
  (`frontend/src/features/admin/AdminPage.tsx`)은 이 콘솔이 살아남는 화면으로 확정된
  2026-08-06에 삭제됐다 — 그 ADR의 두 번째 개정 노트 참고
- [CHAT-REMNANT-REMOVAL-PLAN.ko.md](../CHAT-REMNANT-REMOVAL-PLAN.ko.md) — 이 폴더는 *선언된*
  설계 이식(버킷 4)이며, 표시 없는 잔재가 아니다. 이 분류는 이번 적응과 무관하게 유효하다 —
  남은 코드는 여전히 출처가 있는 사본이고, 이제는 원본 그대로가 아니라 교정된 상태일 뿐이다
