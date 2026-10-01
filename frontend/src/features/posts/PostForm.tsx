// 목적: 새 게시글(제목, 본문, 선택적으로 첨부 파일)을 생성한다.
// 사용처: PostBoard 내부에 렌더링된다; 제출 성공 시 onCreated()를 호출해 목록을 새로고침한다.
// 근거: UploadForm의 작성-후-초기화 형태를 그대로 따른다; 200 replay와 201 신규 게시글은
//   여기서 동일하게 처리한다(ADR 0023 D1) — status 코드는 UI 관심사가 아니다.

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { CreatePostRequest, PostResponse } from '../../api/types'
import { useLanguage } from '../../i18n/useLanguage'
import type { Translatable } from '../../i18n/messages'
import { FilePicker } from './FilePicker'
import styles from './PostForm.module.css'

// 목적: 게시글 생성 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
//       VALIDATION_FAILED만은 서버가 준 문구 그대로를 보여줘야 해서 { raw }로 감싼다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.POST_FILE_TAKEN:
        return 'postForm.err.fileTaken'
      case ErrorCode.FILE_NOT_FOUND:
        return 'postForm.err.fileNotFound'
      case ErrorCode.FORBIDDEN_NOT_OWNER:
        return 'postForm.err.notOwner'
      case ErrorCode.VALIDATION_FAILED:
        return { raw: Array.isArray(error.body?.message) ? error.body.message.join(', ') : error.message }
      default:
        return 'postForm.err.createFailed'
    }
  }
  return 'common.networkError'
}

export function PostForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [fileId, setFileId] = useState<number | undefined>(undefined)
  const [error, setError] = useState<Translatable | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const request: CreatePostRequest = { title, body, ...(fileId !== undefined ? { fileId } : {}) }
      await api.post<PostResponse>('/post', request)
      setTitle('')
      setBody('')
      setFileId(undefined)
      onCreated()
    } catch (err) {
      setError(messageForError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <h2 className={styles.heading}>{t('postForm.heading')}</h2>
      <label className={styles.field}>
        {t('common.title')}
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          required
          disabled={busy}
        />
      </label>
      <label className={styles.field}>
        {t('common.body')}
        <textarea
          className={styles.textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          rows={4}
          required
          disabled={busy}
        />
      </label>
      <FilePicker value={fileId} onChange={setFileId} disabled={busy} />
      {error && <p className={styles.error}>{t(error)}</p>}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? t('common.posting') : t('postForm.submit')}
      </button>
    </form>
  )
}
