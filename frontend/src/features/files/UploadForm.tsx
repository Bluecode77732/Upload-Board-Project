// 목적: 브라우저에서 백엔드의 2단계 업로드를 구동한다 — POST /upload/attach(multipart)
//   후 POST /file로 temp_ 파일을 영구 FileEntity 행으로 승격한다.
// 사용처: RequireAuth 하위 DashboardPage 내부에 렌더링된다; onUploaded()를 호출해 목록을 새로고침한다.
// 근거: 업로드는 이 앱의 핵심 쓰기 경로이자 고정된 temp_→granted_ 계약의 첫 실제 소비자다 —
//   승격이 성공하면 즉시 반영되도록 파일 목록 옆에 둔다.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { AttachResponse, FileResponse } from '../../api/types'
import styles from './UploadForm.module.css'

// 백엔드의 필드별 허용목록(upload.controller.ts UPLOAD_ALLOWLIST, ADR 0027)을 그대로 반영한다:
// 이 세 multipart 필드 중 정확히 하나만, 필드마다 고유한 확장자/mimetype과 100MB 상한을 가진다.
type UploadFieldType = 'image' | 'audio' | 'video'

const FIELD_CONFIG: Record<UploadFieldType, { label: string; accept: string; hint: string }> = {
  image: { label: 'Image', accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', hint: 'jpg, jpeg, png, webp' },
  audio: { label: 'Audio', accept: 'audio/mpeg,.mp3', hint: 'mp3' },
  video: { label: 'Video', accept: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm', hint: 'mp4, mov, webm' },
}

function messageForError(error: unknown, fieldType: UploadFieldType): string {
  if (error instanceof ApiError) {
    // 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011).
    switch (error.code) {
      case ErrorCode.UPLOAD_INVALID_TYPE:
        return `Only ${FIELD_CONFIG[fieldType].label.toLowerCase()} files are allowed (${FIELD_CONFIG[fieldType].hint}).`
      case ErrorCode.UPLOAD_FILE_REQUIRED:
        return `Please choose a ${FIELD_CONFIG[fieldType].label.toLowerCase()} file to upload.`
      case ErrorCode.UPLOAD_MULTIPLE_FIELDS:
        // 이 폼에서는 도달할 수 없다(항상 필드 하나만 보낸다), 그래도 실제 백엔드 코드다(ADR 0025 D5).
        return 'Only one file may be attached at a time.'
      case ErrorCode.PAYLOAD_TOO_LARGE:
        return 'That file is too large — the limit is 100 MB.'
      case ErrorCode.FILE_TITLE_TAKEN:
        return 'A file with that title already exists — pick another.'
      case ErrorCode.FILE_INVALID_PATH:
        return 'Upload could not be completed — please try again.'
      case ErrorCode.FILE_ALREADY_CLAIMED:
        // 이 temp 업로드는 이미 다른 사람이 승격시켰다(ADR 0019, 409).
        return 'That upload was already claimed — please attach the file again.'
      case ErrorCode.VALIDATION_FAILED:
        return 'Please enter a title and choose a file.'
      default:
        return 'Upload failed. Please try again.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [title, setTitle] = useState('')
  const [fieldType, setFieldType] = useState<UploadFieldType>('video')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 지금까지 전송된 1단계(attach 업로드)의 진행률(0-100); 대기 중이거나 2단계(작은 JSON
  // promote 호출 — 그 자체로는 의미 있는 진행률이 없다) 동안에는 null.
  const [progress, setProgress] = useState<number | null>(null)
  // replay된 청구(200)와 신규 승격(201, ADR 0019)을 구분한다 — 다음 제출 시 초기화해
  // 오래된 안내 문구가 그 업로드가 끝난 뒤까지 남아있지 않게 한다.
  const [notice, setNotice] = useState<string | null>(null)

  function onFieldTypeChange(next: UploadFieldType) {
    setFieldType(next)
    setFile(null) // 한 타입에서 고른 파일은 다른 타입의 허용목록에서는 유효하지 않다
  }

  // 목적: 두 단계 업로드(attach→promote)를 수행하고, promote 응답이 신규(201)인지 이미 청구된
  //       업로드의 replay(200, ADR 0019)인지를 사용자에게 구분해 보여준다.
  // 이유: request()는 status를 버려 200/201을 구분 못 했다 — 이 호출부만 postWithStatus로 바꿔
  //       status를 읽는다. 409 FILE_ALREADY_CLAIMED(다른 사람이 이미 청구)는 이 얘기와 다르며
  //       messageForError가 이미 처리한다.
  // 방법: attach는 그대로 두고, promote만 api.postWithStatus로 바꿔 status===200이면 replay 문구,
  //       201이면 기존 성공 흐름(별도 안내 없음).
  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (!file) {
      setError(`Please choose a ${FIELD_CONFIG[fieldType].label.toLowerCase()} file to upload.`)
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
        setNotice('This file was already uploaded — reusing the existing entry.')
      }

      setTitle('')
      setFile(null)
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
      <h2 className={styles.heading}>Upload a file</h2>
      <label className={styles.field}>
        Title
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
            {FIELD_CONFIG[type].label}
          </label>
        ))}
      </div>
      <label className={styles.field}>
        {FIELD_CONFIG[fieldType].label} file ({FIELD_CONFIG[fieldType].hint} · max 100 MB)
        <input
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
      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  )
}
