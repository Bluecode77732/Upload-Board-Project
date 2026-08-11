// Purpose: shows one post's comment thread and lets the author of a comment (or an admin,
//   server-enforced) edit or delete it.
// Usage: rendered inside PostDetailPage; refreshSignal bumps trigger a fresh first page (e.g.
//   after CommentForm creates a comment) the same way PostBoard's refreshSignal does for posts.
// Rationale: the backend fixes thread order at createdAt ASC with no sort params (ADR 0023) and
//   there is no realtime/polling infrastructure, so paging is a manual "load more" that appends
//   rather than a prev/next pager like PostBoard/FileBoard use for their newest-first lists.

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { CommentListResponse, CommentResponse, UpdateCommentRequest } from '../../api/types'

const TAKE = 20

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_NOT_FOUND:
        return '게시글을 찾을 수 없습니다.'
      default:
        return '댓글을 불러오지 못했습니다.'
    }
  }
  return 'Network error. Is the backend running?'
}

// Errors from edit/delete branch on a different set of codes than the list load.
function messageForActionError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.COMMENT_NOT_FOUND:
        return '댓글을 찾을 수 없습니다.'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return '작성자 또는 관리자만 가능합니다.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return '작업에 실패했습니다.'
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

  // A fresh postId, or a bump from CommentForm after a successful submit, reloads the first page.
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
    if (!window.confirm('댓글을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return
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
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: '1.1rem' }}>댓글 {total > 0 ? `(${total})` : ''}</h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {actionError && <p style={{ color: 'crimson' }}>{actionError}</p>}
      {comments === null && !error && <p>댓글을 불러오는 중…</p>}
      {comments && comments.length === 0 && <p style={{ color: '#555' }}>아직 댓글이 없습니다.</p>}
      {comments && comments.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {comments.map((comment) => {
            const canManage = currentUserId !== null && comment.creator?.id === currentUserId
            const busy = busyId === comment.id
            return (
              <li key={comment.id} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555', fontSize: '0.85rem' }}>
                  <span>{comment.creator?.email ?? 'unknown'}</span>
                  <span>{new Date(comment.createdAt).toLocaleString()}</span>
                </div>
                {editingId === comment.id ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      maxLength={1000}
                      rows={3}
                      disabled={busy}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" disabled={busy} onClick={() => submitEdit(comment.id)}>
                        저장
                      </button>
                      <button type="button" disabled={busy} onClick={cancelEdit}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{comment.body}</p>
                    {canManage && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" disabled={busy} onClick={() => startEdit(comment)}>
                          수정
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => deleteComment(comment.id)}
                          style={{ color: 'crimson' }}
                        >
                          삭제
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
        <button type="button" disabled={loadingMore} onClick={loadMore} style={{ marginTop: 12 }}>
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </section>
  )
}
