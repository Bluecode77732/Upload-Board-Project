// 목적: 게시글 작성자가 본인 소유 파일 중 하나를 새 게시글에 첨부하도록(또는 첨부 안 함) 선택하게 한다.
// 사용처: PostForm 내부에 렌더링된다; 선택된 fileId를 onChange로 알려 POST /post 본문에 담는다.
// 근거: "내 미청구 파일" 전용 엔드포인트가 없어 GET /file?creatorId=<me>를 재사용한다(FileBoard가
//   이미 쓰는 것과 같은 쿼리) — FileResponse가 게시글로의 역참조를 갖지 않으므로, 미청구 불변식은
//   제출 시 서버가(409 POST_FILE_TAKEN) 단독으로 강제한다.

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import type { FileListResponse, FileResponse } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import styles from './FilePicker.module.css'

const TAKE = 50

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_FAILED:
        return 'Invalid search value.'
      default:
        return 'Failed to load your files.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function FilePicker({
  value,
  onChange,
  disabled,
}: {
  value: number | undefined
  onChange: (fileId: number | undefined) => void
  disabled?: boolean
}) {
  const { currentUserId } = useAuth()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [files, setFiles] = useState<FileResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 자유 텍스트 검색을 디바운스해 키 입력마다 요청이 나가지 않게 한다.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  const loadFiles = useCallback(() => {
    if (currentUserId === null) return
    const params = new URLSearchParams()
    params.set('take', String(TAKE))
    params.set('creatorId', String(currentUserId))
    if (debouncedSearch) params.set('search', debouncedSearch)

    api
      .get<FileListResponse>(`/file?${params.toString()}`)
      .then(([rows]) => {
        setFiles(rows)
        setError(null)
      })
      .catch((err: unknown) => setError(messageForError(err)))
  }, [currentUserId, debouncedSearch])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  return (
    <div className={styles.wrapper}>
      <label className={styles.field}>
        Attach a file (optional)
        <input
          className={styles.input}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={100}
          placeholder="Search your files…"
          disabled={disabled}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      {files === null && !error && <p className={styles.loadingText}>Loading your files…</p>}
      <div className={styles.listBox}>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="filePicker"
            checked={value === undefined}
            onChange={() => onChange(undefined)}
            disabled={disabled}
          />
          No file
        </label>
        {files && files.length === 0 && <p className={styles.emptyText}>No files found.</p>}
        {files?.map((file) => (
          <label key={file.id} className={styles.radioLabel}>
            <input
              type="radio"
              name="filePicker"
              checked={value === file.id}
              onChange={() => onChange(file.id)}
              disabled={disabled}
            />
            {file.title}
          </label>
        ))}
      </div>
    </div>
  )
}
