// 목적: 게시글에 새 댓글을 생성한다.
// 사용처: PostDetailPage 내부 CommentThread 아래에 렌더링된다; 제출 성공 시 onCreated()를 호출해
//   스레드를 다시 불러온다.
// 근거: 댓글은 자연스러운 idempotency 키가 없다(ADR 0023 D1) — 동일한 재제출은 설계상 두 번째
//   댓글을 만든다. 그래서 이 폼은 흔한 더블클릭 케이스만 제출 중 버튼을 비활성화해 막아둘 뿐,
//   그보다 강한 방지는 백엔드가 결정할 일이다.

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
