// Purpose: lets a post author pick one of their own files to attach to a new post, or none.
// Usage: rendered inside PostForm; reports the chosen fileId via onChange for the POST /post body.
// Rationale: there is no "my unclaimed files" endpoint — GET /file?creatorId=<me> is reused (the
//   same query FileBoard already consumes), and the server alone enforces the unclaimed invariant
//   (409 POST_FILE_TAKEN on submit) since FileResponse carries no back-reference to a post.

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { FileListResponse, FileResponse } from '../../api/types'
import { useAuth } from '../../auth/useAuth'

const TAKE = 50

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_FAILED:
        return 'Invalid search value.'
      default:
        return 'Failed to load your files.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function FilePicker({
  value,
  onChange,
  disabled,
}: {
  value: number | undefined
  onChange: (fileId: number | undefined) => void
  disabled?: boolean
}) {
  const { currentUserId } = useAuth()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [files, setFiles] = useState<FileResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Debounce the free-text search so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  const loadFiles = useCallback(() => {
    if (currentUserId === null) return
    const params = new URLSearchParams()
    params.set('take', String(TAKE))
    params.set('creatorId', String(currentUserId))
    if (debouncedSearch) params.set('search', debouncedSearch)

    api
      .get<FileListResponse>(`/file?${params.toString()}`)
      .then(([rows]) => {
        setFiles(rows)
        setError(null)
      })
      .catch((err: unknown) => setError(messageForError(err)))
  }, [currentUserId, debouncedSearch])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        Attach a file (optional)
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={100}
          placeholder="Search your files…"
          disabled={disabled}
        />
      </label>
      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      {files === null && !error && <p style={{ margin: 0, color: '#555' }}>Loading your files…</p>}
      <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 6, padding: 8 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name="filePicker"
            checked={value === undefined}
            onChange={() => onChange(undefined)}
            disabled={disabled}
          />
          No file
        </label>
        {files && files.length === 0 && <p style={{ margin: '4px 0', color: '#555' }}>No files found.</p>}
        {files?.map((file) => (
          <label key={file.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="radio"
              name="filePicker"
              checked={value === file.id}
              onChange={() => onChange(file.id)}
              disabled={disabled}
            />
            {file.title}
          </label>
        ))}
      </div>
    </div>
  )
}
