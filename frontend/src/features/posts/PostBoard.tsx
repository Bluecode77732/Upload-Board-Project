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
import { useLanguage } from '../../i18n/useLanguage'
import type { MessageKey, Translatable } from '../../i18n/messages'
import { NavBar } from '../../shared/NavBar'
import { PostForm } from './PostForm'
import styles from './PostBoard.module.css'

const TAKE = 20

// 서버에 보내는 sortBy 값은 그대로 두고 화면 라벨만 바꾼다 — createdAt은 사용자에게 "Date"로 보인다.
const SORT_FIELD_LABEL: Record<PostSortField, MessageKey> = {
  createdAt: 'sort.date',
  title: 'sort.title',
  id: 'sort.id',
}

// 목적: 게시글 목록 조회 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_FAILED:
        return 'board.err.invalidFilter'
      default:
        return 'post.err.loadFailed'
    }
  }
  return 'common.networkError'
}

export function PostBoard() {
  const { t } = useLanguage()
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
  const [error, setError] = useState<Translatable | null>(null)

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
      <h1>{t('post.heading')}</h1>
      <PostForm onCreated={() => setRefreshSignal((n) => n + 1)} />

      <section className={styles.board}>
        <div className={styles.filters}>
          <label className={`${styles.field} ${styles.searchField}`}>
            {t('common.search')}
            <input
              className={styles.input}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
              placeholder={t('board.searchPlaceholder')}
            />
          </label>
          <label className={styles.field}>
            {t('board.sortBy')}
            <select className={styles.select} value={sortBy} onChange={(e) => setSortBy(e.target.value as PostSortField)}>
              {POST_SORT_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(SORT_FIELD_LABEL[field])}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {t('board.order')}
            <select className={styles.select} value={order} onChange={(e) => setOrder(e.target.value as SortOrder)}>
              {SORT_ORDERS.map((direction) => (
                <option key={direction} value={direction}>
                  {t(direction === 'ASC' ? 'sort.ascending' : 'sort.descending')}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {t('common.creatorId')}
            <input
              className={`${styles.input} ${styles.creatorInput}`}
              value={creatorIdInput}
              onChange={(e) => setCreatorIdInput(e.target.value)}
              inputMode="numeric"
              placeholder={t('board.anyCreator')}
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
              {t('board.clearFilter')}
            </button>
          )}
        </div>

        {!creatorIdValid && <p className={styles.error}>{t('board.err.creatorIdInvalid')}</p>}
        {error && <p className={styles.error}>{t(error)}</p>}
        {posts === null && !error && <p>{t('common.loading')}</p>}
        {posts && posts.length === 0 && <p>{t('post.empty')}</p>}
        {posts && posts.length > 0 && (
          <ul className={styles.list}>
            {posts.map((post) => {
              const creator = post.creator
              return (
                <li key={post.id} className={styles.row}>
                  <span className={styles.rowInfo}>
                    {post.file && <span title={t('post.attachedFileTitle')}>📎</span>}
                    <Link to={`/posts/${post.id}`}>{post.title}</Link>
                  </span>
                  {creator && (
                    <button
                      type="button"
                      title={t('board.creatorFilterTitle')}
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
              {t('board.previous')}
            </button>
            <span>
              {t('board.range', { from: Math.min(skip + 1, total), to: Math.min(skip + TAKE, total), total })}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              disabled={!canGoNext}
              onClick={() => setSkip((s) => s + TAKE)}
            >
              {t('board.next')}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
