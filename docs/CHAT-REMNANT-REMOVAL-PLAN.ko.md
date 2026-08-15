# Chat 프로젝트 잔재 제거 계획서

> English version: [CHAT-REMNANT-REMOVAL-PLAN.md](CHAT-REMNANT-REMOVAL-PLAN.md)

**상태: 처리 예정(향후 처리로 기록됨)** — 2026-07-22 검토 실행 완료; 남은 작업은
[잔여 작업](#잔여-작업-처리-예정) 참조.

## 배경

`CLAUDE.md`는 원래 다른 프로젝트 — 실시간 1:1 채팅 애플리케이션(NestJS + GraphQL +
Redis + Socket.IO 모노레포) — 의 사본으로 이 저장소에 들어왔습니다. 2026-07-22에 이
저장소 기준으로 전면 재작성되었습니다(커밋 `f3fff1c`). 본 계획서는 **모든** 추적
문서에서 채팅 프로젝트 관련 서술이 남아 있지 않음을 검증하고, 재유입을 막는 절차를
정의합니다.

## 범위

2026-07-22 기준 전체 추적 문서:

| 그룹 | 파일 |
|---|---|
| 루트 문서 | `CLAUDE.md`, `README.md`(.ko), `ARCHITECTURE.md`(.ko), `CHANGELOG.md`(.ko), `CONTRIBUTING.md`(.ko), `ROADMAP.md`(.ko) |
| ADR 세트 | `ADR/0001`–`ADR/0009` + `ADR/README.md` (EN/KO 쌍, 20개 파일) |
| 템플릿 | `.env.example` |
| 저장소 외부 | Claude Code 메모리 파일(`project-principles.md`, `MEMORY.md`) |

생성 산출물(`coverage/`, `dist/`, `node_modules/`)은 제외 — 깨끗한 소스에서 재생성됩니다.

## 방법

저장소 루트에서 언제든 재실행 가능한 두 개의 검색어 세트:

```bash
# 세트 A — 채팅 프로젝트 도메인 용어
grep -rniE "chat|redis|graphql|socket|pubsub|monorepo|railway|vercel|zustand|apollo|gemini|moderation|sendMessage|receiveMessage|resolver|gateway|subscription|frontend/|backend/|admin/|graphql-ws|ioredis|sentry|bullmq|session-guard|forceLogout|RoomEntity|ChatEntity|superadmin" \
  --include="*.md" *.md ADR/ .env.example

# 세트 B — 채팅 프로젝트 코드 식별자
grep -rniE "RbacGuard|GqlTransaction|QueryRunnerDecorator|RateLimitGuard|kickPrevious|AiService|AuditLog|MODERATION_|user_cache|SessionCache|EntityBase|schema\.gql|pnpm --filter|graphql-operations|errorLink|wsLink|reconnectSocket|protected-route|chat-page|DOMpurify|winston" \
  --include="*.md" *.md ADR/ .env.example
```

모든 검색 결과는 다음 네 분류 중 하나로 판정합니다:

1. **잔재** — 채팅 프로젝트의 스택/구조를 이 저장소의 것처럼 서술 → **제거**.
2. **의도적 부정문** — 배제한 기술을 명시하는 가드레일("Never suggest
   GraphQL/WebSocket/gRPC", "no monorepo", "no winston") → **유지**.
3. **이 저장소 고유 기능** — 이제 정당하게 이곳에 속하는 용어(예: 커밋 `0549ca4`
   이후의 `CORS_ORIGIN`) → **유지**.
4. **의도적 설계 참조** — 채팅 프로젝트를 설계 출처로 명시적으로 *인용*하는 경우
   (예: ROADMAP의 RBAC "Chat-project style" 3단계 설계) → **유지**, 단 다른
   프로젝트에 대한 참조로 표현되어야 하며 이 저장소의 현재 상태 서술로 쓰여서는
   안 됩니다.

## 검토 결과 (2026-07-22)

**발견된 잔재: 0건.** 모든 검색 결과는 분류 2와 3에 해당:

| 위치 | 검색 결과 | 분류 | 조치 |
|---|---|---|---|
| `CLAUDE.md` (API Layer) | "Never suggest: GraphQL, WebSocket, gRPC" | 부정문 | 유지 |
| `CLAUDE.md` (Project Overview) | "No frontend, no monorepo, no deployment pipeline" | 부정문 | 유지 |
| `CLAUDE.md` / `ARCHITECTURE.md`(.ko) | "no winston, no Nest Logger" | 부정문 | 유지 |
| `ADR/0009`(.ko), `ROADMAP.md`(.ko) Non-Goals | GraphQL/WebSocket/gRPC 배제 근거 | 부정문 | 유지 |
| `README.md`(.ko), `ADR/0008`(.ko), `CHANGELOG.md`(.ko), `ROADMAP.md`(.ko) | `CORS_ORIGIN` | 고유 기능 | 유지 |
| `CHANGELOG.ko.md`, `CONTRIBUTING.ko.md` | "메시지"(커밋 메시지 문맥) | 오탐 | 유지 |
| `ROADMAP.md`(.ko) RBAC 항목 | "Chat-project style" 3단계 설계(`user`/`admin`/`superadmin`) | 설계 참조 | 유지 |
| 메모리 파일(저장소 외부) | 없음 | — | 클린 확인 |

제거 단계는 `f3fff1c` CLAUDE.md 재작성으로 사실상 완료되었으며, 2026-07-22 문서
세트(`09d04a8`)는 이 저장소 기준으로 새로 작성되어 이월된 내용이 없습니다.

## 트리거 발동 — `admin/` 이식 (2026-07-30)

아래 재검증 트리거("다른 프로젝트에서 내용을 붙여넣을 때")가 처음으로 발동했습니다. Chat
Project의 admin 콘솔을 최상위 `admin/` 폴더로 통째로 가져왔습니다
([ADR 0022](ADR/0022-admin-console-import-from-chat-project.ko.md)) — 그쪽에 이미 있던 골격을
다시 만드는 데 드는 LLM 토큰을 아끼기 위해서입니다.

**분류: 버킷 4(의도적 설계 참조) — 잔재가 아닙니다.** 이 이식은 함께 배포되는 두 문서, 즉
ADR 0022와 `admin/README.md`(.ko)에서 선언·날짜·출처가 모두 밝혀집니다. 버킷 4의 조건 — 다른
프로젝트에 대한 참조로 표현하고 이 저장소의 현재 상태를 서술하지 않는다 — 은 문장 표현이 아니라
그 문서들이 충족합니다. 이식된 것이 산문이 아니라 **코드**이기 때문입니다. 두 문서 중 어느
하나라도 `admin/`이 Chat Project API를 대상으로 한다는 서술을 멈추면, 그 순간 잔재로 재분류됩니다.

**이번 검토 방법으로는 잡을 수 없었던 두 가지를 기록해 둡니다:**

1. **grep 세트는 문서만 대상으로 합니다.** 두 세트 모두 `--include="*.md" *.md ADR/
   .env.example` 범위입니다. `admin/` 이식은 chat 프로젝트 용어 — `apollo`,
   `graphql-operations`, `errorLink`, `zustand`, `session-guard`, `protected-route`, 그리고 방·
   접속 상태·닉네임 식별자 — 를 그 범위 완전 바깥인 **추적되는 소스 코드**에 들여놓습니다.
   용어가 `admin/src/`에 그대로 있는데도 세트 A와 세트 B는 "클린"이라고 보고합니다. 앞으로의
   모든 검토는 코드까지 봤는지 문서만 봤는지 명시해야 합니다.
2. **`admin/`은 살아 있는 잔재를 의도적으로 품고 있으며, 고치지 않고 격리했습니다.**
   `admin/vercel.json`은 CSP `connect-src`를 Chat Project의 Railway 운영 호스트로 고정하고,
   `rooms-page.tsx`·`logs-page.tsx`·`graphql-operations.ts`는 채팅 도메인과 이 API에 없는
   `/graphql` 엔드포인트를 서술합니다. 적응 작업이 원본을 기준으로 diff를 뜰 수 있도록
   **의도적으로 수정하지 않고** 커밋했습니다. 전부 ADR 0022의 수정 백로그와
   `admin/README.md`에 항목으로 올라 있습니다. 이들은 지금 제거해야 할 버킷 1 잔재가
   **아니며**, 예정된 재작성의 입력물입니다. `admin/`이 무언가에 연결되거나 배포되는 순간부터는
   더 이상 용인되지 않습니다.

이번 변경의 문서 측 검증: 여기서 `*.md`에 추가된 용어(`admin/`, `apollo`, `graphql`, `zustand`,
`vercel`, `railway`, `session-guard`, `protected-route`)는 모두 ADR 0022,
`admin/README.md`(.ko), 그리고 이 절 안에 있으며, 각각 Chat Project 코드에 대한 참조로
표현되어 있습니다. 이 저장소 자체의 기술 스택을 서술하는 항목은 하나도 없습니다.
**발견된 잔재: 0건.**

**정정 (2026-08-13) — 위 1·2번 항목은 이제 오래된 서술입니다. 삭제하지 않고 2026-07-30
시점 검토가 무엇을 못 봤는지 정직하게 남겨둔 채, 아래에서 바로잡습니다.** 2번 항목의
목록은 2026-07-30 시점의 스냅샷입니다 — 2026-08-06의 콘솔 적응 작업([ROADMAP.md](ROADMAP.md)
> Stage 5, `admin/README.md` > "무엇을 적응시켰는가")이 `rooms-page.tsx`와
`graphql-operations.ts`를 **아예 삭제**했습니다. "의도적으로 수정하지 않고 커밋"한 채 재작성을
기다리는 상태가 아니라, 이제 존재하지 않는 파일입니다. `logs-page.tsx`도 이 API의 실제
라우트를 기준으로 다시 작성되어 더 이상 채팅 도메인을 서술하지 않습니다. 그 작업 이후에도 살아
남은 잔재는 `admin/vercel.json`의 CSP `connect-src` 하나뿐이었고, 이 역시 2026-08-13에 별도로
고쳐졌습니다(커밋 `f306813`, `admin/README.md` > "출처 정리") — Railway 호스트 대신
`localhost:3000` 플레이스홀더로 교체했습니다. 1번 항목이 지적한 공백(grep 세트가
`admin/src/`를 훑은 적이 없다는 점)은 아래의 재검증으로 닫혔습니다 — 처음으로 코드까지 대상에
넣었습니다.

## 재검증 — 코드 범위 (2026-08-13)

위 1번 항목을 닫습니다. 세트 A와 세트 B를 **원문 그대로**, 이번에는 처음으로 `admin/src/`,
`admin/vercel.json`, `admin/index.html`, `admin/package.json`, `admin/e2e/`에 대해서도
실행했습니다 — `*.md`/`ADR/`/`.env.example`만이 아닙니다.

```bash
grep -rniE "chat|redis|graphql|socket|pubsub|monorepo|railway|vercel|zustand|apollo|gemini|moderation|sendMessage|receiveMessage|resolver|gateway|subscription|frontend/|backend/|admin/|graphql-ws|ioredis|sentry|bullmq|session-guard|forceLogout|RoomEntity|ChatEntity|superadmin" \
  admin/src admin/vercel.json admin/index.html admin/package.json admin/e2e

grep -rniE "RbacGuard|GqlTransaction|QueryRunnerDecorator|RateLimitGuard|kickPrevious|AiService|AuditLog|MODERATION_|user_cache|SessionCache|EntityBase|schema\.gql|pnpm --filter|graphql-operations|errorLink|wsLink|reconnectSocket|protected-route|chat-page|DOMpurify|winston" \
  admin/src admin/vercel.json admin/index.html admin/package.json admin/e2e
```

**발견된 잔재: 0건.** 모든 검색 결과를 분류하면:

| 검색 결과 | 위치 | 분류 | 조치 |
|---|---|---|---|
| `superadmin`, `AuditLog`, `zustand` | `auth/role.ts`, `store/auth.store.ts`, `lib/audit.ts`, `pages/*.tsx`, `package.json` | 고유 기능 | 유지 — 이 저장소의 실제 RBAC·감사 로그 용어이자 실제 상태 관리 의존성이며, chat 프로젝트의 잔재가 아닙니다 |
| "Chat Project" 산문 서술(예: "that was the Chat Project's domain", "Chat Project's numeric 0/1/2") | `pages/dashboard-page.tsx:11`, `pages/logs-page.tsx:4`, `pages/users-page.tsx:4`, `store/auth.store.ts:4`, `e2e/logs.spec.ts:5`, `e2e/users.spec.ts:5` | 설계 참조 | 유지 — 모두 이 저장소가 그 동작을 **갖고 있지 않다**고 말하기 위해 Chat Project를 인용합니다 |
| "an axios 401 and an Apollo UNAUTHENTICATED error firing at the same time" | `auth/session-guard.ts:75` | 오탐 | 유지 — 경합 조건을 설명하는 가상의 비유일 뿐, (삭제된) Apollo 의존성에 대한 참조가 아닙니다 |
| `session-guard.ts`, `protected-route.tsx`(파일명·import) | `admin/src` 전반 | 고유 기능 | 유지 — 이 저장소 자체의 파일입니다. 세트 A의 `session-guard` 용어는 같은 목적의 chat 프로젝트 파일을 잡기 위한 것이지, 이 파일을 겨냥한 것이 아닙니다 |
| `admin/vercel.json` 내용 | — | — | 파일 자체 안에는 `railway`/`vercel`/`chat` 어느 것도 없습니다 — 위의 CSP 수정이 이미 유일한 잔재 문자열을 제거했습니다 |
| `rooms-page.tsx`, `graphql-operations.ts` | — | — | 파일 검색과 grep 모두 결과 없음 — 2026-08-06에 삭제됐지, 격리된 상태가 아닙니다 |

버킷 1 결과는 없습니다. `admin/`은 이번 재검증 기준으로 문서 범위와 코드 범위 모두에서
깨끗합니다.

## 잔여 작업 (처리 예정)

1. **Git 히스토리 결정** — `4d00bc2` 이전 커밋들에는 채팅 앱 `CLAUDE.md`가 여전히
   남아 있습니다(`git show c8eb19f:CLAUDE.md`로 열람 가능). 선택지:
   - **현상 유지(권장)** — 정직한 이력 기록이며, 히스토리 재작성(`filter-repo`)은
     파괴적이고 `CHANGELOG.md`/`ROADMAP.md`에 인용된 모든 커밋 해시를 깨뜨립니다.
     HEAD를 읽는 사람에게 혼동을 주지 않습니다.
   - 히스토리 재작성 — 과거 내용이 공개되어서는 안 되는 경우에만 정당화됩니다.
   결정은 개발자에게 위임; 명시적 선택 전까지 조치 없음.
2. **재검증 트리거** — 다음 시점마다 위 방법의 grep 세트를 재실행:
   - 새 문서 파일이 추가될 때
   - 다른 프로젝트나 과거 브랜치에서 내용을 붙여넣을 때
   - 저장소를 공개/태깅하기 직전

   지금까지 2회 발동 — `admin/` 이식(2026-07-30, 문서 범위)과 위의 코드 범위 재검증
   (2026-08-13, 첫 검토가 남긴 문서 전용 공백을 닫음). 앞으로 `admin/`을 다시 검토할 때도
   문서만 보는 쪽으로 되돌아가지 말고 계속 코드까지 넓혀야 합니다.
3. **메모리 위생** — 저장소 외부 메모리 파일은 2026-07-22 기준 클린; 프로젝트
   아키텍처를 언급하는 메모리 항목이 추가될 때마다 재확인.

## 완료 기준

본 계획은 (1) Git 히스토리 결정이 내려져 이 문서에 기록되고, (2) 재검증 트리거가
습관으로 정착하거나 자동화(이제 착지된 Stage 1 CI 파이프라인의 잡으로,
[ADR 0016](ADR/0016-github-actions-ci.ko.md))될 때 종료됩니다.
