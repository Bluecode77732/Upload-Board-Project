// 목적: CLAUDE.md의 고위험(high-blast-radius) 파일을 수정하기 전에 명시적 승인 프롬프트를 강제한다.
// 사용처: .claude/settings.json의 PreToolUse/Edit|Write 훅에서 호출된다.
// 근거: app.module.ts/main.ts/*.entity.ts 변경은 저장소 전체로 영향이 번진다(Scope Discipline) —
// Auto Mode는 묻지 않고 진행하는 쪽으로 기울어 있어서 모델 기억에만 의존하는 안전장치는 믿을 수 없다,
// 그래서 모델이 기억하는지와 무관하게 동작하는 결정적(deterministic) backstop을 추가한다.

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
