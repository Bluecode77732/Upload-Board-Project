// Purpose: the authenticated landing page — proves a protected GET works end to end (lists files).
// Usage: rendered at / behind RequireAuth.
// Rationale: a minimal protected read exercises the Bearer header + transparent-refresh path; the file
//   board UI proper is later work — this is the vertical slice's "you are logged in and calls succeed".

import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { FileResponse } from '../../api/types'
import { useAuth } from '../../auth/useAuth'

export function DashboardPage() {
  const { signOut } = useAuth()
  const [files, setFiles] = useState<FileResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<FileResponse[]>('/file?take=20&skip=0')
      .then(setFiles)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load files.'),
      )
  }, [])

  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Upload Board</h1>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {files === null && !error && <p>Loading files…</p>}
      {files && files.length === 0 && <p>No files yet.</p>}
      {files && files.length > 0 && (
        <ul>
          {files.map((file) => (
            <li key={file.id}>{file.title}</li>
          ))}
        </ul>
      )}
    </main>
  )
}
