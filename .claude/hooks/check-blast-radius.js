// Purpose: forces an explicit-approval prompt before edits to CLAUDE.md's high-blast-radius files.
// Usage: invoked by the PreToolUse/Edit|Write hook in .claude/settings.json.
// Rationale: app.module.ts/main.ts/*.entity.ts changes radiate repo-wide (Scope Discipline);
// Auto Mode's bias toward proceeding without asking makes a model-memory-only safeguard
// unreliable, so this adds a deterministic backstop independent of the model remembering.

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

  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath) process.exit(0);

  const base = path.basename(filePath);
  const isHighBlastRadius = base === 'app.module.ts' || base === 'main.ts' || base.endsWith('.entity.ts');
  if (!isHighBlastRadius) process.exit(0);

  const reason = `CLAUDE.md Scope Discipline: ${base} is a high-blast-radius file (app.module.ts wires every module + the DB connection, main.ts is the global bootstrap/ValidationPipe/CORS, *.entity.ts defines the DB schema itself) — requires explicit approval before any edit.`;

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
