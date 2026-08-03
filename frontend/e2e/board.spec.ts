// Purpose: browser-level verification of FileBoard's search, sort, creator filter, and pagination
//   controls (ADR 0021 list query) against files uploaded through the real UI upload flow.
// Usage: run via `pnpm test:e2e`; builds on the shared harness (playwright.config.ts).
// Rationale: FileBoard's query state (search/sortBy/order/creatorId/skip) is exercised together here
//   because each interaction re-runs the same GET /file call — verifying them against two files this
//   spec uploads itself, tagged with a run-unique token, keeps assertions independent of whatever
//   else exists in the shared (never-truncated) dev DB.

import { test, expect, type Page } from '@playwright/test'
import { registerAndSignIn, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH } from './helpers'

async function uploadVideo(page: Page, title: string) {
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByRole('radio', { name: 'Video' }).check()
  // Clearing first forces a real value change on the <input type="file"> — setting the
  // identical fixture path twice in a row (across repeated calls in one test) does not
  // reliably fire a change event.
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

  // Alpha uploaded first, Beta second — this fixes their relative createdAt order.
  await uploadVideo(page, titleAlpha)
  await uploadVideo(page, titleBeta)

  // --- search: the free-text token should isolate exactly these two rows ---
  await page.getByLabel('Search').fill(token)
  await expect(page.locator('ul li')).toHaveCount(2, { timeout: 10_000 })
  await expect(page.locator('ul li a', { hasText: titleAlpha })).toBeVisible()
  await expect(page.locator('ul li a', { hasText: titleBeta })).toBeVisible()

  // --- sort by title ---
  await page.getByLabel('Sort by').selectOption('title')
  await page.getByLabel('Order').selectOption('ASC')
  await expect(page.locator('ul li a')).toHaveText([titleAlpha, titleBeta])

  await page.getByLabel('Order').selectOption('DESC')
  await expect(page.locator('ul li a')).toHaveText([titleBeta, titleAlpha])

  // --- sort by createdAt (upload order) ---
  await page.getByLabel('Sort by').selectOption('createdAt')
  await page.getByLabel('Order').selectOption('ASC')
  await expect(page.locator('ul li a')).toHaveText([titleAlpha, titleBeta])

  await page.getByLabel('Order').selectOption('DESC')
  await expect(page.locator('ul li a')).toHaveText([titleBeta, titleAlpha])

  // --- creator filter + pagination: filter to "me" via the row's creator button ---
  const alphaRow = page.locator('li', { hasText: titleAlpha })
  await alphaRow.getByTitle('Filter the list to this creator').click()
  await expect(page.getByLabel('Creator ID')).toHaveValue(/^\d+$/)

  // Two matching rows, well under the page size (20) — pagination reflects a single page.
  await expect(page.locator('ul li')).toHaveCount(2)
  await expect(page.getByText(/of 2$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
})

test('a file not matching the search term is not shown', async ({ page }) => {
  const token = uniqueTitle('board-nomatch').replace(/\s+/g, '-')

  await registerAndSignIn(page, uniqueEmail('board-nomatch'))
  await uploadVideo(page, token)

  await page.getByLabel('Search').fill(`${token}-does-not-exist`)

  await expect(page.getByText('No files match the current filters.')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('ul li')).toHaveCount(0)
})
