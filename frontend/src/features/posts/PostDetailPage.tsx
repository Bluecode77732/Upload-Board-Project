// 목적: 게시글 하나의 본문, 첨부 파일(있다면), 댓글 스레드를 보여준다.
// 사용처: RequireAuth 하위 "/posts/:id"에 렌더링된다; PostBoard에서 링크로 연결된다.
// 근거: 댓글 순서는 실시간 인프라 없이 createdAt ASC로 고정돼 있어(ADR 0023, 이 프로젝트에는
//   WebSocket이 없다) 스레드는 명시적인 사용자 액션에서만 다시 불러온다 — 폴링은 하지 않는다.
//   파일 재생은 FileDetailPage의 visibility 기반 접근 제어 패턴을 따른다
//   (FileDetailPage.tsx:81-116): private 파일의 바이트는 인증된 Blob으로 받아오고,
//   public/unlisted는 <video src>로 직접 스트리밍한다.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { FileMediaType, PostResponse, UpdatePostRequest } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { NavBar } from '../../shared/NavBar'
import { CommentForm } from './CommentForm'
import { CommentThread } from './CommentThread'
import styles from './PostDetailPage.module.css'

// 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011).
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_NOT_FOUND:
        return 'Post not found.'
      default:
        return 'Failed to load the post.'
    }
  }
  return 'Network error. Is the backend running?'
}

// 관리 액션(수정, 삭제)의 에러는 읽기와는 다른 코드 집합으로 분기한다.
function messageForManageError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'Only the author or an admin can do this.'
      case ErrorCode.POST_NOT_FOUND:
        return 'Post not found.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return 'The action failed.'
    }
  }
  return 'Network error. Is the backend running?'
}

function messageForPlaybackError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FILE_NOT_FOUND:
        return 'File not found.'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'You do not have permission to view this file.'
      case ErrorCode.FILE_SHARE_INVALID:
        return 'This share link is missing, invalid, or expired.'
      default:
        return 'Failed to load the file.'
    }
  }
  return 'Network error. Is the backend running?'
}

// 목적: mediaType(image/audio/video)에 맞는 재생 태그를 고른다.
// 이유: 이전에는 항상 <video>만 렌더링해 이미지/오디오 첨부 파일이 재생되지 않았다(ADR 0040).
// 방법: visibility 분기가 결정한 src/onError를 그대로 받아 태그 종류만 바꾼다 — FileDetailPage.tsx의
//   동일한 헬퍼와 같은 패턴이다(이 파일의 messageForError류 헬퍼들처럼 페이지별로 각자 둔다).
function renderMediaElement(
  mediaType: FileMediaType,
  title: string,
  props: { src: string; className: string; onError?: () => void },
) {
  if (mediaType === 'image') {
    return <img src={props.src} alt={title} className={props.className} />
  }
  if (mediaType === 'audio') {
    return <audio controls src={props.src} className={props.className} onError={props.onError} />
  }
  return <video controls src={props.src} className={props.className} onError={props.onError} />
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

  // 값 자체에는 의미가 없다 — 값을 올리면 CommentThread의 현재 쿼리만 다시 트리거된다
  // (PostForm에 대한 PostBoard의 refreshSignal과 같은 패턴).
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

  // 일반 <video src>는 Bearer 헤더를 실을 수 없으므로, private 파일의 바이트는 인증된
  // Blob으로 받아 objectURL로 재생한다. 파일이 바뀌거나 언마운트되면 revoke한다.
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
      .then(() => setPlaybackError('Playback failed — the browser could not play this file.'))
      .catch((err: unknown) => setPlaybackError(messageForPlaybackError(err)))
  }

  // 단순 UI 힌트일 뿐이다(서버 왕복이 아니라 디코딩된 토큰 클레임) — 아래 모든 쓰기는
  // 서버에서 다시 검증되므로 여기서 잘못 판단해도 403으로 드러날 뿐, 조용히 우회되지 않는다.
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
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return
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
              Save
            </button>
            <button type="button" className={styles.button} disabled={busy} onClick={cancelEdit}>
              Cancel
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
                  renderMediaElement(post.file.mediaType, post.file.title, {
                    src: objectUrl,
                    className: styles.player,
                  })
                ) : (
                  !playbackError && <p className={styles.loadingText}>Loading content…</p>
                )
              ) : (
                renderMediaElement(post.file.mediaType, post.file.title, {
                  src: post.file.visibility === 'unlisted' ? (post.file.shareUrl ?? post.file.fileUrl) : post.file.fileUrl,
                  className: styles.player,
                  onError: diagnosePlaybackError,
                })
              )}
            </div>
          )}

          {canManage && (
            <div className={styles.actions}>
              <button type="button" className={styles.button} disabled={busy} onClick={startEdit}>
                Edit
              </button>
              <button type="button" className={styles.deleteButton} disabled={busy} onClick={handleDelete}>
                Delete
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
