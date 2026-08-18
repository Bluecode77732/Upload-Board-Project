// Purpose: reminds Claude to update a Markdown file's .ko.md sibling in the same change.
// Usage: invoked by the PostToolUse/Edit|Write hook in .claude/settings.json.
// Rationale: CLAUDE.md's Documentation Convention requires every tracked doc keep its
// .ko.md sibling in sync in the same change; this surfaces that reminder automatically
// instead of relying on the model remembering the prose rule on every edit.

const fs = require('fs');

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

  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath || filePath.endsWith('.ko.md') || !filePath.endsWith('.md')) {
    process.exit(0);
  }

  const siblingPath = filePath.slice(0, -'.md'.length) + '.ko.md';
  const exists = fs.existsSync(siblingPath);
  const message = exists
    ? `Documentation Convention: also update the .ko.md sibling (${siblingPath}) in this same change.`
    : `Documentation Convention: ${filePath} has no .ko.md sibling yet (${siblingPath}) — create one in this same change, or confirm this file is exempt.`;

  console.log(
    JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message },
    }),
  );
});
