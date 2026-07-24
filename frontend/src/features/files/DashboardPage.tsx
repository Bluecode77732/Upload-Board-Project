// Purpose: the authenticated landing page — lists files and hosts the two-phase upload form.
// Usage: rendered at / behind RequireAuth.
// Rationale: a protected GET exercises the Bearer header + transparent-refresh path; the upload form
//   beside it makes this the app's first write path, refreshing the list on a successful promotion.

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { FileListResponse, FileResponse } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { UploadForm } from './UploadForm'

export function DashboardPage() {
  const { signOut } = useAuth()
  const [files, setFiles] = useState<FileResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadFiles = useCallback(() => {
    // GET /file returns a [rows, total] tuple (getManyAndCount), not a bare array.
    api
      .get<FileListResponse>('/file?take=20&skip=0')
      .then(([rows]) => {
        setFiles(rows)
        setError(null)
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load files.'),
      )
  }, [])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Upload Board</h1>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <UploadForm onUploaded={loadFiles} />
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
