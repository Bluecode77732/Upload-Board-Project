// 목적: 브라우저에서 백엔드의 2단계 업로드를 구동한다 — POST /upload/attach(multipart)
//   후 POST /file로 temp_ 파일을 영구 FileEntity 행으로 승격한다.
// 사용처: RequireAuth 하위 DashboardPage 내부에 렌더링된다; onUploaded()를 호출해 목록을 새로고침한다.
// 근거: 업로드는 이 앱의 핵심 쓰기 경로이자 고정된 temp_→granted_ 계약의 첫 실제 소비자다 —
//   승격이 성공하면 즉시 반영되도록 파일 목록 옆에 둔다.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { AttachResponse, FileResponse } from '../../api/types'
import { useLanguage } from '../../i18n/useLanguage'
import type { MessageKey, Translatable } from '../../i18n/messages'
import styles from './UploadForm.module.css'

// 백엔드의 필드별 허용목록(upload.controller.ts UPLOAD_ALLOWLIST, ADR 0027)을 그대로 반영한다:
// 이 세 multipart 필드 중 정확히 하나만, 필드마다 고유한 확장자/mimetype과 100MB 상한을 가진다.
type UploadFieldType = 'image' | 'audio' | 'video'

// label은 번역 키이고, hint(확장자 목록)는 언어와 무관한 식별자라 번역하지 않는다.
const FIELD_CONFIG: Record<UploadFieldType, { label: MessageKey; accept: string; hint: string }> = {
  image: { label: 'upload.type.image', accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', hint: 'jpg, jpeg, png, webp' },
  audio: { label: 'upload.type.audio', accept: 'audio/mpeg,.mp3', hint: 'mp3' },
  video: { label: 'upload.type.video', accept: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm', hint: 'mp4, mov, webm' },
}

// 목적: 업로드 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
//       타입별 문구(허용 형식, 파일 선택 요청)는 키를 타입마다 따로 둬서 한국어도 완전한 문장이 되게 했다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown, fieldType: UploadFieldType): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.UPLOAD_INVALID_TYPE:
        return `upload.err.invalidType.${fieldType}`
      case ErrorCode.UPLOAD_FILE_REQUIRED:
        return `upload.err.fileRequired.${fieldType}`
      case ErrorCode.UPLOAD_MULTIPLE_FIELDS:
        // 이 폼에서는 도달할 수 없다(항상 필드 하나만 보낸다), 그래도 실제 백엔드 코드다(ADR 0025 D5).
        return 'upload.err.multipleFields'
      case ErrorCode.PAYLOAD_TOO_LARGE:
        return 'upload.err.tooLarge'
      case ErrorCode.FILE_TITLE_TAKEN:
        return 'upload.err.titleTaken'
      case ErrorCode.FILE_INVALID_PATH:
        return 'upload.err.invalidPath'
      case ErrorCode.FILE_ALREADY_CLAIMED:
        // 이 temp 업로드는 이미 다른 사람이 승격시켰다(ADR 0019, 409).
        return 'upload.err.alreadyClaimed'
      case ErrorCode.UPLOAD_MALWARE_DETECTED:
        // ClamAV가 콘텐츠에서 악성코드를 확정 탐지했다(ADR 0059 D3) — 확장자/mimetype
        // 허용목록은 이미 통과했으므로 사용자에게는 스캔 결과로 명확히 알린다.
        return 'upload.err.malware'
      case ErrorCode.UPLOAD_SCAN_UNAVAILABLE:
        // 스캐너에 연결할 수 없거나 재시도가 모두 타임아웃됐다(ADR 0059 D4, fail-closed) —
        // 파일 자체가 아니라 스캔 자체가 되지 않았다는 뜻이라 재시도를 안내한다.
        return 'upload.err.scanUnavailable'
      case ErrorCode.VALIDATION_FAILED:
        return 'upload.err.validation'
      default:
        return 'upload.err.default'
    }
  }
  return 'common.networkError'
}

export function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState('')
  const [fieldType, setFieldType] = useState<UploadFieldType>('video')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<Translatable | null>(null)
  const [busy, setBusy] = useState(false)
  // 지금까지 전송된 1단계(attach 업로드)의 진행률(0-100); 대기 중이거나 2단계(작은 JSON
  // promote 호출 — 그 자체로는 의미 있는 진행률이 없다) 동안에는 null.
  const [progress, setProgress] = useState<number | null>(null)
  // replay된 청구(200)와 신규 승격(201, ADR 0019)을 구분한다 — 다음 제출 시 초기화해
  // 오래된 안내 문구가 그 업로드가 끝난 뒤까지 남아있지 않게 한다.
  const [notice, setNotice] = useState<Translatable | null>(null)
  // 파일 입력은 uncontrolled라 setFile(null)만으로는 브라우저가 들고 있는 선택이 비워지지 않는다 —
  // 이 값을 올려 입력 요소를 새로 마운트시키면 화면에 보이는 파일명과 state가 함께 초기화된다.
  const [fileInputKey, setFileInputKey] = useState(0)

  // 목적: 업로드 타입(image/audio/video)을 바꾸고, 앞서 고른 파일을 입력창과 state 양쪽에서 비운다.
  // 이유: 입력창이 이전 파일명을 계속 보여주는데 state는 null이라, 같은 파일을 다시 고르면 change
  //       이벤트가 오지 않고 "Please choose a … file"이 떠서 Choose File이 먹통처럼 보였다.
  // 방법: setFile(null)에 더해 fileInputKey를 올려 입력 요소를 remount한다.
  function onFieldTypeChange(next: UploadFieldType) {
    setFieldType(next)
    setFile(null) // 한 타입에서 고른 파일은 다른 타입의 허용목록에서는 유효하지 않다
    setFileInputKey((k) => k + 1)
  }

  // 목적: 두 단계 업로드(attach→promote)를 수행하고, promote 응답이 신규(201)인지 이미 청구된
  //       업로드의 replay(200, ADR 0019)인지를 사용자에게 구분해 보여준다.
  // 이유: request()는 status를 버려 200/201을 구분 못 했다 — 이 호출부만 postWithStatus로 바꿔
  //       status를 읽는다. 409 FILE_ALREADY_CLAIMED(다른 사람이 이미 청구)는 이 얘기와 다르며
  //       messageForError가 이미 처리한다.
  // 방법: attach는 그대로 두고, promote만 api.postWithStatus로 바꿔 status===200이면 replay 문구,
  //       201이면 기존 성공 흐름(별도 안내 없음). 성공하면 fileInputKey를 올려 입력창도 비운다 —
  //       실패했을 때는 파일을 그대로 둬서 같은 파일로 바로 재시도할 수 있다.
  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (!file) {
      setError(`upload.err.fileRequired.${fieldType}`)
      return
    }
    setBusy(true)
    setProgress(0)
    try {
      // 1단계: 실제 파일을 file/temp에 attach한다 — multipart boundary는 브라우저가 설정한다.
      // 업로드 진행률을 보고할 수 있도록 (api.postForm이 아니라) XHR 기반 래퍼를 쓴다.
      const form = new FormData()
      form.append(fieldType, file)
      const { filename } = await api.postFormWithProgress<AttachResponse>(
        '/upload/attach',
        form,
        (loaded, total) => setProgress(Math.round((loaded / total) * 100)),
      )

      // 2단계: temp_ 파일을 영구 FileEntity 행으로 승격한다.
      setProgress(null)
      const { status } = await api.postWithStatus<FileResponse>('/file', { title, filePath: filename })
      if (status === 200) {
        setNotice('upload.notice.replayed')
      }

      setTitle('')
      setFile(null)
      setFileInputKey((k) => k + 1)
      onUploaded()
    } catch (err) {
      setError(messageForError(err, fieldType))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <h2 className={styles.heading}>{t('upload.heading')}</h2>
      <label className={styles.field}>
        {t('common.title')}
        <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <div className={styles.radioGroup}>
        {(Object.keys(FIELD_CONFIG) as UploadFieldType[]).map((type) => (
          <label key={type} className={styles.radioLabel}>
            <input
              type="radio"
              name="uploadFieldType"
              value={type}
              checked={fieldType === type}
              onChange={() => onFieldTypeChange(type)}
              disabled={busy}
            />
            {t(FIELD_CONFIG[type].label)}
          </label>
        ))}
      </div>
      <label className={styles.field}>
        {t('upload.fileLabel', { type: t(FIELD_CONFIG[fieldType].label), hint: FIELD_CONFIG[fieldType].hint })}
        <input
          key={fileInputKey}
          type="file"
          className={styles.fileInput}
          accept={FIELD_CONFIG[fieldType].accept}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </label>
      {progress !== null && (
        <div className={styles.progress}>
          <progress value={progress} max={100} className={styles.progressBar} />
          <span className={styles.progressText}>{progress}%</span>
        </div>
      )}
      {notice && <p className={styles.notice}>{t(notice)}</p>}
      {error && <p className={styles.error}>{t(error)}</p>}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? t('upload.submitting') : t('upload.submit')}
      </button>
    </form>
  )
}
