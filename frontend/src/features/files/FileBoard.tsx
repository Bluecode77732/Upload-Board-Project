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
import { useLanguage } from '../../i18n/useLanguage'
import type { MessageKey, Translatable } from '../../i18n/messages'
import { FilePreviewTile } from './FilePreviewTile'
import styles from './FileBoard.module.css'

// 한 페이지가 그리드의 3x3 화면 하나를 정확히 채우므로, 스크롤은 한 번에 3xN 행 단위로 늘어난다.
const TAKE = 9
// 그리드가 3열 x 60행을 채우면 자동 로딩이 멈춘다; 그 뒤부터는 사용자가 명시적으로 요청해야 하므로
// 가만히 스크롤만 해서는 테이블 전체가 메모리로 딸려 들어오지 않는다.
const AUTO_LOAD_MAX = 180

// 서버에 보내는 sortBy 값은 그대로 두고 화면 라벨만 바꾼다 — createdAt은 사용자에게 "Date"로 보인다.
const SORT_FIELD_LABEL: Record<FileSortField, MessageKey> = {
  createdAt: 'sort.date',
  title: 'sort.title',
  id: 'sort.id',
}

// 목적: 파일 목록 조회 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_FAILED:
        return 'board.err.invalidFilter'
      default:
        return 'file.err.loadFailed'
    }
  }
  return 'common.networkError'
}

export function FileBoard({ refreshSignal }: { refreshSignal: number }) {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState<FileSortField>('createdAt')
  const [order, setOrder] = useState<SortOrder>('DESC')
  const [creatorIdInput, setCreatorIdInput] = useState('')
  const [files, setFiles] = useState<FileResponse[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Translatable | null>(null)
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

  // 래퍼 없이 프래그먼트로 돌려준다 — 필터·안내 문구·푸터는 main의 720px 칼럼에, 그리드만 칼럼보다 넓게
  // 놓이려면 이 요소들이 main(src/shared/page.module.css)의 직계 자식이어야 하기 때문이다.
  return (
    <>
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
          <select
            className={styles.select}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as FileSortField)}
          >
            {FILE_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {t(SORT_FIELD_LABEL[field])}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t('board.order')}
          <select
            className={styles.select}
            value={order}
            onChange={(e) => setOrder(e.target.value as SortOrder)}
          >
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
      {files === null && !error && <p>{t('common.loading')}</p>}
      {files && files.length === 0 && <p>{t('file.empty')}</p>}
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
          <span>{t('file.footer.showing', { loaded: loadedCount, total })}</span>
          {hasMore && (
            <button
              type="button"
              className={styles.loadMoreButton}
              disabled={loading}
              onClick={() => fetchPage(loadedCount, true)}
            >
              {loading ? t('common.loading') : t('common.loadMore')}
            </button>
          )}
          {hasMore && autoLoadPaused && (
            <span className={styles.autoPausedNote}>{t('file.autoPaused', { max: AUTO_LOAD_MAX })}</span>
          )}
        </div>
      )}
    </>
  )
}
