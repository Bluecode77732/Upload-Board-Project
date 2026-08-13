// Purpose: drives the backend's two-phase upload from the browser — POST /upload/attach (multipart)
//   then POST /file to promote the temp_ file into a permanent FileEntity row.
// Usage: rendered inside DashboardPage behind RequireAuth; calls onUploaded() so the list refreshes.
// Rationale: upload is the app's core write path and the first real consumer of the frozen temp_→granted_
//   contract; it lives beside the file list so a successful promotion reflects immediately.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { AttachResponse, FileResponse } from '../../api/types'

// Mirrors the backend's per-field allowlist (upload.controller.ts UPLOAD_ALLOWLIST, ADR 0027):
// exactly one of these three multipart fields, each with its own extensions/mimetypes, 100MB cap.
type UploadFieldType = 'image' | 'audio' | 'video'

const FIELD_CONFIG: Record<UploadFieldType, { label: string; accept: string; hint: string }> = {
  image: { label: 'Image', accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', hint: 'jpg, jpeg, png, webp' },
  audio: { label: 'Audio', accept: 'audio/mpeg,.mp3', hint: 'mp3' },
  video: { label: 'Video', accept: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm', hint: 'mp4, mov, webm' },
}

function messageForError(error: unknown, fieldType: UploadFieldType): string {
  if (error instanceof ApiError) {
    // Branch on the stable code, never the human-readable message (backend ADR 0011).
    switch (error.code) {
      case ErrorCode.UPLOAD_INVALID_TYPE:
        return `Only ${FIELD_CONFIG[fieldType].label.toLowerCase()} files are allowed (${FIELD_CONFIG[fieldType].hint}).`
      case ErrorCode.UPLOAD_FILE_REQUIRED:
        return `Please choose a ${FIELD_CONFIG[fieldType].label.toLowerCase()} file to upload.`
      case ErrorCode.UPLOAD_MULTIPLE_FIELDS:
        // Not reachable from this form (it always sends one field), but a real backend code (ADR 0025 D5).
        return 'Only one file may be attached at a time.'
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
        return 'Please enter a title and choose a file.'
      default:
        return 'Upload failed. Please try again.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [title, setTitle] = useState('')
  const [fieldType, setFieldType] = useState<UploadFieldType>('video')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Percent (0-100) of phase 1 (the attach upload) sent so far; null while idle or during
  // phase 2 (the small JSON promote call, which has no meaningful progress of its own).
  const [progress, setProgress] = useState<number | null>(null)

  function onFieldTypeChange(next: UploadFieldType) {
    setFieldType(next)
    setFile(null) // a file chosen for one type is not valid for another's allowlist
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!file) {
      setError(`Please choose a ${FIELD_CONFIG[fieldType].label.toLowerCase()} file to upload.`)
      return
    }
    setBusy(true)
    setProgress(0)
    try {
      // Phase 1: attach the physical file to file/temp — the browser sets the multipart boundary.
      // Uses the XHR-based wrapper (not api.postForm) so upload progress can be reported.
      const form = new FormData()
      form.append(fieldType, file)
      const { filename } = await api.postFormWithProgress<AttachResponse>(
        '/upload/attach',
        form,
        (loaded, total) => setProgress(Math.round((loaded / total) * 100)),
      )

      // Phase 2: promote the temp_ file into a permanent FileEntity row.
      setProgress(null)
      await api.post<FileResponse>('/file', { title, filePath: filename })

      setTitle('')
      setFile(null)
      onUploaded()
    } catch (err) {
      setError(messageForError(err, fieldType))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: 12, margin: '16px 0', padding: 16, border: '1px solid #ddd', borderRadius: 8 }}
    >
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Upload a file</h2>
      <label style={{ display: 'grid', gap: 4 }}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <div style={{ display: 'flex', gap: 16 }}>
        {(Object.keys(FIELD_CONFIG) as UploadFieldType[]).map((type) => (
          <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              name="uploadFieldType"
              value={type}
              checked={fieldType === type}
              onChange={() => onFieldTypeChange(type)}
              disabled={busy}
            />
            {FIELD_CONFIG[type].label}
          </label>
        ))}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        {FIELD_CONFIG[fieldType].label} file ({FIELD_CONFIG[fieldType].hint} · max 100 MB)
        <input
          type="file"
          accept={FIELD_CONFIG[fieldType].accept}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </label>
      {progress !== null && (
        <div style={{ display: 'grid', gap: 4 }}>
          <progress value={progress} max={100} style={{ width: '100%' }} />
          <span style={{ fontSize: '0.85rem', color: '#555' }}>{progress}%</span>
        </div>
      )}
      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  )
}
