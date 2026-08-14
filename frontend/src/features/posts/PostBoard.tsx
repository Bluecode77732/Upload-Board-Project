// Purpose: the home screen — hosts the new-post form and the searchable/sortable/paginated post list.
// Usage: rendered at "/" behind RequireAuth; a successful PostForm submit bumps refreshSignal so the
//   list re-runs its current query, mirroring DashboardPage's UploadForm+FileBoard pairing.
// Rationale: Posts is the app's home (backend Stage 3 board complete); the list reuses FileBoard's
//   search/sort/creator-filter/pagination pattern verbatim, swapped onto GET /post (ADR 0021/0023).

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import { POST_SORT_FIELDS, SORT_ORDERS } from '../../api/types'
import type { PostListResponse, PostResponse, PostSortField, SortOrder } from '../../api/types'
import { NavBar } from '../../shared/NavBar'
import { PostForm } from './PostForm'
import styles from './PostBoard.module.css'

const TAKE = 20

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_FAILED:
        return 'Invalid search or filter value.'
      default:
        return 'Failed to load posts.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function PostBoard() {
  // Has no meaning of its own — bumping it only re-triggers the current query below
  // (e.g. PostForm bumps it after a successful post).
  const [refreshSignal, setRefreshSignal] = useState(0)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState<PostSortField>('createdAt')
  const [order, setOrder] = useState<SortOrder>('DESC')
  const [creatorIdInput, setCreatorIdInput] = useState('')
  const [skip, setSkip] = useState(0)
  const [posts, setPosts] = useState<PostResponse[] | null>(null)
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
  // Mirrors GetPostsDto's @IsInt @Min(1) — an invalid value is held back client-side
  // instead of being sent as a guaranteed 400 VALIDATION_FAILED.
  const creatorIdValid = creatorId === undefined || (Number.isInteger(creatorId) && creatorId >= 1)

  const loadPosts = useCallback(() => {
    if (!creatorIdValid) return
    const params = new URLSearchParams()
    params.set('take', String(TAKE))
    params.set('skip', String(skip))
    if (debouncedSearch) params.set('search', debouncedSearch)
    params.set('sortBy', sortBy)
    params.set('order', order)
    if (creatorId !== undefined) params.set('creatorId', String(creatorId))

    api
      .get<PostListResponse>(`/post?${params.toString()}`)
      .then(([rows, totalCount]) => {
        setPosts(rows)
        setTotal(totalCount)
        setError(null)
      })
      .catch((err: unknown) => setError(messageForError(err)))
  }, [skip, debouncedSearch, sortBy, order, creatorId, creatorIdValid])

  useEffect(() => {
    // refreshSignal has no meaning of its own — it only re-triggers this same query.
    loadPosts()
  }, [loadPosts, refreshSignal])

  const canGoPrev = skip > 0
  const canGoNext = skip + TAKE < total
  const filtersActive = search !== '' || sortBy !== 'createdAt' || order !== 'DESC' || creatorIdInput !== ''

  return (
    <main className={styles.page}>
      <NavBar />
      <h1>Posts</h1>
      <PostForm onCreated={() => setRefreshSignal((n) => n + 1)} />

      <section className={styles.board}>
        <div className={styles.filters}>
          <label className={styles.field}>
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
            <select className={styles.select} value={sortBy} onChange={(e) => setSortBy(e.target.value as PostSortField)}>
              {POST_SORT_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Order
            <select className={styles.select} value={order} onChange={(e) => setOrder(e.target.value as SortOrder)}>
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
        {posts === null && !error && <p>Loading posts…</p>}
        {posts && posts.length === 0 && <p>No posts match the current filters.</p>}
        {posts && posts.length > 0 && (
          <ul className={styles.list}>
            {posts.map((post) => {
              const creator = post.creator
              return (
                <li key={post.id} className={styles.row}>
                  <span className={styles.rowInfo}>
                    {post.file && <span title="Has an attached file">📎</span>}
                    <Link to={`/posts/${post.id}`}>{post.title}</Link>
                  </span>
                  {creator && (
                    <button
                      type="button"
                      title="Filter the list to this creator"
                      className={styles.creatorButton}
                      onClick={() => setCreatorIdInput(String(creator.id))}
                    >
                      {creator.email}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {posts && total > 0 && (
          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.pageButton}
              disabled={!canGoPrev}
              onClick={() => setSkip((s) => Math.max(0, s - TAKE))}
            >
              Previous
            </button>
            <span>
              {Math.min(skip + 1, total)}–{Math.min(skip + TAKE, total)} of {total}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              disabled={!canGoNext}
              onClick={() => setSkip((s) => s + TAKE)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
