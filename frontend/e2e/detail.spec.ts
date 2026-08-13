// Purpose: browser-level verification of FileDetailPage (/view/:id) — visibility-gated playback
//   (private via authenticated blob, public/unlisted via the direct content URL), the manage
//   actions (visibility toggle, share-link rotation, delete), and the access-control branches
//   around them (ADR 0025/0026).
// Usage: run via `pnpm test:e2e`; builds on the shared harness (playwright.config.ts) and the
//   registerAndSignIn fixture from helpers.ts. Talks to the backend directly (BACKEND_BASE_URL)
//   only to attach a post as delete-blocking setup — the frontend has no post UI yet.
// Rationale: GET /file/:id/content is the only byte-serving path and the one gated on visibility —
//   this is the hardest path to exercise because a private read needs a Bearer header a plain
//   <video src> cannot carry, and the manage actions are only reachable by the file's own creator.

import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { registerAndSignIn, goToFiles, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH, TEST_PASSWORD } from './helpers'

// Same origin the Vite dev proxy forwards /file, /auth, /post to (vite.config.ts) — used here to
// call the backend directly, since the `request` fixture (unlike `page`) never goes through it.
const BACKEND_BASE_URL = 'http://localhost:3000'

async function uploadVideo(page: Page, title: string): Promise<void> {
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByRole('radio', { name: 'Video' }).check()
  const fileInput = page.getByLabel(/^Video file/)
  await fileInput.setInputFiles([])
  await fileInput.setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 30_000 })
}

// Opens the /view/:id page for the board row matching `title` and returns its file id together
// with the response to the content fetch that FileDetailPage always issues on mount (every fresh
// upload defaults to `visibility: private`, so this is the authenticated blob request). The
// waitForResponse is armed *before* the click so it cannot miss a request that completes faster
// than the caller gets back around to awaiting it.
async function openDetailPage(page: Page, title: string): Promise<{ id: number; contentResponse: Response }> {
  const link = page.locator('li', { hasText: title }).getByRole('link', { name: title })
  const href = await link.getAttribute('href')
  if (!href) throw new Error(`no href found for row "${title}"`)
  const id = Number(href.replace('/view/', ''))

  const contentResponsePromise = page.waitForResponse(
    (res) => res.url().includes(`/file/${id}/content`) && res.request().method() === 'GET',
  )
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/view/${id}$`))
  const contentResponse = await contentResponsePromise
  return { id, contentResponse }
}

// Signs in against the backend directly (Basic header) and attaches `fileId` to a fresh post,
// so DELETE /file/:id hits the FK guard (409 FILE_IN_USE, ADR 0023 D4) without any frontend post UI.
async function attachFileToPost(
  request: APIRequestContext,
  email: string,
  password: string,
  fileId: number,
): Promise<number> {
  const basic = Buffer.from(`${email}:${password}`).toString('base64')
  const signinRes = await request.post(`${BACKEND_BASE_URL}/auth/signin`, {
    headers: { Authorization: `Basic ${basic}` },
  })
  expect(signinRes.ok()).toBe(true)
  const { accessToken } = (await signinRes.json()) as { accessToken: string }

  const postRes = await request.post(`${BACKEND_BASE_URL}/post`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { title: 'blocking post', body: 'attached for the FILE_IN_USE e2e branch', fileId },
  })
  expect(postRes.ok()).toBe(true)
  const post = (await postRes.json()) as { id: number }
  return post.id
}

test('a private file plays for its owner via an authenticated blob fetch and revokes the objectURL on navigating away', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('detail-private')

  // Tracks URL.revokeObjectURL calls from inside the page — installed before the first
  // navigation so it is present when FileDetailPage's cleanup effect runs.
  await page.addInitScript(() => {
    ;(window as unknown as { __revokedUrls: string[] }).__revokedUrls = []
    const original = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url: string) => {
      ;(window as unknown as { __revokedUrls: string[] }).__revokedUrls.push(url)
      original(url)
    }
  })

  await registerAndSignIn(page, uniqueEmail('detail-private'))
  await goToFiles(page)
  await uploadVideo(page, title)
  const { contentResponse } = await openDetailPage(page, title)

  expect(contentResponse.status()).toBe(200)
  await expect(page.getByText('Private', { exact: true })).toBeVisible()
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/)

  // Manage controls are visible to the creator; no share link exists for a private file.
  await expect(page.getByRole('heading', { name: 'Manage' })).toBeVisible()
  await expect(page.getByLabel('Visibility')).toHaveValue('private')
  await expect(page.getByRole('button', { name: 'Rotate share link' })).toHaveCount(0)
  await expect(page.getByText('Share link:')).toHaveCount(0)

  await page.getByRole('link', { name: 'Back to files' }).click()
  await expect(page).toHaveURL(/\/files$/)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __revokedUrls: string[] }).__revokedUrls.length))
    .toBeGreaterThan(0)
})

test('switching visibility to public serves the content endpoint directly, without a bearer token', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('detail-public')

  await registerAndSignIn(page, uniqueEmail('detail-public'))
  await goToFiles(page)
  await uploadVideo(page, title)
  const { id: fileId } = await openDetailPage(page, title)

  await page.getByLabel('Visibility').selectOption('public')
  const patchResponse = await page.waitForResponse(
    (res) => res.url().endsWith(`/file/${fileId}`) && res.request().method() === 'PATCH',
  )
  expect(patchResponse.status()).toBe(200)
  await expect(page.getByText('Public', { exact: true })).toBeVisible()

  const directUrl = `${BACKEND_BASE_URL}/file/${fileId}/content`
  await expect(page.locator('video')).toHaveAttribute('src', directUrl)

  // The `request` fixture is a bare APIRequestContext with no cookies and no relation to the
  // page's in-memory access token — it proves the byte stream needs no authentication now that
  // the file is public.
  const anonResponse = await request.get(directUrl)
  expect([200, 206]).toContain(anonResponse.status())
  expect(anonResponse.headers()['content-type']).toMatch(/^video\//)
})

test('switching visibility to unlisted exposes a rotatable share link that plays with no login', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('detail-unlisted')

  await registerAndSignIn(page, uniqueEmail('detail-unlisted'))
  await goToFiles(page)
  await uploadVideo(page, title)
  const { id: fileId } = await openDetailPage(page, title)

  await page.getByLabel('Visibility').selectOption('unlisted')
  await page.waitForResponse((res) => res.url().endsWith(`/file/${fileId}`) && res.request().method() === 'PATCH')
  await expect(page.getByText('Unlisted', { exact: true })).toBeVisible()

  const shareUrlPattern = new RegExp(`${BACKEND_BASE_URL}/file/${fileId}/content\\?share=[\\w-]+`)
  await expect(page.locator('code')).toHaveText(shareUrlPattern)
  const originalShareUrl = (await page.locator('code').textContent()) ?? ''

  const okResponse = await request.get(originalShareUrl)
  expect([200, 206]).toContain(okResponse.status())

  await page.getByRole('button', { name: 'Rotate share link' }).click()
  await page.waitForResponse((res) => res.url().endsWith(`/file/${fileId}`) && res.request().method() === 'PATCH')
  await expect(page.locator('code')).not.toHaveText(originalShareUrl)
  const rotatedShareUrl = (await page.locator('code').textContent()) ?? ''
  expect(rotatedShareUrl).not.toBe(originalShareUrl)

  // The old token is rotated out — replaying it is refused, not served.
  const staleResponse = await request.get(originalShareUrl)
  expect(staleResponse.status()).toBe(403)
  expect(((await staleResponse.json()) as { code: string }).code).toBe('FILE_SHARE_INVALID')

  const rotatedResponse = await request.get(rotatedShareUrl)
  expect([200, 206]).toContain(rotatedResponse.status())
})

test('a private file is hidden from a different signed-in user (404, existence hidden) with no manage controls', async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('detail-stranger')

  await registerAndSignIn(page, uniqueEmail('detail-owner'))
  await goToFiles(page)
  await uploadVideo(page, title)
  const { id: fileId } = await openDetailPage(page, title)
  await expect(page.getByText('Private', { exact: true })).toBeVisible()

  const strangerContext = await browser.newContext()
  try {
    const strangerPage = await strangerContext.newPage()
    await registerAndSignIn(strangerPage, uniqueEmail('detail-stranger'))

    const metaResponsePromise = strangerPage.waitForResponse(
      (res) => res.url().endsWith(`/file/${fileId}`) && res.request().method() === 'GET',
    )
    await strangerPage.goto(`/view/${fileId}`)
    const metaResponse = await metaResponsePromise
    expect(metaResponse.status()).toBe(404)

    await expect(strangerPage.getByText('File not found.')).toBeVisible()
    await expect(strangerPage.locator('video')).toHaveCount(0)
    await expect(strangerPage.getByRole('heading', { name: 'Manage' })).toHaveCount(0)
  } finally {
    await strangerContext.close()
  }
})

test('a file referenced by a post cannot be deleted (409 FILE_IN_USE) until the post is removed', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('detail-delete')
  const email = uniqueEmail('detail-delete')

  await registerAndSignIn(page, email)
  await goToFiles(page)
  await uploadVideo(page, title)
  const { id: fileId } = await openDetailPage(page, title)

  const postId = await attachFileToPost(request, email, TEST_PASSWORD, fileId)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Delete file' }).click()
  await expect(
    page.getByText('This file is attached to a post and cannot be deleted. Delete the post first.'),
  ).toBeVisible()
  // The row is still there — the delete was refused, not merely slow.
  await expect(page.getByRole('heading', { name: 'Manage' })).toBeVisible()

  const basic = Buffer.from(`${email}:${TEST_PASSWORD}`).toString('base64')
  const signinRes = await request.post(`${BACKEND_BASE_URL}/auth/signin`, {
    headers: { Authorization: `Basic ${basic}` },
  })
  const { accessToken } = (await signinRes.json()) as { accessToken: string }
  const deletePostRes = await request.delete(`${BACKEND_BASE_URL}/post/${postId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  expect(deletePostRes.ok()).toBe(true)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Delete file' }).click()
  await expect(page).toHaveURL(/\/files$/)

  await page.getByLabel('Search').fill(title)
  await expect(page.getByText('No files match the current filters.')).toBeVisible({ timeout: 10_000 })
})
