// Purpose: the authenticated landing page — hosts the two-phase upload form and the file board.
// Usage: rendered at / behind RequireAuth.
// Rationale: the upload form and the searchable/sortable/paginated file board (FileBoard) are two
//   concerns of one screen; a successful upload bumps refreshSignal so the board re-runs its own query.

import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { FileBoard } from './FileBoard'
import { UploadForm } from './UploadForm'

export function DashboardPage() {
  const { signOut } = useAuth()
  // Has no meaning of its own — FileBoard only uses a change in this value as a signal to
  // re-fetch its current query; the upload form doesn't know or care what that query is.
  const [refreshSignal, setRefreshSignal] = useState(0)

  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Upload Board</h1>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <UploadForm onUploaded={() => setRefreshSignal((n) => n + 1)} />
      <FileBoard refreshSignal={refreshSignal} />
    </main>
  )
}
