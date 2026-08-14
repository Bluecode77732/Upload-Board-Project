// Purpose: the file board screen — hosts the two-phase upload form and the file board.
// Usage: rendered at /files behind RequireAuth.
// Rationale: the upload form and the searchable/sortable/paginated file board (FileBoard) are two
//   concerns of one screen; a successful upload bumps refreshSignal so the board re-runs its own query.

import { useState } from 'react'
import { NavBar } from '../../shared/NavBar'
import { FileBoard } from './FileBoard'
import { UploadForm } from './UploadForm'
import styles from './DashboardPage.module.css'

export function DashboardPage() {
  // Has no meaning of its own — FileBoard only uses a change in this value as a signal to
  // re-fetch its current query; the upload form doesn't know or care what that query is.
  const [refreshSignal, setRefreshSignal] = useState(0)

  return (
    <main className={styles.page}>
      <NavBar />
      <h1>Files</h1>
      <UploadForm onUploaded={() => setRefreshSignal((n) => n + 1)} />
      <FileBoard refreshSignal={refreshSignal} />
    </main>
  )
}
