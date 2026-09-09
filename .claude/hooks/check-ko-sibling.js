// 목적: Markdown 파일의 .ko.md 형제 문서를 같은 변경 안에서 갱신하도록 Claude에게 상기시킨다.
// 사용처: .claude/settings.json의 PostToolUse/Edit|Write 훅에서 호출된다.
// 근거: CLAUDE.md의 Documentation Convention은 추적되는 모든 문서가 같은 변경 안에서 .ko.md
// 형제 문서를 동기화하도록 요구한다; 매 수정마다 모델이 이 규칙을 기억하는 데 의존하는 대신
// 이 알림을 자동으로 띄운다.

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
