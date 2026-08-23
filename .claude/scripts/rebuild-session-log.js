// Purpose: regenerates docs/SESSION-LOG.md from Claude Code's own transcripts — one row per session, carrying its true first-creation time and title.
// Usage: run `node .claude/scripts/rebuild-session-log.js` from the repo root whenever the session index should be refreshed; takes an optional transcript-directory override as argv[2].
// Rationale: the SessionStart/UserPromptSubmit hooks this replaces could only ever see sessions created after they were installed, appended a row per resume rather than per session, and had no access to the real session title — all three are already recorded in ~/.claude/projects/<project>/<session_id>.jsonl.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TITLE_LIMIT = 80;
const MESSAGE_LIMIT = 100;

// 목적: 이 저장소의 트랜스크립트 디렉터리 경로를 돌려준다.
// 이유: Claude Code는 프로젝트 경로를 변형한 이름의 폴더에 트랜스크립트를 모아두는데, 그 규칙이 스크립트 안에 하드코딩되어 있으면 다른 머신·다른 경로에서 그대로 깨진다.
// 방법: argv override가 있으면 그대로 쓰고, 없으면 cwd의 영숫자 아닌 문자를 전부 '-'로 바꿔 ~/.claude/projects 아래 이름을 재현한다.
function resolveTranscriptDir(override) {
  if (override) return override;
  const mangled = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', mangled);
}

// 목적: 마크다운 표 한 칸에 안전하게 들어가는 한 줄짜리 문자열로 만든다.
// 이유: 프롬프트 원문에는 줄바꿈과 '|'가 흔하고, 둘 다 그대로 넣으면 표 구조 자체가 깨진다.
// 방법: 개행·탭을 공백으로 접고, '|'를 이스케이프하고, 공백을 정리한 뒤 한도를 넘으면 말줄임한다.
function toCell(text, limit) {
  const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// 목적: 첫 사용자 메시지에서 IDE가 끼워 넣은 컨텍스트 블록을 걷어낸다.
// 이유: 실제로 사람이 친 첫 문장 앞에 <ide_opened_file> 같은 자동 삽입 블록이 붙는 경우가 있어, 그대로 두면 제목 칸이 사람이 읽을 수 없는 값이 된다.
// 방법: 알려진 래퍼 태그 블록을 제거하고, 남은 텍스트가 비면 원문을 그대로 돌려준다.
function stripInjectedBlocks(text) {
  const cleaned = text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, ' ')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, ' ')
    .replace(/<ide_diagnostics>[\s\S]*?<\/ide_diagnostics>/g, ' ')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<local-command-[\s\S]*?>[\s\S]*?<\/local-command-[\s\S]*?>/g, ' ')
    .trim();
  return cleaned === '' ? text : cleaned;
}

// 목적: 트랜스크립트 한 개에서 세션의 최초 생성 시각·브랜치·제목·첫 메시지를 뽑아낸다.
// 이유: 이 네 가지가 세션을 나중에 시간순·내용순으로 정리하는 데 필요한 전부이고, 모두 이 파일 안에 이미 들어 있다.
// 방법: 한 줄씩 JSON으로 읽어 첫 human 발화에서 시각·브랜치·본문을 한 번만 잡고, 제목은 마지막 값이 최신이므로 끝까지 훑어 갱신한다.
function readSession(filePath, sessionId) {
  let firstTimestamp = null;
  let firstMessage = null;
  let branch = null;
  let aiTitle = null;
  let customTitle = null;

  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'ai-title' && entry.aiTitle) aiTitle = entry.aiTitle;
    if (entry.type === 'custom-title' && entry.customTitle) customTitle = entry.customTitle;

    if (entry.type !== 'user' || firstMessage !== null) continue;
    if (!entry.origin || entry.origin.kind !== 'human') continue;

    const content = entry.message && entry.message.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? (content.find((part) => part.type === 'text') || {}).text
          : null;
    if (typeof text !== 'string' || text.trim() === '') continue;

    firstMessage = stripInjectedBlocks(text);
    firstTimestamp = entry.timestamp || null;
    branch = entry.gitBranch || null;
  }

  if (!firstTimestamp || !firstMessage) return null;
  return {
    sessionId,
    firstTimestamp,
    branch: branch || 'unknown',
    title: customTitle || aiTitle || '',
    firstMessage,
  };
}

// 목적: 수집한 세션들을 최초 생성 시각 순으로 정렬해 마크다운 문서 한 벌로 만든다.
// 이유: 이 문서의 목적 자체가 "언제 시작해 무슨 이야기를 한 세션인지"를 한눈에 훑는 것이라, 정렬 축은 생성 시각이어야 한다.
// 방법: 언어별 머리말을 받아 같은 표 본문에 붙여 EN/KO 두 문서가 구조적으로 어긋나지 않게 한다.
function renderDocument(header, columns, sessions) {
  const rows = sessions.map(
    (s) =>
      `| ${s.firstTimestamp} | ${s.sessionId} | ${s.branch} | ${toCell(s.title, TITLE_LIMIT)} | ${toCell(s.firstMessage, MESSAGE_LIMIT)} |`,
  );
  return [header, columns, '|---|---|---|---|---|', ...rows, ''].join('\n');
}

const transcriptDir = resolveTranscriptDir(process.argv[2]);
if (!fs.existsSync(transcriptDir)) {
  console.error(`Transcript directory not found: ${transcriptDir}`);
  process.exit(1);
}

const sessions = [];
for (const name of fs.readdirSync(transcriptDir)) {
  if (!name.endsWith('.jsonl')) continue;
  const session = readSession(path.join(transcriptDir, name), name.slice(0, -'.jsonl'.length));
  if (session) sessions.push(session);
}
sessions.sort((a, b) => a.firstTimestamp.localeCompare(b.firstTimestamp));

const generatedAt = new Date().toISOString();

const englishHeader = `# Session Log

> 한국어 버전: [SESSION-LOG.ko.md](SESSION-LOG.ko.md)

This file is gitignored — it exists only on this machine and is never committed or
shared. It is **generated**, not hand-written: run
\`node .claude/scripts/rebuild-session-log.js\` from the repo root to refresh it, and
edit that script rather than this table if a row looks wrong.

One row per session, ordered by when the session was **first created**. Every field is
read back out of Claude Code's own transcript for that session
(\`~/.claude/projects/<project>/<session_id>.jsonl\`), which is why this covers sessions
that predate any logging hook: the first \`human\` entry supplies the creation timestamp,
the branch, and the first message, while \`custom-title\`/\`ai-title\` entries supply the
session title (a custom title wins over the generated one). Resuming a session does not
add a row — a session appears exactly once, under the moment it began.

Last generated: ${generatedAt} · ${sessions.length} sessions
`;

const koreanHeader = `# 세션 로그

> English version: [SESSION-LOG.md](SESSION-LOG.md)

이 파일은 gitignore 대상이다 — 이 컴퓨터에만 존재하고 커밋되거나 공유되지 않는다.
손으로 쓰는 문서가 아니라 **생성물**이다: 저장소 루트에서
\`node .claude/scripts/rebuild-session-log.js\`를 실행하면 갱신되고, 특정 행이 이상하면
이 표가 아니라 그 스크립트를 고친다.

세션당 한 행이며, **최초 생성 시각** 순으로 정렬한다. 모든 값은 해당 세션의 Claude Code
트랜스크립트(\`~/.claude/projects/<프로젝트>/<session_id>.jsonl\`)에서 다시 읽어온 것이다 —
로깅 훅이 생기기 전의 세션까지 담기는 이유가 여기 있다. 첫 \`human\` 항목에서 생성 시각·
브랜치·첫 메시지를 얻고, 세션 제목은 \`custom-title\`/\`ai-title\` 항목에서 가져온다(직접 지정한
제목이 자동 생성 제목보다 우선). 세션을 재개해도 행이 늘지 않는다 — 한 세션은 시작된 시점
아래에 정확히 한 번만 나타난다.

마지막 생성: ${generatedAt} · 세션 ${sessions.length}개
`;

const docsDir = path.join(process.cwd(), 'docs');
fs.writeFileSync(
  path.join(docsDir, 'SESSION-LOG.md'),
  renderDocument(
    englishHeader,
    '| First Created (UTC) | Session ID | Branch | Title | First Message |',
    sessions,
  ),
);
fs.writeFileSync(
  path.join(docsDir, 'SESSION-LOG.ko.md'),
  renderDocument(
    koreanHeader,
    '| 최초 생성 (UTC) | 세션 ID | 브랜치 | 제목 | 첫 메시지 |',
    sessions,
  ),
);

console.log(`Wrote ${sessions.length} sessions to docs/SESSION-LOG.md (+ .ko.md)`);
