// Purpose: browser-level verification of the post board home screen — creating a post (with and
//   without an attached file) through the real UI, and its effect on the list and its detail link.
// Usage: run via `pnpm test:e2e`; builds on the shared harness (playwright.config.ts).
// Rationale: PostBoard/PostForm/FilePicker are the app's first post-board write UI (backend Stage 3,
//   ADR 0021/0023) — this exercises POST /post end to end, complementing FileBoard's read-side
//   query-control spec (board.spec.ts) with the write path this app didn't have before.

import { test, expect } from '@playwright/test'
import { registerAndSignIn, goToFiles, goToHome, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH } from './helpers'

test('creating a text-only post appears on the board and links to its detail page', async ({ page }) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('post-text')

  await registerAndSignIn(page, uniqueEmail('post-text'))

  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Body', { exact: true }).fill('A text-only post body.')
  await page.getByRole('button', { name: 'Post', exact: true }).click()

  // PostForm clears its own fields only after the write succeeds.
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 15_000 })

  const row = page.locator('li', { hasText: title })
  await expect(row.getByRole('link', { name: title })).toBeVisible()
  await expect(row.getByTitle('Has an attached file')).toHaveCount(0)

  await row.getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(/\/posts\/\d+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('A text-only post body.')).toBeVisible()
})

test('attaching one of my files shows the attachment icon on the post row', async ({ page }) => {
  test.setTimeout(90_000)
  const fileTitle = uniqueTitle('post-attach-file')
  const postTitle = uniqueTitle('post-attach-post')

  await registerAndSignIn(page, uniqueEmail('post-attach'))
  await goToFiles(page)

  await page.getByLabel('Title', { exact: true }).fill(fileTitle)
  await page.getByRole('radio', { name: 'Video' }).check()
  await page.getByLabel(/^Video file/).setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 30_000 })

  await goToHome(page)

  await page.getByLabel('Title', { exact: true }).fill(postTitle)
  await page.getByLabel('Body', { exact: true }).fill('A post with an attached file.')
  await page.getByRole('radio', { name: fileTitle }).check()
  await page.getByRole('button', { name: 'Post', exact: true }).click()

  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 15_000 })

  const row = page.locator('li', { hasText: postTitle })
  await expect(row.getByRole('link', { name: postTitle })).toBeVisible()
  await expect(row.getByTitle('Has an attached file')).toBeVisible()
})

test('submitting a post with a file already attached to another of my posts surfaces the message', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const fileTitle = uniqueTitle('post-conflict-file')
  const firstPostTitle = uniqueTitle('post-conflict-first')
  const secondPostTitle = uniqueTitle('post-conflict-second')

  await registerAndSignIn(page, uniqueEmail('post-conflict'))
  await goToFiles(page)

  await page.getByLabel('Title', { exact: true }).fill(fileTitle)
  await page.getByRole('radio', { name: 'Video' }).check()
  await page.getByLabel(/^Video file/).setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 30_000 })

  await goToHome(page)

  // Claim the file with the first post.
  await page.getByLabel('Title', { exact: true }).fill(firstPostTitle)
  await page.getByLabel('Body', { exact: true }).fill('First post claims the file.')
  await page.getByRole('radio', { name: fileTitle }).check()
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 15_000 })

  // A second, different post trying to attach the same (now-claimed) file is refused.
  await page.getByLabel('Title', { exact: true }).fill(secondPostTitle)
  await page.getByLabel('Body', { exact: true }).fill('Second post tries the same file.')
  await page.getByRole('radio', { name: fileTitle }).check()
  await page.getByRole('button', { name: 'Post', exact: true }).click()

  // PostForm's messageForError maps ErrorCode.POST_FILE_TAKEN to this fixed string.
  await expect(page.getByText('That file is already attached to another post.')).toBeVisible({ timeout: 15_000 })
})
