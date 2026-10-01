// 목적: 파일 하나의 메타데이터를 보여주고 visibility에 따라 콘텐츠를 재생한다(ADR 0025/0026).
// 사용처: RequireAuth 하위 /view/:id에 렌더링된다; FileBoard 행에서 링크로 연결된다. ("/file/:id"가
//   아닌 이유는 그 접두사가 백엔드 API로 가는 dev 프록시가 차지하고 있기 때문이다 — App.tsx 참고.)
// 근거: GET /file/:id/content가 유일한 바이트 서빙 경로이고 visibility로 게이트된다 — 일반
//   <video src>는 Bearer 헤더를 실을 수 없으므로, private 파일의 바이트는 인증해서 받아온다.

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
import { useLanguage } from '../../i18n/useLanguage'
import type { Translatable } from '../../i18n/messages'
import { NavBar } from '../../shared/NavBar'
import { VisibilityBadge } from './VisibilityBadge'
import styles from './FileDetailPage.module.css'

const VISIBILITY_OPTIONS: FileVisibility[] = ['public', 'private', 'unlisted']

// 목적: 파일 읽기/재생 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FILE_NOT_FOUND:
        return 'common.fileNotFound'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'fileDetail.err.noPermission'
      case ErrorCode.FILE_SHARE_INVALID:
        return 'fileDetail.err.shareInvalid'
      default:
        return 'fileDetail.err.loadFailed'
    }
  }
  return 'common.networkError'
}

// 목적: 관리 액션(visibility 토글, 공유 링크 회전, 삭제) 실패 응답을 메시지 키로 바꾼다.
// 이유: 읽기/재생과는 다른 코드 집합으로 분기해야 한다(409 FILE_IN_USE는 삭제에만 해당한다). 그리고
//       messageForError와 같은 이유로 번역된 문자열이 아니라 키(또는 서버가 준 raw 문구)를 돌려준다.
// 방법: ApiError의 고정 code로 switch해 키를 고르고, VALIDATION_FAILED만 서버 문구를 { raw }로 감싼다.
function messageForManageError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'fileDetail.err.manageNotOwner'
      case ErrorCode.FILE_IN_USE:
        return 'fileDetail.err.inUse'
      case ErrorCode.FILE_NOT_FOUND:
        return 'common.fileNotFound'
      case ErrorCode.VALIDATION_FAILED:
        return { raw: Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message }
      default:
        return 'common.actionFailed'
    }
  }
  return 'common.networkError'
}

type TransferAction = 'propose' | 'cancel' | 'accept' | 'reject'

// 목적: 이전 액션(propose/accept/reject/cancel) 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: ADR 0050 코드에 더해 USER_NOT_FOUND(이메일→id 조회 단계)와 VALIDATION_FAILED(propose 폼의 잘못된
//       형식 이메일은 백엔드에 다른 형태로 도달할 일이 없다)로 분기해야 한다. FORBIDDEN_NOT_OWNER는
//       호출한 액션에 맞춰 문구를 골라야 한다: propose는 creator-or-admin 그대로지만, cancel은 creator
//       전용으로 좁혀졌다(그러지 않으면 admin이 아무 이유 없이 다른 두 사용자 사이의 대기 중인 이전을
//       취소할 수 있었을 것이다 — canManage()를 재사용하다 딸려온 권한이지 의도한 결정이 아니다; propose의
//       admin 분기는 영향받지 않으며 그 자체로 ADR 0050 D4 근거가 있다). 한/영 토글 후에도 에러가
//       새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
// 방법: ApiError의 고정 code로 switch하고 FORBIDDEN_NOT_OWNER만 action으로 다시 가른다.
function messageForTransferError(error: unknown, action: TransferAction): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.USER_NOT_FOUND:
        return 'transfer.err.userNotFound'
      case ErrorCode.FILE_TRANSFER_INVALID_TARGET:
        return 'transfer.err.invalidTarget'
      case ErrorCode.FILE_TRANSFER_PENDING:
        return 'transfer.err.pending'
      case ErrorCode.FILE_NO_PENDING_TRANSFER:
        return 'transfer.err.noPending'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return action === 'cancel' ? 'transfer.err.cancelNotOwner' : 'transfer.err.proposeNotOwner'
      case ErrorCode.FORBIDDEN_NOT_TRANSFER_TARGET:
        return 'transfer.err.notTarget'
      case ErrorCode.VALIDATION_FAILED:
        return { raw: Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message }
      default:
        return 'transfer.err.default'
    }
  }
  return 'common.networkError'
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
  const { t } = useLanguage()
  const fileId = id !== undefined && /^\d+$/.test(id) ? Number(id) : null

  const [file, setFile] = useState<FileResponse | null>(null)
  const [metaError, setMetaError] = useState<Translatable | null>(null)
  const [playbackError, setPlaybackError] = useState<Translatable | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [actionError, setActionError] = useState<Translatable | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<Translatable | null>(null)
  const [busy, setBusy] = useState(false)
  const [transferEmail, setTransferEmail] = useState('')
  const [transferError, setTransferError] = useState<Translatable | null>(null)
  const [transferBusy, setTransferBusy] = useState(false)

  useEffect(() => {
    setFile(null)
    setMetaError(null)
    if (fileId === null) {
      setMetaError('fileDetail.err.invalidId')
      return
    }
    api
      .get<FileResponse>(`/file/${fileId}`)
      .then((f) => setFile(f))
      .catch((err: unknown) => setMetaError(messageForError(err)))
  }, [fileId])

  // 일반 <video src>는 Bearer 헤더를 실을 수 없으므로, private 파일의 바이트는 인증된
  // Blob으로 받아 objectURL로 재생한다. 파일이 바뀌거나 이 페이지가 언마운트되면 URL을
  // revoke하므로 디코딩된 바이트가 메모리에 남지 않는다.
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

  // public/unlisted는 <video src>로 직접 스트리밍한다(Range 기반 탐색 유지). 실패하면
  // api 래퍼를 통한 진단용 호출 1회로 실제 ErrorCode를 읽어 메시지를 만든다.
  function diagnosePlaybackError() {
    if (!file) return
    api
      .getBlob(`/file/${file.id}/content`)
      .then(() => setPlaybackError('fileDetail.err.playbackFailed'))
      .catch((err: unknown) => setPlaybackError(messageForError(err)))
  }

  // 단순 UI 힌트일 뿐이다(서버 왕복이 아니라 디코딩된 토큰 클레임) — 아래 모든 쓰기는
  // 서버에서 다시 검증되므로 여기서 잘못 판단해도 403으로 드러날 뿐, 조용히 우회되지 않는다.
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
      .then(() => setCopyFeedback('fileDetail.copied'))
      .catch(() => setCopyFeedback('fileDetail.copyFailed'))
  }

  // 목적: 소유자/관리자가 파일 행과 저장된 바이트를 삭제한다.
  // 이유: 게시글이 참조 중이면 백엔드가 409 FILE_IN_USE로 거절하므로(ADR 0023 D4), 그 결과를
  //   사용자에게 보여줘야 한다.
  // 방법: 확인 대화상자 → DELETE /file/:id → 성공 시 목록으로 이동, 실패 시 에러만 표시.
  function handleDelete() {
    if (!file) return
    if (!window.confirm(t('common.confirmDelete', { title: file.title }))) return
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
        <p className={styles.error}>{t(metaError)}</p>
        <Link to="/files" className={styles.backLink}>
          {t('fileDetail.back')}
        </Link>
      </main>
    )
  }

  if (!file) {
    return (
      <main className={styles.page}>
        <NavBar />
        <p>{t('common.loading')}</p>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <NavBar />
      <Link to="/files" className={styles.backLink}>
        {t('fileDetail.back')}
      </Link>
      <header className={styles.header}>
        <VisibilityBadge visibility={file.visibility} />
        {file.pendingTransferTo && (canManage || isPendingTarget) && (
          <span className={styles.pendingBadge}>
            {canManage
              ? t('fileDetail.pendingBadge', { email: file.pendingTransferTo.email })
              : t('transfer.proposedToYou')}
          </span>
        )}
        <h1 className={styles.title} title={file.title}>
          {file.title}
        </h1>
      </header>
      {file.creator && <p className={styles.meta}>{t('fileDetail.uploadedBy', { email: file.creator.email })}</p>}

      {playbackError && <p className={styles.error}>{t(playbackError)}</p>}

      <div className={styles.playerWrapper}>
        {file.visibility === 'private' ? (
          objectUrl ? (
            renderMediaElement(file.mediaType, file.title, {
              src: objectUrl,
              className: styles.player,
            })
          ) : (
            !playbackError && <p className={styles.loadingText}>{t('fileDetail.loadingContent')}</p>
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
          {t('fileDetail.shareLink')} <code className={styles.shareCode}>{file.shareUrl}</code>
          {canManage && (
            <button type="button" onClick={handleCopyShareLink} className={styles.copyButton}>
              {t('fileDetail.copy')}
            </button>
          )}
          {copyFeedback && <span className={styles.copyFeedback}>{t(copyFeedback)}</span>}
        </p>
      )}

      {canManage && (
        <section className={styles.manage}>
          <h2 className={styles.manageHeading}>{t('fileDetail.manage')}</h2>
          {actionError && <p className={styles.error}>{t(actionError)}</p>}
          <div className={styles.controls}>
            <label className={styles.visibilityLabel}>
              {t('fileDetail.visibility')}
              <select
                className={styles.select}
                value={file.visibility}
                disabled={busy}
                onChange={(e) => handleVisibilityChange(e.target.value as FileVisibility)}
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`visibility.option.${option}`)}
                  </option>
                ))}
              </select>
            </label>
            {file.visibility === 'unlisted' && (
              <button type="button" disabled={busy} onClick={handleRotateShareToken} className={styles.rotateButton}>
                {t('fileDetail.rotate')}
              </button>
            )}
            <button type="button" disabled={busy} onClick={handleDelete} className={styles.deleteButton}>
              {t('fileDetail.delete')}
            </button>
          </div>
        </section>
      )}

      {canManage && (
        <section className={styles.manage}>
          <h2 className={styles.manageHeading}>{t('transfer.heading')}</h2>
          {transferError && <p className={styles.error}>{t(transferError)}</p>}
          {file.pendingTransferTo ? (
            <div className={styles.controls}>
              <p className={styles.meta}>
                {t('transfer.pendingPrefix')}
                <strong>{file.pendingTransferTo.email}</strong>
                {t('transfer.pendingSuffix')}
              </p>
              <button
                type="button"
                disabled={transferBusy}
                onClick={handleCancelTransfer}
                className={styles.deleteButton}
              >
                {t('transfer.cancel')}
              </button>
            </div>
          ) : (
            <form className={styles.controls} onSubmit={handleProposeTransfer}>
              <label className={styles.visibilityLabel}>
                {t('transfer.recipientEmail')}
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
                {t('transfer.propose')}
              </button>
            </form>
          )}
        </section>
      )}

      {isPendingTarget && file.pendingTransferTo && (
        <section className={styles.manage}>
          <h2 className={styles.manageHeading}>{t('transfer.proposedToYou')}</h2>
          {transferError && <p className={styles.error}>{t(transferError)}</p>}
          <p className={styles.meta}>{t('transfer.incomingText')}</p>
          <div className={styles.controls}>
            <button
              type="button"
              disabled={transferBusy}
              onClick={handleAcceptTransfer}
              className={styles.rotateButton}
            >
              {t('transfer.accept')}
            </button>
            <button
              type="button"
              disabled={transferBusy}
              onClick={handleRejectTransfer}
              className={styles.deleteButton}
            >
              {t('transfer.reject')}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
