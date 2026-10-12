// 목적: 브라우저에서 백엔드의 2단계 업로드를 구동한다 — POST /upload/attach(multipart)
//   후 POST /file로 temp_ 파일을 영구 FileEntity 행으로 승격한다. 여러 파일을 한 번에 고르면
//   파일마다 이 두 단계를 차례로 반복한다.
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
// 요청 하나에는 이 세 multipart 필드 중 정확히 하나만 실을 수 있고, 파일 하나의 상한은 100MB다.
type UploadFieldType = 'image' | 'audio' | 'video'

const FIELD_LABEL: Record<UploadFieldType, MessageKey> = {
  image: 'upload.type.image',
  audio: 'upload.type.audio',
  video: 'upload.type.video',
}

// 확장자 → multipart 필드. 사용자가 종류를 고르지 않아도 파일마다 맞는 필드로 보내기 위한 표다.
const FIELD_BY_EXTENSION: Record<string, UploadFieldType> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  mp3: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
}

const ACCEPT =
  'image/jpeg,image/png,image/webp,audio/mpeg,video/mp4,video/quicktime,video/webm,' +
  Object.keys(FIELD_BY_EXTENSION)
    .map((extension) => `.${extension}`)
    .join(',')

// POST /upload/attach는 분당 15회로 제한된다(backend ADR 0054). 파일 하나가 요청 하나라서
// 한 번에 고를 수 있는 수도 여기에 맞춘다.
const MAX_FILES = 15

type RowStatus = 'pending' | 'uploading' | 'done' | 'failed'

// 고른 파일 하나의 진행 상태. tempFilename은 attach가 끝난 뒤에만 채워지며, 승격만 실패했을 때
// (예: 제목 중복) 파일을 다시 보내지 않고 승격만 재시도하게 해 준다.
type UploadRow = {
  id: number
  file: File
  fieldType: UploadFieldType | null
  title: string
  status: RowStatus
  progress: number | null
  tempFilename: string | null
  error: Translatable | null
  notice: Translatable | null
}

// 목적: 파일 이름에서 소문자 확장자를 꺼낸다.
// 이유: 종류 판별과 기본 제목 둘 다 확장자 경계를 알아야 한다.
// 방법: 마지막 점 뒤를 잘라 소문자로 바꾼다. 점이 없으면 빈 문자열.
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

// 목적: 고른 파일의 기본 제목을 만든다.
// 이유: 여러 개를 고르면 제목을 하나하나 처음부터 치기 번거롭다. 원본 파일명을 그대로 쓰고,
//       겹치면 그 줄에서 사용자가 고친다.
// 방법: 확장자를 뗀 파일명. 떼고 나서 빈 문자열이면 파일명 전체를 쓴다.
function defaultTitle(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return base.trim() || name
}

// 목적: 업로드 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
//       허용 형식 문구는 키를 타입마다 따로 둬서 한국어도 완전한 문장이 되게 했다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown, fieldType: UploadFieldType): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.UPLOAD_INVALID_TYPE:
        return `upload.err.invalidType.${fieldType}`
      case ErrorCode.UPLOAD_FILE_REQUIRED:
        return 'upload.err.fileRequired'
      case ErrorCode.UPLOAD_MULTIPLE_FIELDS:
        // 이 폼에서는 도달할 수 없다(요청마다 필드 하나만 보낸다), 그래도 실제 백엔드 코드다(ADR 0025 D5).
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
      case ErrorCode.RATE_LIMITED:
        return 'upload.err.rateLimited'
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
  const [rows, setRows] = useState<UploadRow[]>([])
  // 줄 하나가 아니라 선택 전체에 대한 에러(파일 미선택, 15개 초과).
  const [error, setError] = useState<Translatable | null>(null)
  const [busy, setBusy] = useState(false)
  // 파일 입력은 uncontrolled라 state만 비워서는 브라우저가 들고 있는 선택이 비워지지 않는다 —
  // 이 값을 올려 입력 요소를 새로 마운트시키면 화면에 보이는 선택과 state가 함께 초기화된다.
  const [fileInputKey, setFileInputKey] = useState(0)
  const [nextRowId, setNextRowId] = useState(0)

  // 목적: 줄 하나의 상태 일부만 바꾼다.
  // 이유: 순차 업로드 도중 진행률·결과가 줄마다 따로 갱신되는데, 그때마다 최신 배열을 기준으로 해야 한다.
  // 방법: 함수형 setState로 id가 같은 줄에만 patch를 덮어쓴다.
  function patchRow(id: number, patch: Partial<UploadRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  // 목적: 파일 선택 결과를 업로드할 줄 목록으로 바꾼다.
  // 이유: 한 번에 여러 개, 종류가 섞인 채로 고를 수 있어야 한다. 종류는 사용자가 고르지 않고
  //       확장자로 정한다. 허용되지 않는 확장자는 보내 봐야 400이므로 여기서 미리 표시한다.
  // 방법: MAX_FILES를 넘으면 선택 전체를 거절하고 입력을 비운다. 아니면 파일마다 줄을 만들고
  //       기본 제목을 원본 파일명으로 채운다. 새 선택은 이전 목록을 대체한다.
  function onFilesChosen(list: FileList | null) {
    const files = list ? Array.from(list) : []
    setError(null)
    if (files.length > MAX_FILES) {
      setRows([])
      setFileInputKey((key) => key + 1)
      setError('upload.err.tooMany')
      return
    }
    setRows(
      files.map((file, index) => {
        const fieldType = FIELD_BY_EXTENSION[extensionOf(file.name)] ?? null
        return {
          id: nextRowId + index,
          file,
          fieldType,
          title: defaultTitle(file.name),
          status: fieldType ? 'pending' : 'failed',
          progress: null,
          tempFilename: null,
          error: fieldType ? null : 'upload.err.unsupported',
          notice: null,
        }
      }),
    )
    setNextRowId((id) => id + files.length)
  }

  // 목적: 줄 하나를 attach→promote로 올리고, 결과(완료·실패·중단)를 알려준다.
  // 이유: 파일 하나가 요청 하나라서 실패도 줄 단위로 끝나야 한다. 제목 중복처럼 승격만 실패한 경우
  //       파일을 다시 보내는 것은 낭비고, 429는 다음 줄도 같은 이유로 실패하므로 멈춰야 한다.
  // 방법: tempFilename이 없을 때만 attach하고 받은 이름을 줄에 남긴다. promote가 200이면 replay
  //       문구(ADR 0019)를 붙인다. 실패하면 그 줄에 에러를 남기되, temp 이름이 더는 쓸 수 없는
  //       경우(FILE_INVALID_PATH, FILE_ALREADY_CLAIMED)에는 지워서 다음 시도에 다시 attach하게 한다.
  //       429면 'stop'을 돌려 반복을 멈추게 한다.
  async function uploadRow(row: UploadRow, fieldType: UploadFieldType): Promise<'done' | 'failed' | 'stop'> {
    patchRow(row.id, { status: 'uploading', error: null, notice: null, progress: row.tempFilename ? null : 0 })
    try {
      let filename = row.tempFilename
      if (!filename) {
        // 1단계: 실제 파일을 file/temp에 attach한다 — multipart boundary는 브라우저가 설정한다.
        // 업로드 진행률을 보고할 수 있도록 (api.postForm이 아니라) XHR 기반 래퍼를 쓴다.
        const form = new FormData()
        form.append(fieldType, row.file)
        const attached = await api.postFormWithProgress<AttachResponse>('/upload/attach', form, (loaded, total) =>
          patchRow(row.id, { progress: Math.round((loaded / total) * 100) }),
        )
        filename = attached.filename
        patchRow(row.id, { tempFilename: filename, progress: null })
      }

      // 2단계: temp_ 파일을 영구 FileEntity 행으로 승격한다.
      const { status } = await api.postWithStatus<FileResponse>('/file', { title: row.title, filePath: filename })
      patchRow(row.id, { status: 'done', notice: status === 200 ? 'upload.notice.replayed' : null })
      onUploaded()
      return 'done'
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null
      const tempUnusable = code === ErrorCode.FILE_INVALID_PATH || code === ErrorCode.FILE_ALREADY_CLAIMED
      patchRow(row.id, {
        status: 'failed',
        progress: null,
        error: messageForError(err, fieldType),
        ...(tempUnusable ? { tempFilename: null } : {}),
      })
      return code === ErrorCode.RATE_LIMITED ? 'stop' : 'failed'
    }
  }

  // 목적: 아직 올라가지 않은 줄을 위에서부터 하나씩 올린다.
  // 이유: 백엔드는 요청 하나에 파일 하나만 받는다(ADR 0065). 여러 개를 한 번에 올리려면 같은 요청을
  //       파일 수만큼 반복하면 되고, 하나씩 보내야 한 줄의 실패가 다른 줄에 번지지 않는다.
  // 방법: 대기·실패 상태이면서 허용된 종류인 줄만 골라 차례로 uploadRow를 기다린다. 다시 누르면
  //       끝난 줄은 건너뛰므로 실패한 줄만 재시도된다. 전부 끝나면 입력 요소를 비운다.
  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const targets = rows.filter((row) => row.status !== 'done' && row.fieldType !== null)
    if (targets.length === 0) {
      setError('upload.err.fileRequired')
      return
    }
    setBusy(true)
    try {
      let allDone = rows.every((row) => row.status === 'done' || row.fieldType !== null)
      for (const row of targets) {
        if (row.fieldType === null) continue
        const outcome = await uploadRow(row, row.fieldType)
        if (outcome !== 'done') allDone = false
        if (outcome === 'stop') break
      }
      if (allDone) setFileInputKey((key) => key + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <h2 className={styles.heading}>{t('upload.heading')}</h2>
      <label className={styles.field}>
        {t('upload.fileLabel', { max: MAX_FILES })}
        <input
          key={fileInputKey}
          type="file"
          multiple
          className={styles.fileInput}
          accept={ACCEPT}
          onChange={(e) => onFilesChosen(e.target.files)}
          disabled={busy}
        />
      </label>
      {rows.length > 0 && (
        <ol className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.fileName}>{row.file.name}</span>
                {row.fieldType && <span className={styles.kind}>{t(FIELD_LABEL[row.fieldType])}</span>}
                {row.status === 'done' ? (
                  <span className={styles.done}>{t('upload.status.done')}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={t('upload.remove', { name: row.file.name })}
                    onClick={() => setRows((current) => current.filter((other) => other.id !== row.id))}
                    disabled={busy}
                  >
                    {t('upload.removeShort')}
                  </button>
                )}
              </div>
              {row.status === 'done' ? (
                <span className={styles.doneTitle}>{row.title}</span>
              ) : (
                row.fieldType && (
                  <label className={styles.field}>
                    {t('common.title')}
                    <input
                      className={styles.input}
                      value={row.title}
                      onChange={(e) => patchRow(row.id, { title: e.target.value })}
                      disabled={busy}
                      required
                    />
                  </label>
                )
              )}
              {row.progress !== null && (
                <div className={styles.progress}>
                  <progress value={row.progress} max={100} className={styles.progressBar} />
                  <span className={styles.progressText}>{row.progress}%</span>
                </div>
              )}
              {row.notice && <p className={styles.notice}>{t(row.notice)}</p>}
              {row.error && <p className={styles.error}>{t(row.error)}</p>}
            </li>
          ))}
        </ol>
      )}
      {error && <p className={styles.error}>{t(error)}</p>}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? t('upload.submitting') : t('upload.submit')}
      </button>
    </form>
  )
}
