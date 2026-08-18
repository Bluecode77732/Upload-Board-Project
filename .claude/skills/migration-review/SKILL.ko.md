---
name: migration-review
description: CLAUDE.md가 요구하는 migration:generate 검토 절차를 순서대로 진행한다 — 사전 평문 설명 → 생성된 diff를 한 줄씩 검토 → 가짜 constraint-rename 구문 제거 → migration:run 전 별도 승인. 엔티티/관계 변경에 마이그레이션이 필요할 때 사용한다.
---

# 마이그레이션 검토

CLAUDE.md의 Scope Discipline > Schema changes 규칙과 Architecture Decisions >
Database 마이그레이션 정책을 실행 절차로 구체화한 것이다. 이 순서를 벗어나
`migration:generate`/`migration:run`을 실행하지 않는다.

## 절차

1. **사전 평문 설명이 먼저다.** 코드를 건드리기 전에 평문으로 명시한다: 어느 엔티티,
   어느 컬럼/관계, nullable/default 여부, 그리고 이유. 개발자로부터 명시적 확인을
   받는다. 이 설명 없이는 `migration:generate`를 절대 실행하지 않는다 —
   `check-migration-generate.js` PreToolUse 훅이 명령어 실행 자체에 대한 승인
   프롬프트를 강제하지만, 그 평문 설명은 훅과 별개로 반드시 먼저 있어야 한다.

2. **엔티티 등록 확인.** 새 엔티티라면 `backend/entities.ts`의 `ENTITIES` 배열에만
   추가한다 — `app.module.ts`나 `backend/data-source.ts`에 직접 추가하지 않는다(둘 다
   그 하나의 배열을 import한다). `ENTITIES`에 빠진 엔티티는 앱에서는 살아있어도
   `migration:generate`에는 보이지 않는다.

3. **실행**: `pnpm migration:generate -- backend/migrations/<Name>`

4. **생성된 파일을 한 줄씩 검토한다.** 베이스라인 마이그레이션
   (`1784678400000-InitialSchema.ts`)은 TypeORM 해시가 아니라 읽기 쉬운 constraint
   이름을 쓴다 — `generate`는 DB와 diff를 뜨면서 실제로는 변경되지 않은 constraint에
   대해 가짜 `DROP CONSTRAINT`/`ADD CONSTRAINT` rename 구문을 만들어낼 수 있다. 이런
   구문을 식별해서 제거하고, 설명한 변경을 구현하는 구문만 남긴다.

5. **범위를 재확인한다.** 제거 후 마이그레이션의 `up()`/`down()`에는 설명했던
   컬럼/관계 변경만 정확히 남아 있어야 한다. 다른 게 남아 있다면 4번으로 돌아간다.

6. **새 테이블이면 e2e 스위트도 업데이트한다.** 이 마이그레이션이 테이블을
   새로 만든다면 `test/e2e-utils.ts`의 `MIGRATIONS`와 `TABLES`에도 각각 한 줄을
   추가해야 한다 — 빠뜨리면 다음 e2e 실행에서 바로 실패하지만, 마이그레이션 파일
   자체와는 별개의 수정이다.

7. **실행 전 최종 승인.** 정리된 마이그레이션 파일을 보여주고
   `pnpm migration:run` 전에 명시적 승인을 받는다. 1번은 *의도*에 대한 승인이고
   이 단계는 *실제 생성된 SQL*에 대한 승인이다 — 같은 승인이 아니다.

## 하지 않는다

- "일단 뭐가 나오나 보려고" `migration:generate`를 미리 실행하지 않는다 — 1번이
  항상 먼저다.
- `generate` 결과를 4번의 한 줄씩 검토 없이 그대로 받아들이지 않는다.
- 7번의 별도 승인 없이 `generate`와 같은 턴에서 `migration:run`을 실행하지 않는다.
