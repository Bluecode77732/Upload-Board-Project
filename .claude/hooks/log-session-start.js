// Purpose: appends a session-start record (timestamp, session id, git branch) to docs/SESSION-LOG.md.
// Usage: invoked by the SessionStart/startup hook in .claude/settings.json.
// Rationale: nothing in this repo traced which branch/timestamp each past session began on; this hook builds that audit trail automatically instead of relying on manual notes.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  const sessionId = input.session_id || 'unknown';
  const logPath = path.join(cwd, 'docs', 'SESSION-LOG.md');
  if (!fs.existsSync(logPath)) {
    process.exit(0);
  }

  let branch = 'unknown';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    // not a git repo, or git unavailable — keep 'unknown'
  }

  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `| ${timestamp} | ${sessionId} | ${branch} |\n`);

  const message = `Session logged: ${timestamp} on branch '${branch}' -> docs/SESSION-LOG.md`;
  console.log(
    JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
    }),
  );
});
