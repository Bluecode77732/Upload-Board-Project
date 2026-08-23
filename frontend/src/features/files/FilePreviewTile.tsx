// Purpose: one file-board grid tile — a 16:9 preview frame plus the file's visibility badge, title link, and creator filter.
// Usage: rendered by FileBoard for every row of GET /file; not intended for use outside that grid.
// Rationale: each tile owns an independent lazy-load/blob/objectURL lifecycle, and folding N of those
//   into FileBoard's own state would put N unrelated fetch lifecycles in one component.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { FileResponse } from '../../api/types'
import { VisibilityBadge } from './VisibilityBadge'
import styles from './FilePreviewTile.module.css'

// Branch on the stable code (backend ADR 0011), never on the human-readable message. Kept
// terser than FileDetailPage's copy — a tile has room for a phrase, not a sentence.
function messageForPreviewError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'No access'
      case ErrorCode.FILE_NOT_FOUND:
        return 'Not found'
      case ErrorCode.FILE_SHARE_INVALID:
        return 'Share link expired'
      default:
        return 'Preview unavailable'
    }
  }
  return 'Preview unavailable'
}

// 목적: 이 파일의 미리보기 바이트를 인증 없이 직접 읽을 수 있는 URL을 돌려준다.
// 이유: <img src>/<video src>는 Bearer 헤더를 실을 수 없어 private 파일에서는 403이 되고,
//   반대로 public/unlisted까지 blob으로 받으면 불필요한 전체 다운로드가 된다(ADR 0025/0026).
// 방법: private면 null을 돌려 호출부가 인증 blob 경로를 타게 하고, unlisted는 share 토큰이 붙은
//   shareUrl을 우선 쓴다 — FileDetailPage의 재생 분기와 동일한 규칙이다.
function directSrc(file: FileResponse): string | null {
  if (file.visibility === 'private') return null
  return file.visibility === 'unlisted' ? (file.shareUrl ?? file.fileUrl) : file.fileUrl
}

interface FilePreviewTileProps {
  file: FileResponse
  onFilterCreator: (creatorId: number) => void
}

// 목적: 파일 한 건을 큰 프리뷰 프레임이 달린 그리드 타일로 그린다.
// 이유: 텍스트 한 줄짜리 목록으로는 어떤 파일인지 열어보기 전에는 알 수 없었다.
// 방법: 프레임이 뷰포트에 들어올 때만(IntersectionObserver) 바이트를 읽고 — 이미지는 자동,
//   영상은 100MB까지 갈 수 있어 클릭한 뒤에만, 오디오는 볼 프레임이 없으므로 아예 읽지 않는다.
//   private 파일은 objectURL로 받아 언마운트/파일 변경 시 revoke한다.
export function FilePreviewTile({ file, onFilterCreator }: FilePreviewTileProps) {
  const [inView, setInView] = useState(false)
  const [videoRequested, setVideoRequested] = useState(false)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)

  // Latch on first intersection: once a tile has been seen, scrolling past it again must not
  // re-trigger the fetch below.
  useEffect(() => {
    const node = frameRef.current
    if (!node || inView) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setInView(true)
      },
      { rootMargin: '150px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [inView])

  const direct = directSrc(file)
  const shouldLoadBytes =
    file.mediaType === 'image' ? inView : file.mediaType === 'video' ? videoRequested : false

  // Only a private file needs the authenticated blob read; public/unlisted stream straight from
  // `direct`. The objectURL is revoked on unmount or file change so decoded bytes don't linger.
  useEffect(() => {
    setObjectUrl(null)
    setPreviewError(null)
    if (!shouldLoadBytes || direct !== null) return

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
        if (!cancelled) setPreviewError(messageForPreviewError(err))
      })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [shouldLoadBytes, direct, file.id])

  const src = direct ?? objectUrl
  const creator = file.creator

  // 목적: 프레임 안에 들어갈 내용(미리보기·플레이스홀더·에러)을 고른다.
  // 이유: 미디어 타입 3종 × 로드 상태(미요청/로딩/완료/실패)의 조합을 JSX 안에 중첩 삼항으로
  //   펼치면 읽을 수 없다.
  // 방법: 에러 → audio(아이콘 고정) → video(클릭 전 버튼) → src 준비 여부 순으로 조기 반환한다.
  function renderFrameContent() {
    if (previewError) {
      return (
        <p className={styles.placeholder}>
          <span className={styles.icon} aria-hidden="true">
            ⚠
          </span>
          <span className={styles.note}>{previewError}</span>
        </p>
      )
    }

    if (file.mediaType === 'audio') {
      return (
        <p className={styles.placeholder}>
          <span className={styles.icon} aria-hidden="true">
            🎵
          </span>
          <span className={styles.note}>Audio</span>
        </p>
      )
    }

    if (file.mediaType === 'video' && !videoRequested) {
      return (
        <div className={styles.placeholder}>
          <span className={styles.icon} aria-hidden="true">
            🎬
          </span>
          <button
            type="button"
            className={styles.loadButton}
            onClick={() => setVideoRequested(true)}
          >
            Load preview
          </button>
        </div>
      )
    }

    if (!src) {
      return (
        <p className={styles.placeholder}>
          <span className={styles.icon} aria-hidden="true">
            {file.mediaType === 'video' ? '🎬' : '🖼'}
          </span>
          <span className={styles.note}>Loading…</span>
        </p>
      )
    }

    if (file.mediaType === 'image') {
      // Without this the browser paints its own broken-image state (alt text on an empty box)
      // whenever the stored bytes are gone — the tile must fail the same way the video branch does.
      return (
        <img
          src={src}
          alt={file.title}
          className={styles.media}
          loading="lazy"
          onError={() => setPreviewError('Preview unavailable')}
        />
      )
    }

    return (
      <video
        src={src}
        className={styles.media}
        preload="metadata"
        muted
        controls
        onError={() => setPreviewError('Preview unavailable')}
      />
    )
  }

  return (
    <li className={styles.tile}>
      <div className={styles.frame} ref={frameRef}>
        {renderFrameContent()}
      </div>
      <div className={styles.body}>
        <VisibilityBadge visibility={file.visibility} />
        <Link to={`/view/${file.id}`} className={styles.title}>
          {file.title}
        </Link>
      </div>
      {creator && (
        <button
          type="button"
          title="Filter the list to this creator"
          className={styles.creatorButton}
          onClick={() => onFilterCreator(creator.id)}
        >
          {creator.email}
        </button>
      )}
    </li>
  )
}
