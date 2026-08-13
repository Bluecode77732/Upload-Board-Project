// Purpose: shows one file's metadata and plays its content according to visibility (ADR 0025/0026).
// Usage: rendered at /view/:id behind RequireAuth; linked from FileBoard rows. (Not "/file/:id" —
//   that prefix is claimed by the dev proxy to the backend API, see App.tsx.)
// Rationale: GET /file/:id/content is the only byte-serving path and is visibility-gated — a plain
//   <video src> can't carry a Bearer header, so a private file's bytes are fetched authenticated.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { FileResponse, FileVisibility, UpdateFileVisibilityRequest } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { NavBar } from '../../shared/NavBar'
import { VisibilityBadge } from './VisibilityBadge'

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

  if (metaError) {
    return (
      <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
        <NavBar />
        <p style={{ color: 'crimson' }}>{metaError}</p>
        <Link to="/files">Back to files</Link>
      </main>
    )
  }

  if (!file) {
    return (
      <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
        <NavBar />
        <p>Loading…</p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <NavBar />
      <Link to="/files">Back to files</Link>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0' }}>
        <VisibilityBadge visibility={file.visibility} />
        <h1 style={{ margin: 0 }}>{file.title}</h1>
      </header>
      {file.creator && <p style={{ color: '#555' }}>Uploaded by {file.creator.email}</p>}

      {playbackError && <p style={{ color: 'crimson' }}>{playbackError}</p>}

      {file.visibility === 'private' ? (
        objectUrl ? (
          <video controls src={objectUrl} style={{ width: '100%' }} />
        ) : (
          !playbackError && <p>Loading content…</p>
        )
      ) : (
        <video
          controls
          src={file.visibility === 'unlisted' ? (file.shareUrl ?? file.fileUrl) : file.fileUrl}
          onError={diagnosePlaybackError}
          style={{ width: '100%' }}
        />
      )}

      {file.visibility === 'unlisted' && file.shareUrl && (
        <p style={{ marginTop: 12 }}>
          Share link: <code>{file.shareUrl}</code>
          {canManage && (
            <button type="button" onClick={handleCopyShareLink} style={{ marginLeft: 8 }}>
              Copy
            </button>
          )}
          {copyFeedback && <span style={{ marginLeft: 8, color: '#1e7e34' }}>{copyFeedback}</span>}
        </p>
      )}

      {canManage && (
        <section style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #ddd' }}>
          <h2 style={{ fontSize: '1rem' }}>Manage</h2>
          {actionError && <p style={{ color: 'crimson' }}>{actionError}</p>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              Visibility
              <select
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
              <button type="button" disabled={busy} onClick={handleRotateShareToken}>
                Rotate share link
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={handleDelete}
              style={{ color: 'crimson', marginLeft: 'auto' }}
            >
              Delete file
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
