// Purpose: creates a new comment on a post.
// Usage: rendered inside PostDetailPage below CommentThread; calls onCreated() so the thread
//   refetches after a successful submit.
// Rationale: a comment has no natural idempotency key (ADR 0023 D1) — an identical resubmit
//   creates a second comment by design, so this form only guards the common double-click case
//   by disabling the button while a submit is in flight; anything stronger is a backend decision.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { CommentResponse, CreateCommentRequest } from '../../api/types'
import styles from './CommentForm.module.css'

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_NOT_FOUND:
        return 'Post not found.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return 'Failed to post the comment.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function CommentForm({ postId, onCreated }: { postId: number; onCreated: () => void }) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const request: CreateCommentRequest = { body }
      await api.post<CommentResponse>(`/post/${postId}/comment`, request)
      setBody('')
      onCreated()
    } catch (err) {
      setError(messageForError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <textarea
        className={styles.textarea}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        rows={3}
        required
        disabled={busy}
        placeholder="Write a comment…"
      />
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? 'Posting…' : 'Post comment'}
      </button>
    </form>
  )
}
