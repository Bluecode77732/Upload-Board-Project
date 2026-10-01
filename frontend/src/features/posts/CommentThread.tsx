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
import { useLanguage } from '../../i18n/useLanguage'
import type { Translatable } from '../../i18n/messages'
import styles from './CommentThread.module.css'

const TAKE = 20

// 목적: 댓글 목록 조회 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_NOT_FOUND:
        return 'common.postNotFound'
      default:
        return 'comment.err.loadFailed'
    }
  }
  return 'common.networkError'
}

// 목적: 댓글 수정/삭제 실패 응답을 화면에 보여줄 메시지 키로 바꾼다(목록 조회와는 다른 코드 집합).
// 이유: messageForError와 같다 — 번역된 문자열이 아니라 키(또는 서버가 준 raw 문구)를 돌려준다.
// 방법: ApiError의 고정 code로 switch해 키를 고르고, VALIDATION_FAILED만 서버 문구를 { raw }로 감싼다.
function messageForActionError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.COMMENT_NOT_FOUND:
        return 'comment.err.notFound'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'common.onlyAuthorOrAdmin'
      case ErrorCode.VALIDATION_FAILED:
        return { raw: Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message }
      default:
        return 'common.actionFailed'
    }
  }
  return 'common.networkError'
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
  const { language, t } = useLanguage()
  const [comments, setComments] = useState<CommentResponse[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<Translatable | null>(null)
  const [actionError, setActionError] = useState<Translatable | null>(null)
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
    if (!window.confirm(t('comment.confirmDelete'))) return
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
      <h2 className={styles.heading}>
        {t('comment.heading')} {total > 0 ? `(${total})` : ''}
      </h2>
      {error && <p className={styles.error}>{t(error)}</p>}
      {actionError && <p className={styles.error}>{t(actionError)}</p>}
      {comments === null && !error && <p>{t('common.loading')}</p>}
      {comments && comments.length === 0 && <p className={styles.empty}>{t('comment.empty')}</p>}
      {comments && comments.length > 0 && (
        <ul className={styles.list}>
          {comments.map((comment) => {
            const canManage = currentUserId !== null && comment.creator?.id === currentUserId
            const busy = busyId === comment.id
            return (
              <li key={comment.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span>{comment.creator?.email ?? t('comment.unknownAuthor')}</span>
                  <span>{new Date(comment.createdAt).toLocaleString(language === 'ko' ? 'ko-KR' : undefined)}</span>
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
                        {t('common.save')}
                      </button>
                      <button type="button" className={styles.button} disabled={busy} onClick={cancelEdit}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className={styles.commentBody}>{comment.body}</p>
                    {canManage && (
                      <div className={styles.actions}>
                        <button type="button" className={styles.button} disabled={busy} onClick={() => startEdit(comment)}>
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          disabled={busy}
                          onClick={() => deleteComment(comment.id)}
                        >
                          {t('common.delete')}
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
          {loadingMore ? t('common.loading') : t('common.loadMore')}
        </button>
      )}
    </section>
  )
}
