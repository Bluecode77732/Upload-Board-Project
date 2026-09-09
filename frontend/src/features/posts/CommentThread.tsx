// 목적: 게시글 하나의 댓글 스레드를 보여주고, 댓글 작성자(또는 서버가 판정하는 admin)가
//   수정/삭제할 수 있게 한다.
// 사용처: PostDetailPage 내부에 렌더링된다; refreshSignal이 올라가면(예: CommentForm이 댓글을
//   생성한 뒤) 첫 페이지를 새로 불러온다 — 게시글에 대한 PostBoard의 refreshSignal과 같은 패턴.
// 근거: 백엔드가 스레드 순서를 정렬 파라미터 없이 createdAt ASC로 고정하고(ADR 0023) 실시간/
//   폴링 인프라도 없어서, 페이징은 PostBoard/FileBoard가 최신순 목록에 쓰는 이전/다음 페이저가
//   아니라 이어붙이는 수동 "더 보기" 방식이다.

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { CommentListResponse, CommentResponse, UpdateCommentRequest } from '../../api/types'
import styles from './CommentThread.module.css'

const TAKE = 20

// 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011).
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_NOT_FOUND:
        return 'Post not found.'
      default:
        return 'Failed to load comments.'
    }
  }
  return 'Network error. Is the backend running?'
}

// 수정/삭제의 에러는 목록 조회와는 다른 코드 집합으로 분기한다.
function messageForActionError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.COMMENT_NOT_FOUND:
        return 'Comment not found.'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'Only the author or an admin can do this.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return 'The action failed.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function CommentThread({
  postId,
  currentUserId,
  refreshSignal,
}: {
  postId: number
  currentUserId: number | null
  refreshSignal: number
}) {
  const [comments, setComments] = useState<CommentResponse[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const fetchPage = useCallback(
    (skip: number, replace: boolean) => {
      const params = new URLSearchParams()
      params.set('take', String(TAKE))
      params.set('skip', String(skip))
      return api
        .get<CommentListResponse>(`/post/${postId}/comment?${params.toString()}`)
        .then(([rows, totalCount]) => {
          setComments((prev) => (replace || prev === null ? rows : [...prev, ...rows]))
          setTotal(totalCount)
          setError(null)
        })
        .catch((err: unknown) => setError(messageForError(err)))
    },
    [postId],
  )

  // postId가 바뀌거나 CommentForm 제출 성공 후 값이 올라가면 첫 페이지를 다시 불러온다.
  useEffect(() => {
    setComments(null)
    void fetchPage(0, true)
  }, [fetchPage, refreshSignal])

  function loadMore() {
    if (!comments) return
    setLoadingMore(true)
    fetchPage(comments.length, false).finally(() => setLoadingMore(false))
  }

  function startEdit(comment: CommentResponse) {
    setActionError(null)
    setEditingId(comment.id)
    setEditBody(comment.body)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBody('')
  }

  // 목적: 본인 댓글의 본문을 수정한다.
  // 이유: 서버가 작성자/admin 여부를 최종 판정하므로, 프론트는 응답으로 받은 최신 상태로만 목록을 갱신한다.
  // 방법: PATCH /comment/:id { body } → 성공 시 로컬 목록에서 해당 댓글만 교체하고 편집 모드를 닫는다.
  function submitEdit(id: number) {
    setActionError(null)
    setBusyId(id)
    const request: UpdateCommentRequest = { body: editBody }
    api
      .patch<CommentResponse>(`/comment/${id}`, request)
      .then((updated) => {
        setComments((prev) => prev?.map((c) => (c.id === id ? updated : c)) ?? prev)
        setEditingId(null)
        setEditBody('')
      })
      .catch((err: unknown) => setActionError(messageForActionError(err)))
      .finally(() => setBusyId(null))
  }

  // 목적: 본인 댓글을 삭제한다.
  // 이유: 하드 삭제는 비가역이므로(ADR 0020) 확인 대화상자를 거친다.
  // 방법: DELETE /comment/:id → 성공 시 로컬 목록에서 제거하고 총 개수를 1 줄인다.
  function deleteComment(id: number) {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return
    setActionError(null)
    setBusyId(id)
    api
      .delete(`/comment/${id}`)
      .then(() => {
        setComments((prev) => prev?.filter((c) => c.id !== id) ?? prev)
        setTotal((t) => Math.max(0, t - 1))
      })
      .catch((err: unknown) => setActionError(messageForActionError(err)))
      .finally(() => setBusyId(null))
  }

  const canLoadMore = comments !== null && comments.length < total

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Comments {total > 0 ? `(${total})` : ''}</h2>
      {error && <p className={styles.error}>{error}</p>}
      {actionError && <p className={styles.error}>{actionError}</p>}
      {comments === null && !error && <p>Loading comments…</p>}
      {comments && comments.length === 0 && <p className={styles.empty}>No comments yet.</p>}
      {comments && comments.length > 0 && (
        <ul className={styles.list}>
          {comments.map((comment) => {
            const canManage = currentUserId !== null && comment.creator?.id === currentUserId
            const busy = busyId === comment.id
            return (
              <li key={comment.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span>{comment.creator?.email ?? 'unknown'}</span>
                  <span>{new Date(comment.createdAt).toLocaleString()}</span>
                </div>
                {editingId === comment.id ? (
                  <div className={styles.editBox}>
                    <textarea
                      className={styles.textarea}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      maxLength={1000}
                      rows={3}
                      disabled={busy}
                    />
                    <div className={styles.actions}>
                      <button type="button" className={styles.button} disabled={busy} onClick={() => submitEdit(comment.id)}>
                        Save
                      </button>
                      <button type="button" className={styles.button} disabled={busy} onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className={styles.commentBody}>{comment.body}</p>
                    {canManage && (
                      <div className={styles.actions}>
                        <button type="button" className={styles.button} disabled={busy} onClick={() => startEdit(comment)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          disabled={busy}
                          onClick={() => deleteComment(comment.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canLoadMore && (
        <button type="button" className={styles.loadMoreButton} disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  )
}
