// Purpose: forces an explicit-approval prompt before running migration:generate.
// Usage: invoked by the PreToolUse/Bash hook in .claude/settings.json.
// Rationale: CLAUDE.md Scope Discipline requires a prior plain-text description of the
// entity change and a line-by-line review of generate's output before running it — this
// is a deterministic backstop for that rule, independent of the model remembering.

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

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!command.includes('migration:generate')) process.exit(0);

  const reason =
    'CLAUDE.md Scope Discipline: migration:generate must not run without a prior plain-text ' +
    'description of the entity change already confirmed with the developer, and its output ' +
    'must be reviewed line-by-line before applying. Confirm both happened before proceeding.';

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
});
