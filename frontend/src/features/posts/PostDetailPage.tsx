// Purpose: will show one post's body, its attached file (if any), and its comment thread.
// Usage: rendered at "/posts/:id" behind RequireAuth; the detail/comment UI lands in a
//   follow-up task.
// Rationale: reserves the route ahead of the real implementation so App.tsx's route table
//   is valid; the ":id" param is read here only to keep the placeholder honest about its shape.

import { useParams } from 'react-router-dom'
import { NavBar } from '../../shared/NavBar'

export function PostDetailPage() {
  const { id } = useParams()

  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <NavBar />
      <p>Post {id} detail coming soon.</p>
    </main>
  )
}
