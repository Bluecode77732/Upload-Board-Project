// Purpose: the new home screen — will list board posts (title/body + optional attached file).
// Usage: rendered at "/" behind RequireAuth; the listing UI lands in a follow-up task.
// Rationale: Posts is promoted to home now that backend Stage 3 (post/comment, ADR 0021/0023)
//   is complete; this file exists so App.tsx's route table is valid ahead of the real board UI.

import { NavBar } from '../../shared/NavBar'

export function PostBoard() {
  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <NavBar />
      <h1>Posts</h1>
      <p>Post board coming soon.</p>
    </main>
  )
}
