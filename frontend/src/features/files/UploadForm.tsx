// Purpose: drives the backend's two-phase upload from the browser — POST /upload/attach (multipart)
//   then POST /file to promote the temp_ file into a permanent FileEntity row.
// Usage: rendered inside DashboardPage behind RequireAuth; calls onUploaded() so the list refreshes.
// Rationale: upload is the app's core write path and the first real consumer of the frozen temp_→granted_
//   contract; it lives beside the file list so a successful promotion reflects immediately.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { AttachResponse, FileResponse } from '../../api/types'

// Mirrors the backend allowlist (upload.controller.ts): mp4/mov/webm, 100MB.
const ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm'

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    // Branch on the stable code, never the human-readable message (backend ADR 0011).
    switch (error.code) {
      case ErrorCode.UPLOAD_INVALID_TYPE:
        return 'Only video files are allowed (mp4, mov, webm).'
      case ErrorCode.UPLOAD_FILE_REQUIRED:
        return 'Please choose a video file to upload.'
      case ErrorCode.PAYLOAD_TOO_LARGE:
        return 'That file is too large — the limit is 100 MB.'
      case ErrorCode.FILE_TITLE_TAKEN:
        return 'A file with that title already exists — pick another.'
      case ErrorCode.FILE_INVALID_PATH:
        return 'Upload could not be completed — please try again.'
      case ErrorCode.FILE_ALREADY_CLAIMED:
        // The temp upload was already promoted by someone else (ADR 0019, 409).
        return 'That upload was already claimed — please attach the file again.'
      case ErrorCode.VALIDATION_FAILED:
        return 'Please enter a title and choose a video file.'
      default:
        return 'Upload failed. Please try again.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!file) {
      setError('Please choose a video file to upload.')
      return
    }
    setBusy(true)
    try {
      // Phase 1: attach the physical file to file/temp — the browser sets the multipart boundary.
      const form = new FormData()
      form.append('video', file)
      const { filename } = await api.postForm<AttachResponse>('/upload/attach', form)

      // Phase 2: promote the temp_ file into a permanent FileEntity row.
      await api.post<FileResponse>('/file', { title, filePath: filename })

      setTitle('')
      setFile(null)
      onUploaded()
    } catch (err) {
      setError(messageForError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: 12, margin: '16px 0', padding: 16, border: '1px solid #ddd', borderRadius: 8 }}
    >
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Upload a video</h2>
      <label style={{ display: 'grid', gap: 4 }}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        Video file (mp4, mov, webm · max 100 MB)
        <input
          type="file"
          accept={ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  )
}
