# 세션 로그

> English version: [SESSION-LOG.md](SESSION-LOG.md)

이 저장소에서 Claude Code 세션이 시작되거나 재개될 때마다 남는 append-only 기록이다.
각 행은 `SessionStart` 훅(`matcher: "startup"`과 `matcher: "resume"`,
`.claude/hooks/log-session-start.js`, `.claude/settings.json`에 등록 —
[CLAUDE.md](../CLAUDE.md) > Development Tooling > Hooks 참고)이 자동으로 추가한다.
한 행은 세션이 시작되거나 재개된 순간만을 담는다 — 세션ID, UTC 시각, 그 순간
체크아웃되어 있던 git 브랜치 — 세션 도중 무슨 일이 있었는지는 담지 않는다.
`clear`/`compact`/`fork` 이벤트는 의도적으로 로깅하지 않는다 — 그래야 프롬프트
턴마다가 아니라 시작/재개마다 한 행씩 남는다.

이 표는 직접 편집하지 말고 훅이 append하도록 둔다. 특정 행이 이상해 보이면 행을 고치지
말고 훅(`.claude/hooks/log-session-start.js`)을 고친다.

| 시각 (UTC) | 세션 ID | 브랜치 |
|---|---|---|
