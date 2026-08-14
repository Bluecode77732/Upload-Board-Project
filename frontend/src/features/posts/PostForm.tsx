// Purpose: creates a new board post — title, body, and an optional attached file.
// Usage: rendered inside PostBoard; calls onCreated() so the list refreshes after a successful submit.
// Rationale: mirrors UploadForm's write-then-reset shape; a 200 replay and a 201 fresh post are handled
//   identically here (ADR 0023 D1) — the status code is not a UI concern.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { CreatePostRequest, PostResponse } from '../../api/types'
import { FilePicker } from './FilePicker'
import styles from './PostForm.module.css'

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_FILE_TAKEN:
        return 'That file is already attached to another post.'
      case ErrorCode.FILE_NOT_FOUND:
        return 'The selected file could not be found.'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'You can only attach files you uploaded yourself.'
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
    <form onSubmit={onSubmit} className={styles.form}>
      <h2 className={styles.heading}>New post</h2>
      <label className={styles.field}>
        Title
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          required
          disabled={busy}
        />
      </label>
      <label className={styles.field}>
        Body
        <textarea
          className={styles.textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          rows={4}
          required
          disabled={busy}
        />
      </label>
      <FilePicker value={fileId} onChange={setFileId} disabled={busy} />
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? 'Posting…' : 'Post'}
      </button>
    </form>
  )
}
