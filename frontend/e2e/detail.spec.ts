// 목적: FileDetailPage(/view/:id)에 대한 브라우저 레벨 검증 — visibility로 게이트된 재생
//   (private는 인증된 blob, public/unlisted는 직접 콘텐츠 URL), 관리 액션(visibility 토글,
//   공유 링크 회전, 삭제), 그리고 그 주변의 접근 제어 분기들(ADR 0025/0026).
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts)와 helpers.ts의
//   registerAndSignIn fixture 위에서 동작한다. 백엔드(BACKEND_BASE_URL)를 직접 호출하는
//   경우는 삭제를 막는 게시글을 첨부하는 셋업뿐이다 — 프론트에는 아직 게시글 UI가 없다.
// 근거: GET /file/:id/content가 유일한 바이트 서빙 경로이자 visibility로 게이트되는 경로다 —
//   private 읽기는 일반 <video src>가 실을 수 없는 Bearer 헤더가 필요하고, 관리 액션은 그
//   파일의 소유자만 도달할 수 있어 검증하기 가장 까다로운 경로다.

import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { registerAndSignIn, goToFiles, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH, TEST_PASSWORD } from './helpers'

// Vite dev 프록시가 /file, /auth, /post를 전달하는 것과 동일한 origin(vite.config.ts) —
// `request` fixture는 (`page`와 달리) 이 프록시를 거치지 않으므로 여기서는 백엔드를 직접 호출한다.
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

// `title`과 일치하는 보드 행의 /view/:id 페이지를 열고, 그 파일 id를 FileDetailPage가 마운트
// 시 항상 발생시키는 콘텐츠 fetch의 응답과 함께 반환한다(새로 업로드한 파일은 기본값이
// `visibility: private`이므로, 이건 인증된 blob 요청이다). waitForResponse는 클릭 *전에*
// 걸어둬야 호출부가 await로 돌아오기 전에 더 빨리 끝나는 요청을 놓치지 않는다.
//
// `contentResponse`는 그 요청의 *첫 번째* 홉일 뿐이다: `STORAGE_DRIVER=s3`(ADR 0036)에서는
// 백엔드가 cross-origin presigned S3 URL로 `302`를 응답하고, 그 최종 S3 응답은 이 predicate와
// 절대 일치하지 않는다(URL이 다르다) — 그래서 호출부는 여기서 `200`을 가정하면 안 된다.
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

// 백엔드에 직접(Basic 헤더) 로그인해 새 게시글에 `fileId`를 첨부한다 — 프론트에 게시글 UI가
// 없어도 DELETE /file/:id가 FK 가드(409 FILE_IN_USE, ADR 0023 D4)에 걸리도록 하기 위해서다.
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

  // 페이지 내부에서 URL.revokeObjectURL 호출을 추적한다 — FileDetailPage의 클린업 이펙트가
  // 실행될 때 존재하도록 첫 내비게이션 전에 설치한다.
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

  // STORAGE_DRIVER=local이면 200(직접 스트림); STORAGE_DRIVER=s3면 302(ADR 0036 presigned
  // 리다이렉트 — 위 openDetailPage 설명대로 이건 첫 번째 홉일 뿐이다). 둘 다 올바른 첫 홉이다;
  // 실제 성공 증거는 아래 blob: src 단언이다 — 이건 브라우저가 실제로 리다이렉트를 따라가서
  // S3 응답 본문을 읽고 FileDetailPage가 그걸 objectURL로 바꿔야만 설정될 수 있다.
  expect([200, 302]).toContain(contentResponse.status())
  await expect(page.getByText('Private', { exact: true })).toBeVisible()
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/, { timeout: 15_000 })
  await expect(page.getByText('Network error. Is the backend running?')).toHaveCount(0)

  // 관리 컨트롤은 creator에게만 보인다; private 파일에는 공유 링크가 존재하지 않는다.
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

  // `request` fixture는 쿠키도 없고 page의 메모리 상 액세스 토큰과도 무관한 순수
  // APIRequestContext다 — 이건 파일이 public이 된 지금 바이트 스트림에 인증이 필요 없음을
  // 증명한다.
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

  // 옛 토큰은 회전되어 빠졌다 — 재사용을 시도하면 거절되지, 서빙되지 않는다.
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
  // 행이 여전히 남아있다 — 삭제가 그저 느린 게 아니라 거절된 것이다.
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
