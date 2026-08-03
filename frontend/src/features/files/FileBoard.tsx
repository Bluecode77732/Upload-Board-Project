// Purpose: the file board — search, sort, creator filter, and pagination over GET /file, with a
//   visibility badge per row (ADR 0021 list query, ADR 0025/0026 visibility).
// Usage: rendered by DashboardPage; bumping `refreshSignal` re-runs the current query (e.g. after upload).
// Rationale: DashboardPage's list was take/skip-only — this consumes the rest of the ADR 0021 contract
//   without a data-fetching library (plain fetch + React state, per frontend CLAUDE.md).

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import { FILE_SORT_FIELDS, SORT_ORDERS } from '../../api/types'
import type { FileListResponse, FileResponse, FileSortField, SortOrder } from '../../api/types'
import { VisibilityBadge } from './VisibilityBadge'

const TAKE = 20

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
  const [skip, setSkip] = useState(0)
  const [files, setFiles] = useState<FileResponse[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Debounce the free-text search so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  // Any filter change invalidates the current page — jump back to the first page.
  useEffect(() => {
    setSkip(0)
  }, [debouncedSearch, sortBy, order, creatorIdInput])

  const creatorIdTrimmed = creatorIdInput.trim()
  const creatorId = creatorIdTrimmed === '' ? undefined : Number(creatorIdTrimmed)
  // Mirrors GetFilesDto's @IsInt @Min(1) — an invalid value is held back client-side
  // instead of being sent as a guaranteed 400 VALIDATION_FAILED.
  const creatorIdValid = creatorId === undefined || (Number.isInteger(creatorId) && creatorId >= 1)

  const loadFiles = useCallback(() => {
    if (!creatorIdValid) return
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
        setFiles(rows)
        setTotal(totalCount)
        setError(null)
      })
      .catch((err: unknown) => setError(messageForError(err)))
  }, [skip, debouncedSearch, sortBy, order, creatorId, creatorIdValid])

  useEffect(() => {
    // refreshSignal has no meaning of its own — it only re-triggers this same query
    // (e.g. DashboardPage bumps it after a successful upload).
    loadFiles()
  }, [loadFiles, refreshSignal])

  const canGoPrev = skip > 0
  const canGoNext = skip + TAKE < total
  const filtersActive = search !== '' || sortBy !== 'createdAt' || order !== 'DESC' || creatorIdInput !== ''

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
            placeholder="Title contains…"
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Sort by
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as FileSortField)}>
            {FILE_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Order
          <select value={order} onChange={(e) => setOrder(e.target.value as SortOrder)}>
            {SORT_ORDERS.map((direction) => (
              <option key={direction} value={direction}>
                {direction === 'ASC' ? 'Ascending' : 'Descending'}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Creator ID
          <input
            value={creatorIdInput}
            onChange={(e) => setCreatorIdInput(e.target.value)}
            inputMode="numeric"
            placeholder="Any"
            style={{ width: 80 }}
          />
        </label>
        {filtersActive && (
          <button
            type="button"
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

      {!creatorIdValid && <p style={{ color: 'crimson' }}>Creator ID must be a positive whole number.</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {files === null && !error && <p>Loading files…</p>}
      {files && files.length === 0 && <p>No files match the current filters.</p>}
      {files && files.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {files.map((file) => {
            const creator = file.creator
            return (
              <li
                key={file.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: 6,
                }}
              >
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <VisibilityBadge visibility={file.visibility} />
                  <Link to={`/view/${file.id}`}>{file.title}</Link>
                </span>
                {creator && (
                  <button
                    type="button"
                    title="Filter the list to this creator"
                    onClick={() => setCreatorIdInput(String(creator.id))}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}
                  >
                    {creator.email}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {files && total > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <button type="button" disabled={!canGoPrev} onClick={() => setSkip((s) => Math.max(0, s - TAKE))}>
            Previous
          </button>
          <span>
            {Math.min(skip + 1, total)}–{Math.min(skip + TAKE, total)} of {total}
          </span>
          <button type="button" disabled={!canGoNext} onClick={() => setSkip((s) => s + TAKE)}>
            Next
          </button>
        </div>
      )}
    </section>
  )
}
