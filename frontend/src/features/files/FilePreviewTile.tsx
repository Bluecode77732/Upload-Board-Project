// 목적: 파일 보드 그리드 타일 하나 — 16:9 미리보기 프레임에 파일의 visibility 배지, 제목 링크,
//   creator 필터를 더한 것.
// 사용처: FileBoard가 GET /file의 모든 행마다 렌더링한다; 그 그리드 밖에서 쓸 용도가 아니다.
// 근거: 타일마다 독립적인 lazy-load/blob/objectURL 생명주기를 가진다 — 이걸 N개 FileBoard 자체
//   상태로 접으면 서로 무관한 fetch 생명주기 N개가 한 컴포넌트에 몰리게 된다.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { FileResponse } from '../../api/types'
import { VisibilityBadge } from './VisibilityBadge'
import styles from './FilePreviewTile.module.css'

// 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011). FileDetailPage의
// 문구보다 짧게 유지한다 — 타일에는 문장이 아니라 짧은 구 하나 들어갈 공간뿐이다.
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

  // 최초 교차 시점에 래치를 건다: 한 번 보인 타일은 다시 스크롤해서 지나가도 아래 fetch를
  // 재트리거하면 안 된다.
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

  // 인증된 blob 읽기가 필요한 건 private 파일뿐이다; public/unlisted는 `direct`에서 곧바로
  // 스트리밍한다. objectURL은 언마운트나 파일 변경 시 revoke해 디코딩된 바이트가 남지 않게 한다.
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
      // 이게 없으면 저장된 바이트가 사라졌을 때 브라우저가 자체 깨진-이미지 상태(빈 박스에
      // alt 텍스트)를 그려버린다 — 이 타일도 video 분기와 같은 방식으로 실패해야 한다.
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
