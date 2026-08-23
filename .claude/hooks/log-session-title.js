// Purpose: fills the empty title cell of a session's newest docs/SESSION-LOG.md row with an excerpt of a user prompt.
// Usage: invoked by the UserPromptSubmit hook in .claude/settings.json.
// Rationale: SessionStart fires before any prompt exists, so it cannot capture what a session is about; this hook
// fills that gap so the log is sortable by content, not only by an opaque session id. Two failures were diagnosed
// on 2026-08-20 by dumping a live hook payload rather than guessing its shape: the payload carries no `turn_number`
// field at all (so the original `turn_number === 1` gate always exited), and the prompt arrives as `prompt`, not
// `user_prompt`. It only ever writes to a session's *newest* row, because scanning back for any older empty row
// let a later prompt backfill a much earlier row and misdate it.

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
  const prompt = input.prompt;
  if (!sessionId || typeof prompt !== 'string') {
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

  // Find this session's newest row, then fill it only if its title is still empty. Anchoring
  // to the newest row (rather than the newest *empty* one) is what keeps a title on the row
  // whose timestamp it actually belongs to: an already-titled newest row means this session
  // has been titled, so any older empty row is a past run that must stay untouched.
  const rowPattern = /^\| (.+?) \| (.+?) \| (.+?) \|(.*)\|$/;
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(rowPattern);
    if (!match || match[2] !== sessionId) {
      continue;
    }
    if (match[4].trim() === '') {
      lines[i] = `| ${match[1]} | ${match[2]} | ${match[3]} | ${title} |`;
      fs.writeFileSync(logPath, lines.join('\n'));

      // Announce only on an actual write. Staying silent on the far more common no-op
      // (the row already has a title) keeps this off every turn, but leaves the one
      // event worth seeing visible — the hook's silence is what hid its failure before.
      console.log(
        JSON.stringify({ systemMessage: `Session title recorded: "${title}" -> docs/SESSION-LOG.md` }),
      );
    }
    break;
  }
});
