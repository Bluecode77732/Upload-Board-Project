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
3. **메모리 위생** — 저장소 외부 메모리 파일은 2026-07-22 기준 클린; 프로젝트
   아키텍처를 언급하는 메모리 항목이 추가될 때마다 재확인.

## 완료 기준

본 계획은 (1) Git 히스토리 결정이 내려져 이 문서에 기록되고, (2) 재검증 트리거가
습관으로 정착하거나 자동화(이제 착지된 Stage 1 CI 파이프라인의 잡으로,
[ADR 0016](ADR/0016-github-actions-ci.ko.md))될 때 종료됩니다.
