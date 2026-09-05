// Purpose: shows one file's metadata and plays its content according to visibility (ADR 0025/0026).
// Usage: rendered at /view/:id behind RequireAuth; linked from FileBoard rows. (Not "/file/:id" —
//   that prefix is claimed by the dev proxy to the backend API, see App.tsx.)
// Rationale: GET /file/:id/content is the only byte-serving path and is visibility-gated — a plain
//   <video src> can't carry a Bearer header, so a private file's bytes are fetched authenticated.

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type {
  FileMediaType,
  FileResponse,
  FileVisibility,
  ProposeFileTransferRequest,
  UpdateFileVisibilityRequest,
  User,
} from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { NavBar } from '../../shared/NavBar'
import { VisibilityBadge } from './VisibilityBadge'
import styles from './FileDetailPage.module.css'

const VISIBILITY_OPTIONS: FileVisibility[] = ['public', 'private', 'unlisted']

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
function messageForError(error: unknown): string {
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

// Errors from the management actions (visibility toggle, share rotation, delete) branch on
// a different set of codes than read/playback (409 FILE_IN_USE only applies to delete).
function messageForManageError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'Only the file creator or an admin can manage this file.'
      case ErrorCode.FILE_IN_USE:
        return 'This file is attached to a post and cannot be deleted. Delete the post first.'
      case ErrorCode.FILE_NOT_FOUND:
        return 'File not found.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return 'The action failed.'
    }
  }
  return 'Network error. Is the backend running?'
}

type TransferAction = 'propose' | 'cancel' | 'accept' | 'reject'

// Errors from the transfer actions (propose/accept/reject/cancel) branch on the ADR 0050
// codes plus USER_NOT_FOUND (the email→id lookup step) and VALIDATION_FAILED (a malformed
// email in the propose form never reaches the backend as anything else). FORBIDDEN_NOT_OWNER
// needs the calling action to word correctly: propose stays creator-or-admin, but cancel was
// narrowed to creator-only (an admin could otherwise cancel a pending transfer between two
// other users with no stated reason to — a permission inherited by reusing canManage(), not a
// deliberate decision; propose's admin branch is unaffected, it has its own ADR 0050 D4 basis).
function messageForTransferError(error: unknown, action: TransferAction): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.USER_NOT_FOUND:
        return 'No user found with that email.'
      case ErrorCode.FILE_TRANSFER_INVALID_TARGET:
        return 'You already own this file.'
      case ErrorCode.FILE_TRANSFER_PENDING:
        return 'A transfer is already pending. Cancel it before proposing a new one.'
      case ErrorCode.FILE_NO_PENDING_TRANSFER:
        return 'No transfer is pending on this file.'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return action === 'cancel'
          ? 'Only the file creator can cancel a transfer.'
          : 'Only the file creator or an admin can propose a transfer.'
      case ErrorCode.FORBIDDEN_NOT_TRANSFER_TARGET:
        return 'Only the proposed recipient can accept or reject this transfer.'
      case ErrorCode.VALIDATION_FAILED:
        return Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message
      default:
        return 'The transfer action failed.'
    }
  }
  return 'Network error. Is the backend running?'
}

// 목적: mediaType(image/audio/video)에 맞는 재생 태그를 고른다.
// 이유: 이전에는 항상 <video>만 렌더링해 이미지/오디오 파일이 재생되지 않았다(ADR 0040).
// 방법: visibility 분기가 결정한 src/onError를 그대로 받아 태그 종류만 바꾼다 — 소스를
//   가져오는 방식(blob objectURL vs 직접 src)은 두 호출부 모두 이 함수 밖에서 그대로 유지된다.
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

export function FileDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUserId } = useAuth()
  const fileId = id !== undefined && /^\d+$/.test(id) ? Number(id) : null

  const [file, setFile] = useState<FileResponse | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [transferEmail, setTransferEmail] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferBusy, setTransferBusy] = useState(false)

  useEffect(() => {
    setFile(null)
    setMetaError(null)
    if (fileId === null) {
      setMetaError('Invalid file id.')
      return
    }
    api
      .get<FileResponse>(`/file/${fileId}`)
      .then((f) => setFile(f))
      .catch((err: unknown) => setMetaError(messageForError(err)))
  }, [fileId])

  // A plain <video src> can't carry a Bearer header, so a private file's bytes are fetched
  // authenticated as a Blob and played from an objectURL. The URL is revoked whenever the
  // file changes or this page unmounts, so decoded bytes never linger in memory.
  useEffect(() => {
    setObjectUrl(null)
    setPlaybackError(null)
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
        if (!cancelled) setPlaybackError(messageForError(err))
      })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  // public/unlisted stream directly via <video src> (keeps Range-based seeking). On failure,
  // one diagnostic call through the api wrapper reads the real ErrorCode for messaging.
  function diagnosePlaybackError() {
    if (!file) return
    api
      .getBlob(`/file/${file.id}/content`)
      .then(() => setPlaybackError('Playback failed — the browser could not play this file.'))
      .catch((err: unknown) => setPlaybackError(messageForError(err)))
  }

  // A UI hint only (decoded token claim, not a server round trip) — every write below is
  // re-checked server-side and a wrong guess here just surfaces as a 403, never a silent bypass.
  const canManage = currentUserId !== null && file?.creator?.id === currentUserId
  const isPendingTarget =
    currentUserId !== null && file?.pendingTransferTo?.id === currentUserId

  // 목적: 소유자가 visibility를 전환한다(예: private → public/unlisted).
  // 이유: 백엔드는 별도 엔드포인트 없이 PATCH /file/:id 하나로 토글을 처리한다(ADR 0026).
  // 방법: PATCH 응답(갱신된 FileResponseDto)으로 로컬 file 상태를 그대로 교체 — shareUrl 유무도 응답이 결정.
  function handleVisibilityChange(next: FileVisibility) {
    if (!file) return
    setActionError(null)
    setCopyFeedback(null)
    setBusy(true)
    const body: UpdateFileVisibilityRequest = { visibility: next }
    api
      .patch<FileResponse>(`/file/${file.id}`, body)
      .then((updated) => setFile(updated))
      .catch((err: unknown) => setActionError(messageForManageError(err)))
      .finally(() => setBusy(false))
  }

  // 목적: unlisted 파일의 공유 토큰을 회전해 이전에 공유된 링크를 전부 무효화한다.
  // 이유: 링크가 유출됐다고 의심될 때 소유자가 즉시 무효화할 수단이 필요하다(ADR 0025 D3).
  // 방법: rotateShareToken:true와 함께 visibility:'unlisted'를 보내 새 토큰을 발급받는다.
  function handleRotateShareToken() {
    if (!file) return
    setActionError(null)
    setCopyFeedback(null)
    setBusy(true)
    const body: UpdateFileVisibilityRequest = { visibility: 'unlisted', rotateShareToken: true }
    api
      .patch<FileResponse>(`/file/${file.id}`, body)
      .then((updated) => setFile(updated))
      .catch((err: unknown) => setActionError(messageForManageError(err)))
      .finally(() => setBusy(false))
  }

  function handleCopyShareLink() {
    if (!file?.shareUrl) return
    navigator.clipboard
      .writeText(file.shareUrl)
      .then(() => setCopyFeedback('Copied.'))
      .catch(() => setCopyFeedback('Could not copy — copy it manually.'))
  }

  // 목적: 소유자/관리자가 파일 행과 저장된 바이트를 삭제한다.
  // 이유: 게시글이 참조 중이면 백엔드가 409 FILE_IN_USE로 거절하므로(ADR 0023 D4), 그 결과를
  //   사용자에게 보여줘야 한다.
  // 방법: 확인 대화상자 → DELETE /file/:id → 성공 시 목록으로 이동, 실패 시 에러만 표시.
  function handleDelete() {
    if (!file) return
    if (!window.confirm(`Delete "${file.title}"? This cannot be undone.`)) return
    setActionError(null)
    setBusy(true)
    api
      .delete(`/file/${file.id}`)
      .then(() => navigate('/files'))
      .catch((err: unknown) => {
        setActionError(messageForManageError(err))
        setBusy(false)
      })
  }

  // 목적: 이메일로 입력된 대상에게 소유권 이전을 제안한다.
  // 이유: POST /file/:id/transfer는 숫자 userId만 받는데, 제안자는 상대방 이메일만 안다 —
  //       GET /user/lookup(신규, ADR 0050 프론트 UI)으로 먼저 id를 구해야 한다.
  // 방법: 이메일 조회 → 성공하면 그 id로 제안 POST, 응답(FileResponseDto)으로 file 상태 교체.
  //       조회 실패(USER_NOT_FOUND)와 제안 실패(자기 자신 대상, 이미 대기중 등)를 한 catch로 묶는다 —
  //       둘 다 messageForTransferError가 code로 분기하므로 별도 처리가 필요 없다.
  function handleProposeTransfer(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    const email = transferEmail.trim()
    if (!email) return
    setTransferError(null)
    setTransferBusy(true)
    api
      .get<User>(`/user/lookup?email=${encodeURIComponent(email)}`)
      .then((target) => {
        const body: ProposeFileTransferRequest = { userId: target.id }
        return api.post<FileResponse>(`/file/${file.id}/transfer`, body)
      })
      .then((updated) => {
        setFile(updated)
        setTransferEmail('')
      })
      .catch((err: unknown) => setTransferError(messageForTransferError(err, 'propose')))
      .finally(() => setTransferBusy(false))
  }

  // 목적: 아직 응답 없는 이전 제안을 제안자가 스스로 취소한다.
  // 이유: 대상의 응답을 기다리지 않고 거둘 수 있어야 한다(ADR 0050 D3).
  // 방법: DELETE /file/:id/transfer — 다른 파일 삭제 엔드포인트와 달리 이 라우트는 갱신된
  //       FileResponseDto를 JSON으로 반환한다(순수 텍스트 200이 아님, cancelTransfer가 toResponse를 호출).
  function handleCancelTransfer() {
    if (!file) return
    setTransferError(null)
    setTransferBusy(true)
    api
      .delete<FileResponse>(`/file/${file.id}/transfer`)
      .then((updated) => setFile(updated))
      .catch((err: unknown) => setTransferError(messageForTransferError(err, 'cancel')))
      .finally(() => setTransferBusy(false))
  }

  // 목적: 제안받은 이전을 대상 본인이 수락해 소유권을 옮긴다.
  // 이유: 동의 없는 강제 이전이었던 옛 PATCH userId를 대체한다 — admin도 대신 수락 못 한다(ADR 0050 D4).
  // 방법: POST /file/:id/transfer/accept, 응답으로 file 상태 교체.
  function handleAcceptTransfer() {
    if (!file) return
    setTransferError(null)
    setTransferBusy(true)
    api
      .post<FileResponse>(`/file/${file.id}/transfer/accept`)
      .then((updated) => setFile(updated))
      .catch((err: unknown) => setTransferError(messageForTransferError(err, 'accept')))
      .finally(() => setTransferBusy(false))
  }

  // 목적: 제안받은 이전을 대상 본인이 거절한다(소유권 불변).
  // 이유: acceptTransfer와 대칭 — 거절도 대상 본인의 동의 절차 중 하나다(ADR 0050).
  // 방법: POST /file/:id/transfer/reject, 응답으로 file 상태 교체.
  function handleRejectTransfer() {
    if (!file) return
    setTransferError(null)
    setTransferBusy(true)
    api
      .post<FileResponse>(`/file/${file.id}/transfer/reject`)
      .then((updated) => setFile(updated))
      .catch((err: unknown) => setTransferError(messageForTransferError(err, 'reject')))
      .finally(() => setTransferBusy(false))
  }

  if (metaError) {
    return (
      <main className={styles.page}>
        <NavBar />
        <p className={styles.error}>{metaError}</p>
        <Link to="/files" className={styles.backLink}>
          Back to files
        </Link>
      </main>
    )
  }

  if (!file) {
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
      <Link to="/files" className={styles.backLink}>
        Back to files
      </Link>
      <header className={styles.header}>
        <VisibilityBadge visibility={file.visibility} />
        {file.pendingTransferTo && (canManage || isPendingTarget) && (
          <span className={styles.pendingBadge}>
            {canManage ? `Transfer pending → ${file.pendingTransferTo.email}` : 'Transfer proposed to you'}
          </span>
        )}
        <h1 className={styles.title} title={file.title}>
          {file.title}
        </h1>
      </header>
      {file.creator && <p className={styles.meta}>Uploaded by {file.creator.email}</p>}

      {playbackError && <p className={styles.error}>{playbackError}</p>}

      <div className={styles.playerWrapper}>
        {file.visibility === 'private' ? (
          objectUrl ? (
            renderMediaElement(file.mediaType, file.title, {
              src: objectUrl,
              className: styles.player,
            })
          ) : (
            !playbackError && <p className={styles.loadingText}>Loading content…</p>
          )
        ) : (
          renderMediaElement(file.mediaType, file.title, {
            src: file.visibility === 'unlisted' ? (file.shareUrl ?? file.fileUrl) : file.fileUrl,
            className: styles.player,
            onError: diagnosePlaybackError,
          })
        )}
      </div>

      {file.visibility === 'unlisted' && file.shareUrl && (
        <p className={styles.shareBox}>
          Share link: <code className={styles.shareCode}>{file.shareUrl}</code>
          {canManage && (
            <button type="button" onClick={handleCopyShareLink} className={styles.copyButton}>
              Copy
            </button>
          )}
          {copyFeedback && <span className={styles.copyFeedback}>{copyFeedback}</span>}
        </p>
      )}

      {canManage && (
        <section className={styles.manage}>
          <h2 className={styles.manageHeading}>Manage</h2>
          {actionError && <p className={styles.error}>{actionError}</p>}
          <div className={styles.controls}>
            <label className={styles.visibilityLabel}>
              Visibility
              <select
                className={styles.select}
                value={file.visibility}
                disabled={busy}
                onChange={(e) => handleVisibilityChange(e.target.value as FileVisibility)}
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            {file.visibility === 'unlisted' && (
              <button type="button" disabled={busy} onClick={handleRotateShareToken} className={styles.rotateButton}>
                Rotate share link
              </button>
            )}
            <button type="button" disabled={busy} onClick={handleDelete} className={styles.deleteButton}>
              Delete file
            </button>
          </div>
        </section>
      )}

      {canManage && (
        <section className={styles.manage}>
          <h2 className={styles.manageHeading}>Transfer ownership</h2>
          {transferError && <p className={styles.error}>{transferError}</p>}
          {file.pendingTransferTo ? (
            <div className={styles.controls}>
              <p className={styles.meta}>
                Pending transfer to <strong>{file.pendingTransferTo.email}</strong> — not moved
                until they accept.
              </p>
              <button
                type="button"
                disabled={transferBusy}
                onClick={handleCancelTransfer}
                className={styles.deleteButton}
              >
                Cancel transfer
              </button>
            </div>
          ) : (
            <form className={styles.controls} onSubmit={handleProposeTransfer}>
              <label className={styles.visibilityLabel}>
                Recipient email
                <input
                  type="email"
                  required
                  value={transferEmail}
                  disabled={transferBusy}
                  onChange={(e) => setTransferEmail(e.target.value)}
                  className={styles.select}
                />
              </label>
              <button
                type="submit"
                disabled={transferBusy || !transferEmail.trim()}
                className={styles.rotateButton}
              >
                Propose transfer
              </button>
            </form>
          )}
        </section>
      )}

      {isPendingTarget && file.pendingTransferTo && (
        <section className={styles.manage}>
          <h2 className={styles.manageHeading}>Transfer proposed to you</h2>
          {transferError && <p className={styles.error}>{transferError}</p>}
          <p className={styles.meta}>The current owner wants to transfer this file to you.</p>
          <div className={styles.controls}>
            <button
              type="button"
              disabled={transferBusy}
              onClick={handleAcceptTransfer}
              className={styles.rotateButton}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={transferBusy}
              onClick={handleRejectTransfer}
              className={styles.deleteButton}
            >
              Reject
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
