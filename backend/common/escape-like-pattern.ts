// Purpose: makes LIKE/ILIKE metacharacters in a user-supplied search term match literally.
// Usage: imported by FileService.getFiles and PostService.getPosts before building an ILIKE pattern.
// Rationale: the post listing extends the ADR 0021 read layer rather than restating it (ADR 0023), and a second copy of this escaping is exactly the kind of drift that silently widens one endpoint's matches.

// 목적: 검색어에 든 LIKE 메타문자를 리터럴로 만든다.
// 이유: 값은 파라미터로 바인딩되어 주입 위험은 없지만, 이스케이프하지 않은 %나 _는 사용자가 입력한
//       것보다 훨씬 넓은 범위를 조용히 매칭시킨다(예: '_' 하나가 임의의 한 글자가 된다).
// 방법: 이스케이프 문자 자신(\)까지 포함해 \, %, _ 앞에 \를 붙인다 — 쿼리는 ESCAPE '\'를 명시한다.
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}
