// Purpose: the file board — title search, sort, creator filter, and an infinitely-scrolling 3-column
//   preview grid over GET /file, with a visibility badge per tile (ADR 0021 list query, ADR 0025/0026).
// Usage: rendered by DashboardPage; bumping `refreshSignal` re-runs the current query from page 0
//   (e.g. after upload).
// Rationale: DashboardPage's list was take/skip-only — this consumes the rest of the ADR 0021 contract
//   without a data-fetching library (plain fetch + React state, per frontend CLAUDE.md).

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import { FILE_SORT_FIELDS, SORT_ORDERS } from '../../api/types'
import type { FileListResponse, FileResponse, FileSortField, SortOrder } from '../../api/types'
import { FilePreviewTile } from './FilePreviewTile'
import styles from './FileBoard.module.css'

// One page fills exactly one 3x3 screen of the grid, so scrolling extends 3xN a row-triple at a time.
const TAKE = 9
// Auto-loading stops once the grid holds 3 columns x 60 rows; past that the user asks explicitly, so
// an idle scroll cannot walk the whole table into memory.
const AUTO_LOAD_MAX = 180

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
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
  // Only the newest request may write state: a filter change mid-flight would otherwise let the
  // stale page append itself onto the new query's results.
  const requestId = useRef(0)

  // Debounce the free-text search so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  const creatorIdTrimmed = creatorIdInput.trim()
  const creatorId = creatorIdTrimmed === '' ? undefined : Number(creatorIdTrimmed)
  // Mirrors GetFilesDto's @IsInt @Min(1) — an invalid value is held back client-side
  // instead of being sent as a guaranteed 400 VALIDATION_FAILED.
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

  // Any filter change (or a bumped refreshSignal) invalidates everything accumulated so far —
  // drop the grid and refill it from page 0.
  useEffect(() => {
    setFiles(null)
    fetchPage(0, false)
  }, [fetchPage, refreshSignal])

  const loadedCount = files?.length ?? 0
  const hasMore = files !== null && loadedCount < total
  const autoLoadPaused = loadedCount >= AUTO_LOAD_MAX

  // Auto-extend the grid when the sentinel below it comes into view. Re-created after every load
  // (files is a dep) so the next page arms only once the previous one has landed.
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
