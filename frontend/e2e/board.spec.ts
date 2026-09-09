// 목적: 실제 UI 업로드 흐름으로 올린 파일들을 대상으로 FileBoard의 검색, 정렬, creator 필터,
//   페이지네이션 컨트롤(ADR 0021 목록 쿼리)을 브라우저 레벨로 검증한다.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: FileBoard의 쿼리 상태(search/sortBy/order/creatorId/skip)는 여기서 함께 검증한다 —
//   상호작용마다 동일한 GET /file 호출을 다시 실행하기 때문이다 — 이 spec이 직접 업로드하고
//   실행마다 고유한 토큰을 붙인 파일 두 개로 검증하면, 공유(never-truncated) dev DB에 뭐가
//   더 있든 단언이 그것과 무관하게 유지된다.

import { test, expect, type Page } from '@playwright/test'
import { registerAndSignIn, goToFiles, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH } from './helpers'

async function uploadVideo(page: Page, title: string) {
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByRole('radio', { name: 'Video' }).check()
  // 먼저 비워야 <input type="file">에 실제 값 변경이 발생한다 — 한 테스트 안에서 반복
  // 호출할 때 동일한 fixture 경로를 연달아 두 번 설정하면 change 이벤트가 안정적으로
  // 발생하지 않는다.
  const fileInput = page.getByLabel(/^Video file/)
  await fileInput.setInputFiles([])
  await fileInput.setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 30_000 })
}

test('search, sort, and pagination reflect files uploaded through the board', async ({ page }) => {
  test.setTimeout(120_000)

  const token = uniqueTitle('board').replace(/\s+/g, '-')
  const titleAlpha = `${token}-Alpha`
  const titleBeta = `${token}-Beta`

  await registerAndSignIn(page, uniqueEmail('board'))
  await goToFiles(page)

  // Alpha를 먼저, Beta를 나중에 업로드한다 — 이렇게 하면 둘의 상대적 createdAt 순서가 고정된다.
  await uploadVideo(page, titleAlpha)
  await uploadVideo(page, titleBeta)

  // --- 검색: 자유 텍스트 토큰이 정확히 이 두 행만 걸러내야 한다 ---
  await page.getByLabel('Search').fill(token)
  await expect(page.locator('ul li')).toHaveCount(2, { timeout: 10_000 })
  await expect(page.locator('ul li a', { hasText: titleAlpha })).toBeVisible()
  await expect(page.locator('ul li a', { hasText: titleBeta })).toBeVisible()

  // --- title로 정렬 ---
  await page.getByLabel('Sort by').selectOption('title')
  await page.getByLabel('Order').selectOption('ASC')
  await expect(page.locator('ul li a')).toHaveText([titleAlpha, titleBeta])

  await page.getByLabel('Order').selectOption('DESC')
  await expect(page.locator('ul li a')).toHaveText([titleBeta, titleAlpha])

  // --- createdAt(업로드 순서)으로 정렬 ---
  await page.getByLabel('Sort by').selectOption('createdAt')
  await page.getByLabel('Order').selectOption('ASC')
  await expect(page.locator('ul li a')).toHaveText([titleAlpha, titleBeta])

  await page.getByLabel('Order').selectOption('DESC')
  await expect(page.locator('ul li a')).toHaveText([titleBeta, titleAlpha])

  // --- creator 필터 + 페이지네이션: 행의 creator 버튼으로 "나"에게 필터링 ---
  const alphaRow = page.locator('li', { hasText: titleAlpha })
  await alphaRow.getByTitle('Filter the list to this creator').click()
  await expect(page.getByLabel('Creator ID')).toHaveValue(/^\d+$/)

  // 페이지 크기(9)보다 훨씬 적은 매칭 타일 두 개 — 이미 전부 로드된 상태라 무한 스크롤
  // 그리드가 더 이상 페이지를 제공하지 않고 "Load more" 대체 버튼도 없다.
  await expect(page.locator('ul li')).toHaveCount(2)
  await expect(page.getByText(/of 2$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0)
})

test('a file not matching the search term is not shown', async ({ page }) => {
  const token = uniqueTitle('board-nomatch').replace(/\s+/g, '-')

  await registerAndSignIn(page, uniqueEmail('board-nomatch'))
  await goToFiles(page)
  await uploadVideo(page, token)

  await page.getByLabel('Search').fill(`${token}-does-not-exist`)

  await expect(page.getByText('No files match the current filters.')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('ul li')).toHaveCount(0)
})
