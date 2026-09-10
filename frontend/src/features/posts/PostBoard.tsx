// 목적: 홈 화면 — 새 게시글 폼과 검색/정렬/페이지네이션 가능한 게시글 목록을 담는다.
// 사용처: RequireAuth 하위 "/"에 렌더링된다; PostForm 제출이 성공하면 refreshSignal을 올려
//   목록이 현재 쿼리를 다시 실행한다 — DashboardPage의 UploadForm+FileBoard 조합과 같은 패턴.
// 근거: Posts가 앱의 홈이다(backend Stage 3 board 완료); 목록은 FileBoard의 검색/정렬/
//   creator-필터/페이지네이션 패턴을 그대로 재사용해 GET /post에 갈아 끼웠다(ADR 0021/0023).

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

// 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011).
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
  // 값 자체에는 의미가 없다 — 값을 올리면 아래의 현재 쿼리만 다시 트리거된다
  // (예: PostForm이 게시 성공 후 이 값을 올린다).
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

  // 자유 텍스트 검색을 디바운스해 키 입력마다 요청이 나가지 않게 한다.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  // 필터가 바뀌면 현재 페이지는 무효가 된다 — 첫 페이지로 되돌아간다.
  useEffect(() => {
    setSkip(0)
  }, [debouncedSearch, sortBy, order, creatorIdInput])

  const creatorIdTrimmed = creatorIdInput.trim()
  const creatorId = creatorIdTrimmed === '' ? undefined : Number(creatorIdTrimmed)
  // GetPostsDto의 @IsInt @Min(1)을 그대로 반영한다 — 잘못된 값은 무조건 400
  // VALIDATION_FAILED로 보내는 대신 클라이언트에서 미리 막아둔다.
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
    // refreshSignal 값 자체에는 의미가 없다 — 이 동일한 쿼리를 다시 트리거할 뿐이다.
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
