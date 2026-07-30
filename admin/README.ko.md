# `admin/` — 이식된 admin 콘솔 (이 프로젝트에 아직 적응되지 않음)

> English version: [README.md](README.md)

## 먼저 읽을 것

**이 폴더의 모든 파일은 다른 프로젝트 애플리케이션의 사본이다.** 저자의 **Chat Project**
(NestJS + GraphQL + Redis + Socket.IO)에서 가져와 **수정하지 않은 상태로** 커밋했다. 이
저장소가 아니라 Chat Project의 API를 대상으로 하는 코드다.

**아직 이 백엔드에 대해 동작하지 않으며, 동작해야 하는 것도 아니다.** 이 폴더는 *수정
기반*으로 존재한다: admin 콘솔에 필요한 도메인 무관 골격(라우터, 라우트 가드, 인증 스토어,
단일 비행 무음 갱신, axios 인터셉터, Playwright·Vitest 하네스)이 이미 동작하고 검증된 형태로
존재했고, 이를 가져오는 편이 프롬프트로 하나씩 재생성하는 것보다 LLM 토큰을 훨씬 적게 쓴다.
그 경제적 근거가 이 폴더가 여기 있는 이유 전부다.

- 결정 전문, 기각한 대안, 결과:
  [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.ko.md)
- 적응 작업은 **별도의 전용 작업**이다([CLAUDE.md](../CLAUDE.md) > 범위 준수). 지나가며 하는
  정리로 취급하지 말고, 이 안의 어떤 줄도 이 프로젝트의 계약을 반영한다고 가정하지 말 것.

## 상태

| | |
|---|---|
| 출처 | Chat Project admin 콘솔, 2026-07-30 이식 |
| 이 API에 적응됐는가? | **아니다** — 아래 백로그 참조 |
| 루트 도구 체계에 연결됐는가? | **아니다** — 린트 glob, Jest `roots`, `tsconfig.build.json`, `docker-compose.yml`, CI 모두의 바깥 |
| 의존성 | 자체 `package.json` / `node_modules`. pnpm 워크스페이스가 **아니다**(`frontend/`와 같은 선례) |
| 지금 실행되는가? | 단독으로는 빌드·서빙되지만, 모든 백엔드 호출이 이 API에 없는 라우트를 향한다 |

루트의 `pnpm lint`, `pnpm test`, `pnpm test:e2e`는 이 폴더에 닿을 수 없으므로, 여기 있는 어떤
것도 백엔드 파이프라인을 깨뜨릴 수 없다.

## 동작하려면 무엇을 바꿔야 하는가

2026-07-30에 이 저장소 코드를 직접 확인했다. 모든 행이 Chat Project에서는 *올바른* 코드였고,
이 프로젝트를 기준으로만 결함이다.

| 영역 | 이식 코드가 기대하는 것 | 이 프로젝트의 실제 |
|---|---|---|
| 전송 계층 | `/graphql`을 향한 Apollo Client(`src/api/apollo.ts`, `src/api/graphql-operations.ts`, 그리고 `dashboard-page`·`rooms-page`·`logs-page`의 Apollo 훅) | **REST 전용 — `/graphql` 라우트가 없다**([ADR 0009](../ADR/0009-rest-only-api-with-swagger.ko.md)) |
| 갱신 라우트 | `POST /auth/token/refreshaccess` | `POST /auth/token/refresh` ([ADR 0012](../ADR/0012-refresh-cookie-rotation.ko.md)) |
| 로그아웃 라우트 | `POST /auth/signOut` | `POST /auth/signout` (소문자) |
| 역할 타입 | `role: number`, 게이트는 `(role ?? -1) < 1` | `UserRole` **문자열 enum** + `ROLE_RANK` ([ADR 0013](../ADR/0013-rbac-and-audit-log.ko.md)) |
| 역할 출처 | `jwtDecode<{ sub, role }>(accessToken)` | 액세스 토큰 페이로드는 `{ sub, type }` — **`role` 클레임이 없어서** 가드가 지금은 `undefined`를 읽고 모두 거부한다 |
| 도메인 페이지 | `rooms-page.tsx`, `getOnlineUser`, `getUserNicknames` | 채팅방·접속 상태·닉네임이 없다 — 이 도메인은 **업로드된 영상 파일**이다 |
| 사용자 조작 | `POST /user/:id/ban` \| `/unban` \| `/force-logout` | **하나도 없다** |
| 사용자 목록 조회 | `GET /user?page&take&sort&sortBy&search&status` | `findAll()`은 `@Query()`를 바인딩하지 않고 전체 사용자를 페이지네이션 없이 반환한다 |
| 감사 로그 | `?action&page&sort&userId&from&to` + `GET /audit-log/export` | `action`, `take`, `skip`만. **`/export`가 없다** |
| 페이징 모델 | `page` + `take` | `take` + `skip`(오프셋) ([ADR 0021](../ADR/0021-list-query-search-filter-sort.ko.md)) |
| 사용자 삭제 | 확인 없는 `DELETE /user/:id` | 계정이 파일을 가진 경우 `?deleteFiles=true` 필수, 없으면 409 `USER_HAS_FILES` ([ADR 0020](../ADR/0020-account-deletion-cascade.ko.md)) |
| 에러 처리 | 그때그때의 상태 코드·메시지 검사 | 동결된 `{ code, message }` 계약 — `code`로 분기 ([ADR 0011](../ADR/0011-error-code-contract.ko.md)) |
| 배포 설정 | CSP가 Chat Project의 Railway 호스트로 고정된 `vercel.json` | **배포 대상이 없다.** AWS는 Stage 4 로드맵 항목. 어디든 배포하기 전에 다시 쓰거나 삭제 |

`vercel.json`은 의도적으로 손대지 않았다. 적응 작업이 반쯤 고쳐진 파일이 아니라 원본을 기준으로
diff를 뜰 수 있어야 하기 때문이다.

## 관련 결정

- [ADR 0022](../ADR/0022-admin-console-import-from-chat-project.ko.md) — 이번 이식. ADR 0010의
  admin 배치 조항을 개정한다
- [ADR 0010](../ADR/0010-frontend-split-and-api-surface-freeze.ko.md) — 원래 admin을 `frontend/`
  안의 `/admin` 라우트 구역으로 배치했다. 그 구역
  (`frontend/src/features/admin/AdminPage.tsx`)은 **아직 남아 있고**, 두 화면 중 무엇이
  살아남을지는 [ROADMAP.ko.md](../ROADMAP.ko.md) > 미예정 항목의 미결 사항이다
- [CHAT-REMNANT-REMOVAL-PLAN.ko.md](../CHAT-REMNANT-REMOVAL-PLAN.ko.md) — 이 폴더는 *선언된*
  설계 이식(버킷 4)이며, 표시 없는 잔재가 아니다. 이 분류는 이 파일과 ADR 0022가 "이 코드는
  Chat Project API를 대상으로 한다"고 계속 밝히는 동안에만 유효하다

## 로컬 명령

`admin/` 안에서 실행한다. 이식된 스크립트 그대로다.

```bash
pnpm install     # admin/는 자체 의존성 트리를 갖는다
pnpm dev         # 5174 포트 Vite 개발 서버
pnpm build       # tsc -b && vite build
pnpm lint        # admin/ 자체 eslint 설정
pnpm test        # Vitest (src/**/*.{test,spec}.{ts,tsx})
pnpm e2e         # Playwright — Chat Project 라우트를 기대하므로 여기서는 실패한다
pnpm e2e:seed    # superadmin 시딩. e2e/.env 필요(git 무시 대상)
```

`.env.example`을 `.env`로, `e2e/.env.example`을 `e2e/.env`로 복사한다. 두 `.env` 파일과
`node_modules/`, `dist/`는 `admin/.gitignore`가 무시하므로 추적되는 비밀 값은 없다.
