// Purpose: fills the empty title cell of a session's docs/SESSION-LOG.md row with an excerpt of a user prompt.
// Usage: invoked by the UserPromptSubmit hook in .claude/settings.json.
// Rationale: SessionStart fires before any prompt exists, so it cannot capture what a session is about; this hook
// fills that gap so the log is sortable by content, not only by an opaque session id. Originally gated on
// `turn_number === 1`, but live data (docs/SESSION-LOG.md, verified 2026-08-19) showed a resumed session's row stays
// empty forever under that gate — a resume continues the same turn count instead of resetting it, so its first
// post-resume prompt is never turn 1. Gating on "does this session_id still have an empty-title row" instead fixes
// both cases: it fills on a fresh session's actual first prompt, and on a resumed session's first prompt after the
// new row appears, while still writing at most once per row (a filled row no longer matches the empty-title regex).

const fs = require('fs');
const path = require('path');

let data = '';
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(data);
  } catch {
    process.exit(0);
  }

  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id;
  const prompt = input.user_prompt;
  if (!sessionId || !prompt) {
    process.exit(0);
  }

  const logPath = path.join(cwd, 'docs', 'SESSION-LOG.md');
  if (!fs.existsSync(logPath)) {
    process.exit(0);
  }

  const flattened = prompt.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  const title = flattened.length > 80 ? `${flattened.slice(0, 80)}…` : flattened;
  if (!title) {
    process.exit(0);
  }

  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  const emptyTitleRow = /^\| (.+?) \| (.+?) \| (.+?) \|\s*\|$/;
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(emptyTitleRow);
    if (match && match[2] === sessionId) {
      lines[i] = `| ${match[1]} | ${match[2]} | ${match[3]} | ${title} |`;
      fs.writeFileSync(logPath, lines.join('\n'));
      break;
    }
  }
});
