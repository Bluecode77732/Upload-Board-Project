---
name: adr-authoring
description: 이 프로젝트의 경량 MADR 스타일로 새 ADR을 작성하거나(또는 기존 ADR을 supersede/amend/extend) docs/ADR/ 컨벤션(번호 체계, 파일명, .ko.md 짝, README.md 표 항목)을 정확히 맞춘다. 아키텍처적으로 유의미한 결정이 이미 확정된 뒤에 사용한다.
---

# ADR 작성

`docs/ADR/README.md`에 적힌 컨벤션을 실행 절차로 구체화한 것이다. 아키텍처적으로
유의미한 결정이 개발자와 실제로 확정된 뒤에만 이 절차를 실행한다(Clarification
Protocol의 마지막 행) — 이 스킬은 결정을 *기록*하는 것이지 *내리는* 것이 아니다.

## 절차

1. **독립된 ADR인지, 기존 ADR을 amend/extend/supersede하는지 먼저 확인한다.**
   `docs/ADR/README.md`의 표에서 관련된 내용이 이미 있는지 읽어본다.
   - *Amends(수정)*: 기존 결정을 통째로 대체하지 않고 그 입장을 바꾼다 (예: ADR 0029
     D6이 ADR 0005의 스토리지 프레이밍을 amend).
   - *Extends(확장)*: 기존 결정을 바꾸지 않고 그 위에 쌓는다 (예: ADR 0040이 ADR
     0025/0027을 extend).
   - *Supersedes(대체)*: 기존 결정을 완전히 대체한다 — 옛 ADR의 `Status` 줄을
     `Superseded by NNNN`으로 바꾼다; 원래 결정의 Context/Decision 본문은 절대
     수정하지 않는다.

2. **다음 번호.** `docs/ADR/README.md` 표의 마지막 행 다음 순번을 쓴다 — 디스크에
   있는 가장 큰 파일명이 아니라 표를 기준으로 확인한다(둘이 어긋날 수 있다).

3. **파일명.** `NNNN-short-kebab-title.md` + `NNNN-short-kebab-title.ko.md` 짝.

4. **헤더 블록** (아래 순서 그대로):
   ```
   # ADR NNNN: <Title>

   - Status: Accepted (또는 "Accepted — implemented", "Accepted (design-only)",
     "Accepted — implemented, unapplied" 등 — 실제 상태에 맞게)
   - Date: YYYY-MM-DD
   - Amends / Extends / Supersedes: [ADR NNNN](...) <관계, 있는 경우만 — 독립형이면 생략>
   - 한국어: [NNNN-short-kebab-title.ko.md](NNNN-short-kebab-title.ko.md)
   ```

5. **본문 섹션, 이 순서로:**
   - `## Context` — 다루는 문제/공백, 실제 조사에 근거함(지어내지 않음)
   - `## Decision` — 선택한 접근. 결정 지점이 여러 개면 하나의 뭉뚱그린 블록 대신
     `### D1 — <짧은 제목>`, `### D2 — ...` 식으로 나눈다
   - `## Consequences` — 결과로 무엇이 바뀌는지, 어떤 트레이드오프를 받아들였는지

6. **같은 변경에서 `.ko.md` 짝을 만든다** — 자연스러운 한국어, 동일한 구조
   (Documentation Convention).

7. **`docs/ADR/README.md`와 `docs/ADR/README.ko.md` 둘 다 업데이트한다** — 표에 새
   행(# / Title / Status / Decided)을 추가하며 두 표를 동일하게 맞춘다.

8. **CLAUDE.md와 대조한다.** 이 ADR의 결정이 CLAUDE.md가 명시한 규칙(Architecture
   Decisions, Never Do, Project-Specific Principles)을 바꾼다면, 같은 변경에서
   CLAUDE.md도 업데이트해야 한다 — ADR은 *이유*를 기록하고, 실제로 매일 지켜지고
   강제되는 규칙은 CLAUDE.md에 산다.

## 하지 않는다

- 개발자와 아직 확정되지 않은 결정에 대해 ADR을 쓰지 않는다 — 그건 이 스킬이 아니라
  `doc-authoring` 스킬의 3번 역할(질문)이다.
- superseded된 ADR의 Context/Decision 본문을 수정하지 않는다 — Status 줄만 바꾼다.
- `docs/ADR/README.md` 표를 확인하지 않고 새 ADR 번호를 매기지 않는다.
