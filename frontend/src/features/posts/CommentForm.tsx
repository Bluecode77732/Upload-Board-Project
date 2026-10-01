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
import { useLanguage } from '../../i18n/useLanguage'
import type { Translatable } from '../../i18n/messages'
import styles from './CommentForm.module.css'

// 목적: 댓글 생성 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
//       VALIDATION_FAILED만은 서버가 준 문구 그대로를 보여줘야 해서 { raw }로 감싼다.
// 방법: ApiError의 고정 code로 switch해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_NOT_FOUND:
        return 'common.postNotFound'
      case ErrorCode.VALIDATION_FAILED:
        return { raw: Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message }
      default:
        return 'comment.err.postFailed'
    }
  }
  return 'common.networkError'
}

export function CommentForm({ postId, onCreated }: { postId: number; onCreated: () => void }) {
  const { t } = useLanguage()
  const [body, setBody] = useState('')
  const [error, setError] = useState<Translatable | null>(null)
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
        placeholder={t('comment.placeholder')}
      />
      {error && <p className={styles.error}>{t(error)}</p>}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? t('common.posting') : t('comment.submit')}
      </button>
    </form>
  )
}
