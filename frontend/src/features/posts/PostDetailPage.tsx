// Purpose: shows one post's body, its attached file (if any), and its comment thread.
// Usage: rendered at "/posts/:id" behind RequireAuth; links from PostBoard.
// Rationale: comment order is fixed createdAt ASC with no realtime infrastructure (ADR 0023,
//   no WebSocket in this project), so the thread refetches only on an explicit user action —
//   no polling. File playback follows FileDetailPage's visibility-gated access pattern
//   (FileDetailPage.tsx:81-116): a private file's bytes are fetched authenticated as a Blob,
//   public/unlisted stream directly via <video src>.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { PostResponse, UpdatePostRequest } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { NavBar } from '../../shared/NavBar'
import { CommentForm } from './CommentForm'
import { CommentThread } from './CommentThread'
import styles from './PostDetailPage.module.css'

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_NOT_FOUND:
        return '게시글을 찾을 수 없습니다.'
      default:
        return '게시글을 불러오지 못했습니다.'
    }
  }
  return 'Network error. Is the backend running?'
}

// Errors from the management actions (edit, delete) branch on a different set of codes
// than the read.
function messageForManageError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return '작성자 또는 관리자만 가능합니다.'
      case ErrorCode.POST_NOT_FOUND:
        return '게시글을 찾을 수 없습니다.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return '작업에 실패했습니다.'
    }
  }
  return 'Network error. Is the backend running?'
}

function messageForPlaybackError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FILE_NOT_FOUND:
        return '파일을 찾을 수 없습니다.'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return '이 파일을 볼 권한이 없습니다.'
      case ErrorCode.FILE_SHARE_INVALID:
        return '공유 링크가 없거나 유효하지 않습니다.'
      default:
        return '파일을 불러오지 못했습니다.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function PostDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUserId } = useAuth()
  const postId = id !== undefined && /^\d+$/.test(id) ? Number(id) : null

  const [post, setPost] = useState<PostResponse | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Has no meaning of its own — bumping it only re-triggers CommentThread's current query
  // (mirrors PostBoard's refreshSignal for PostForm).
  const [commentRefreshSignal, setCommentRefreshSignal] = useState(0)

  useEffect(() => {
    setPost(null)
    setMetaError(null)
    if (postId === null) {
      setMetaError('Invalid post id.')
      return
    }
    api
      .get<PostResponse>(`/post/${postId}`)
      .then((p) => setPost(p))
      .catch((err: unknown) => setMetaError(messageForError(err)))
  }, [postId])

  // A plain <video src> can't carry a Bearer header, so a private file's bytes are fetched
  // authenticated as a Blob and played from an objectURL. Revoked on file change/unmount.
  useEffect(() => {
    setObjectUrl(null)
    setPlaybackError(null)
    const file = post?.file
    if (!file || file.visibility !== 'private') return

    let cancelled = false
    let url: string | null = null
    api
      .getBlob(`/file/${file.id}/content`)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch((err: unknown) => {
        if (!cancelled) setPlaybackError(messageForPlaybackError(err))
      })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [post])

  function diagnosePlaybackError() {
    const file = post?.file
    if (!file) return
    api
      .getBlob(`/file/${file.id}/content`)
      .then(() => setPlaybackError('재생에 실패했습니다 — 브라우저가 이 파일을 재생할 수 없습니다.'))
      .catch((err: unknown) => setPlaybackError(messageForPlaybackError(err)))
  }

  // A UI hint only (decoded token claim, not a server round trip) — every write below is
  // re-checked server-side and a wrong guess here just surfaces as a 403, never a silent bypass.
  const canManage = currentUserId !== null && post?.creator?.id === currentUserId

  function startEdit() {
    if (!post) return
    setActionError(null)
    setEditTitle(post.title)
    setEditBody(post.body)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
  }

  // 목적: 게시글의 제목/본문을 수정한다.
  // 이유: fileId는 생성 시점에 고정되므로(ADR 0023 D1) 이 폼은 title/body만 다룬다.
  // 방법: PATCH /post/:id { title, body } → 성공 시 로컬 post 상태를 응답으로 교체하고 편집 모드를 닫는다.
  function submitEdit() {
    if (!post) return
    setActionError(null)
    setBusy(true)
    const request: UpdatePostRequest = { title: editTitle, body: editBody }
    api
      .patch<PostResponse>(`/post/${post.id}`, request)
      .then((updated) => {
        setPost(updated)
        setEditing(false)
      })
      .catch((err: unknown) => setActionError(messageForManageError(err)))
      .finally(() => setBusy(false))
  }

  // 목적: 게시글을 삭제한다.
  // 이유: 하드 삭제는 비가역이며(ADR 0020), 첨부 파일 행/실체는 건드리지 않는다 — 글은 파일을
  //   소유하지 않고 참조만 한다.
  // 방법: 확인 대화상자 → DELETE /post/:id → 성공 시 홈으로 이동.
  function handleDelete() {
    if (!post) return
    if (!window.confirm(`"${post.title}" 게시글을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    setActionError(null)
    setBusy(true)
    api
      .delete(`/post/${post.id}`)
      .then(() => navigate('/'))
      .catch((err: unknown) => {
        setActionError(messageForManageError(err))
        setBusy(false)
      })
  }

  if (metaError) {
    return (
      <main className={styles.page}>
        <NavBar />
        <p className={styles.error}>{metaError}</p>
        <Link to="/" className={styles.backLink}>
          Back to posts
        </Link>
      </main>
    )
  }

  if (!post) {
    return (
      <main className={styles.page}>
        <NavBar />
        <p>Loading…</p>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <NavBar />
      <Link to="/" className={styles.backLink}>
        Back to posts
      </Link>

      {editing ? (
        <div className={styles.editForm}>
          <label className={styles.field}>
            Title
            <input
              className={styles.input}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={100}
              required
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            Body
            <textarea
              className={styles.textarea}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              maxLength={10000}
              rows={6}
              required
              disabled={busy}
            />
          </label>
          {actionError && <p className={styles.error}>{actionError}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={submitEdit}>
              저장
            </button>
            <button type="button" className={styles.button} disabled={busy} onClick={cancelEdit}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className={styles.header}>
            <h1 className={styles.title}>{post.title}</h1>
            {post.creator && <p className={styles.meta}>{post.creator.email}</p>}
          </header>
          <p className={styles.body}>{post.body}</p>

          {post.file && (
            <div className={styles.playerWrapper}>
              {playbackError && <p className={styles.error}>{playbackError}</p>}
              {post.file.visibility === 'private' ? (
                objectUrl ? (
                  <video controls src={objectUrl} className={styles.player} />
                ) : (
                  !playbackError && <p className={styles.loadingText}>파일을 불러오는 중…</p>
                )
              ) : (
                <video
                  controls
                  src={post.file.visibility === 'unlisted' ? (post.file.shareUrl ?? post.file.fileUrl) : post.file.fileUrl}
                  onError={diagnosePlaybackError}
                  className={styles.player}
                />
              )}
            </div>
          )}

          {canManage && (
            <div className={styles.actions}>
              <button type="button" className={styles.button} disabled={busy} onClick={startEdit}>
                수정
              </button>
              <button type="button" className={styles.deleteButton} disabled={busy} onClick={handleDelete}>
                삭제
              </button>
            </div>
          )}
          {actionError && <p className={styles.error}>{actionError}</p>}
        </>
      )}

      <CommentThread postId={post.id} currentUserId={currentUserId} refreshSignal={commentRefreshSignal} />
      <CommentForm postId={post.id} onCreated={() => setCommentRefreshSignal((n) => n + 1)} />
    </main>
  )
}
