// 목적: migration:generate 실행 전에 명시적 승인 프롬프트를 강제한다.
// 사용처: .claude/settings.json의 PreToolUse/Bash 훅에서 호출된다.
// 근거: CLAUDE.md의 Scope Discipline은 실행 전에 엔티티 변경에 대한 사전 평문 설명과 generate
// 출력에 대한 한 줄씩의 검토를 요구한다 — 이는 모델이 기억하는지와 무관하게 그 규칙을 강제하는
// 결정적(deterministic) backstop이다.

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
