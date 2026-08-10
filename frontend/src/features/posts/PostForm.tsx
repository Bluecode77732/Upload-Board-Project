// Purpose: creates a new board post — title, body, and an optional attached file.
// Usage: rendered inside PostBoard; calls onCreated() so the list refreshes after a successful submit.
// Rationale: mirrors UploadForm's write-then-reset shape; a 200 replay and a 201 fresh post are handled
//   identically here (ADR 0023 D1) — the status code is not a UI concern.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { CreatePostRequest, PostResponse } from '../../api/types'
import { FilePicker } from './FilePicker'

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_FILE_TAKEN:
        return '이 파일은 이미 다른 글에 첨부되어 있습니다.'
      case ErrorCode.FILE_NOT_FOUND:
        return '선택한 파일을 찾을 수 없습니다.'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return '본인이 올린 파일만 첨부할 수 있습니다.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return 'Failed to create the post. Please try again.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function PostForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [fileId, setFileId] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const request: CreatePostRequest = { title, body, ...(fileId !== undefined ? { fileId } : {}) }
      await api.post<PostResponse>('/post', request)
      setTitle('')
      setBody('')
      setFileId(undefined)
      onCreated()
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
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>New post</h2>
      <label style={{ display: 'grid', gap: 4 }}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required disabled={busy} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        Body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          rows={4}
          required
          disabled={busy}
        />
      </label>
      <FilePicker value={fileId} onChange={setFileId} disabled={busy} />
      {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Posting…' : 'Post'}
      </button>
    </form>
  )
}
