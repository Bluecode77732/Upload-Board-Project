// Purpose: shows one file's metadata and plays its content according to visibility (ADR 0025/0026).
// Usage: rendered at /view/:id behind RequireAuth; linked from FileBoard rows. (Not "/file/:id" —
//   that prefix is claimed by the dev proxy to the backend API, see App.tsx.)
// Rationale: GET /file/:id/content is the only byte-serving path and is visibility-gated — a plain
//   <video src> can't carry a Bearer header, so a private file's bytes are fetched authenticated.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { FileResponse } from '../../api/types'
import { VisibilityBadge } from './VisibilityBadge'

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

export function FileDetailPage() {
  const { id } = useParams()
  const fileId = id !== undefined && /^\d+$/.test(id) ? Number(id) : null

  const [file, setFile] = useState<FileResponse | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

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

  if (metaError) {
    return (
      <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
        <p style={{ color: 'crimson' }}>{metaError}</p>
        <Link to="/">Back to files</Link>
      </main>
    )
  }

  if (!file) {
    return (
      <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
        <p>Loading…</p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <Link to="/">Back to files</Link>
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
        </p>
      )}
    </main>
  )
}
