# Session Log

> 한국어 버전: [SESSION-LOG.ko.md](SESSION-LOG.ko.md)

An append-only record of when a Claude Code session starts or resumes in this
repository. Each row is written automatically by the `SessionStart` hook
(`matcher: "startup"` and `matcher: "resume"`, `.claude/hooks/log-session-start.js`,
registered in `.claude/settings.json` — see [CLAUDE.md](../CLAUDE.md) > Development
Tooling > Hooks). A row captures only the moment a session began or was resumed —
its id, UTC timestamp, and the git branch checked out at that moment — not anything
that happened during the session. Session `clear`/`compact`/`fork` events are
deliberately not logged, so this stays one row per startup/resume rather than one
row per prompt turn.

Do not hand-edit this table; let the hook append to it. If a row looks wrong,
fix the hook (`.claude/hooks/log-session-start.js`), not the row.

| Timestamp (UTC) | Session ID | Branch |
|---|---|---|
