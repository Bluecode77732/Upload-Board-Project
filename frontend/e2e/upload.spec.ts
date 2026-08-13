// Purpose: browser-level verification of the two-phase video upload (UploadForm: POST /upload/attach
//   then POST /file) and its effect on the file board.
// Usage: run via `pnpm test:e2e`; builds on the shared harness (playwright.config.ts).
// Rationale: upload is the app's core write path (temp_ -> granted_, ADR 0019) — this drives it through
//   a real file input/FormData submission rather than calling the API directly.

import { test, expect } from '@playwright/test'
import { registerAndSignIn, goToFiles, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH } from './helpers'

test('uploading a video promotes it and it appears in the file board as Private', async ({ page }) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('upload-video')

  await registerAndSignIn(page, uniqueEmail('upload'))
  await goToFiles(page)

  await page.getByLabel('Title', { exact: true }).fill(title)
  // Video is UploadForm's default fieldType, but select it explicitly so the test doesn't
  // depend on that default.
  await page.getByRole('radio', { name: 'Video' }).check()
  await page.getByLabel(/^Video file/).setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()

  // The form clears its own fields only after both phases (attach + promote) succeed.
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 30_000 })

  const row = page.locator('li', { hasText: title })
  await expect(row.getByRole('link', { name: title })).toBeVisible()
  // New rows default to visibility: 'private' (ADR 0025 D1).
  await expect(row.getByText('Private', { exact: true })).toBeVisible()
})

test('uploading a duplicate title surfaces the FILE_TITLE_TAKEN message', async ({ page }) => {
  test.setTimeout(90_000)
  const title = uniqueTitle('upload-dupe')

  await registerAndSignIn(page, uniqueEmail('upload-dupe'))
  await goToFiles(page)

  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByRole('radio', { name: 'Video' }).check()
  await page.getByLabel(/^Video file/).setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 30_000 })

  // Re-attach a fresh temp upload (the previous one was already claimed) and reuse the same title.
  // Clearing first forces a real value change on the <input type="file">, since setting the
  // identical path twice in a row does not reliably fire a change event.
  await page.getByLabel('Title', { exact: true }).fill(title)
  const fileInput = page.getByLabel(/^Video file/)
  await fileInput.setInputFiles([])
  await fileInput.setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()

  // UploadForm's messageForError maps ErrorCode.FILE_TITLE_TAKEN to this fixed string —
  // asserting on it (not the backend's raw message) is the code-based check.
  await expect(page.getByText('A file with that title already exists — pick another.')).toBeVisible({
    timeout: 30_000,
  })
})
