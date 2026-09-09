// 목적: 파일 보드 — 제목 검색, 정렬, creator 필터, 그리고 GET /file 위에 무한 스크롤되는 3열
//   미리보기 그리드, 타일마다 visibility 배지가 붙는다(ADR 0021 목록 쿼리, ADR 0025/0026).
// 사용처: DashboardPage가 렌더링한다; `refreshSignal`이 올라가면 현재 쿼리를 0페이지부터
//   다시 실행한다(예: 업로드 후).
// 근거: DashboardPage의 목록은 take/skip만 있었다 — 이 컴포넌트가 데이터 페칭 라이브러리 없이
//   (frontend CLAUDE.md 방침대로 plain fetch + React state) ADR 0021 계약의 나머지를 소비한다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import { FILE_SORT_FIELDS, SORT_ORDERS } from '../../api/types'
import type { FileListResponse, FileResponse, FileSortField, SortOrder } from '../../api/types'
import { FilePreviewTile } from './FilePreviewTile'
import styles from './FileBoard.module.css'

// 한 페이지가 그리드의 3x3 화면 하나를 정확히 채우므로, 스크롤은 한 번에 3xN 행 단위로 늘어난다.
const TAKE = 9
// 그리드가 3열 x 60행을 채우면 자동 로딩이 멈춘다; 그 뒤부터는 사용자가 명시적으로 요청해야 하므로
// 가만히 스크롤만 해서는 테이블 전체가 메모리로 딸려 들어오지 않는다.
const AUTO_LOAD_MAX = 180

// 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011).
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_FAILED:
        return 'Invalid search or filter value.'
      default:
        return 'Failed to load files.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function FileBoard({ refreshSignal }: { refreshSignal: number }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState<FileSortField>('createdAt')
  const [order, setOrder] = useState<SortOrder>('DESC')
  const [creatorIdInput, setCreatorIdInput] = useState('')
  const [files, setFiles] = useState<FileResponse[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // 가장 최신 요청만 상태를 쓸 수 있다: 그렇지 않으면 요청 도중 필터가 바뀌었을 때 오래된
  // 페이지가 새 쿼리의 결과 뒤에 이어 붙어버릴 수 있다.
  const requestId = useRef(0)

  // 자유 텍스트 검색을 디바운스해 키 입력마다 요청이 나가지 않게 한다.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  const creatorIdTrimmed = creatorIdInput.trim()
  const creatorId = creatorIdTrimmed === '' ? undefined : Number(creatorIdTrimmed)
  // GetFilesDto의 @IsInt @Min(1)을 그대로 반영한다 — 잘못된 값은 무조건 400
  // VALIDATION_FAILED로 보내는 대신 클라이언트에서 미리 막아둔다.
  const creatorIdValid = creatorId === undefined || (Number.isInteger(creatorId) && creatorId >= 1)

  // 목적: GET /file의 한 페이지를 읽어 그리드에 이어 붙이거나(append) 처음부터 채운다.
  // 이유: 페이저가 무한 스크롤로 바뀌면서 목록이 "현재 페이지"가 아니라 "지금까지 쌓인 누적분"이 됐다.
  // 방법: 요청마다 증가하는 id를 찍어 최신 요청만 상태를 쓰게 하고, append면 기존 배열 뒤에 이어 붙인다.
  const fetchPage = useCallback(
    (skip: number, append: boolean) => {
      if (!creatorIdValid) return
      const id = ++requestId.current
      setLoading(true)

      const params = new URLSearchParams()
      params.set('take', String(TAKE))
      params.set('skip', String(skip))
      if (debouncedSearch) params.set('search', debouncedSearch)
      params.set('sortBy', sortBy)
      params.set('order', order)
      if (creatorId !== undefined) params.set('creatorId', String(creatorId))

      api
        .get<FileListResponse>(`/file?${params.toString()}`)
        .then(([rows, totalCount]) => {
          if (id !== requestId.current) return
          setFiles((current) => (append && current ? [...current, ...rows] : rows))
          setTotal(totalCount)
          setError(null)
        })
        .catch((err: unknown) => {
          if (id === requestId.current) setError(messageForError(err))
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false)
        })
    },
    [debouncedSearch, sortBy, order, creatorId, creatorIdValid],
  )

  // 필터가 바뀌거나(또는 refreshSignal이 올라가면) 지금까지 쌓인 것이 전부 무효가 된다 —
  // 그리드를 버리고 0페이지부터 다시 채운다.
  useEffect(() => {
    setFiles(null)
    fetchPage(0, false)
  }, [fetchPage, refreshSignal])

  const loadedCount = files?.length ?? 0
  const hasMore = files !== null && loadedCount < total
  const autoLoadPaused = loadedCount >= AUTO_LOAD_MAX

  // 그리드 아래 sentinel이 뷰포트에 들어오면 그리드를 자동으로 늘린다. 매 로드 후 다시 만들어지므로
  // (files가 의존성이다) 다음 페이지는 이전 페이지가 도착한 뒤에만 준비된다.
  useEffect(() => {
    if (files === null || !hasMore || autoLoadPaused || loading) return
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchPage(files.length, true)
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [files, hasMore, autoLoadPaused, loading, fetchPage])

  const filtersActive =
    search !== '' || sortBy !== 'createdAt' || order !== 'DESC' || creatorIdInput !== ''

  return (
    <section className={styles.board}>
      <div className={styles.filters}>
        <label className={`${styles.field} ${styles.searchField}`}>
          Search
          <input
            className={styles.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
            placeholder="Title contains…"
          />
        </label>
        <label className={styles.field}>
          Sort by
          <select
            className={styles.select}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as FileSortField)}
          >
            {FILE_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Order
          <select
            className={styles.select}
            value={order}
            onChange={(e) => setOrder(e.target.value as SortOrder)}
          >
            {SORT_ORDERS.map((direction) => (
              <option key={direction} value={direction}>
                {direction === 'ASC' ? 'Ascending' : 'Descending'}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Creator ID
          <input
            className={`${styles.input} ${styles.creatorInput}`}
            value={creatorIdInput}
            onChange={(e) => setCreatorIdInput(e.target.value)}
            inputMode="numeric"
            placeholder="Any"
          />
        </label>
        {filtersActive && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => {
              setSearch('')
              setSortBy('createdAt')
              setOrder('DESC')
              setCreatorIdInput('')
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {!creatorIdValid && <p className={styles.error}>Creator ID must be a positive whole number.</p>}
      {error && <p className={styles.error}>{error}</p>}
      {files === null && !error && <p>Loading files…</p>}
      {files && files.length === 0 && <p>No files match the current filters.</p>}
      {files && files.length > 0 && (
        <ul className={styles.grid}>
          {files.map((file) => (
            <FilePreviewTile
              key={file.id}
              file={file}
              onFilterCreator={(id) => setCreatorIdInput(String(id))}
            />
          ))}
        </ul>
      )}

      {/* Watched by the observer above; present in the tree whenever more pages exist, so reaching
          the bottom of the grid is what triggers the next one. */}
      {hasMore && <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />}

      {files && total > 0 && (
        <div className={styles.footer}>
          <span>
            Showing {loadedCount} of {total}
          </span>
          {hasMore && (
            <button
              type="button"
              className={styles.loadMoreButton}
              disabled={loading}
              onClick={() => fetchPage(loadedCount, true)}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
          {hasMore && autoLoadPaused && (
            <span className={styles.autoPausedNote}>
              Auto-loading paused past {AUTO_LOAD_MAX} files.
            </span>
          )}
        </div>
      )}
    </section>
  )
}
