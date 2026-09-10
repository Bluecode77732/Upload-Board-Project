// 목적: 게시글 보드 홈 화면에 대한 브라우저 레벨 검증 — 실제 UI로 게시글을 생성하고(파일 첨부
//   여부 둘 다), 그것이 목록과 상세 링크에 미치는 영향을 확인한다.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: PostBoard/PostForm/FilePicker는 이 앱의 첫 post-board 쓰기 UI다(backend Stage 3,
//   ADR 0021/0023) — POST /post를 end to end로 검증해, FileBoard의 읽기 측 쿼리 제어 spec
//   (board.spec.ts)을 이 앱에 그동안 없던 쓰기 경로로 보완한다.

import { test, expect } from '@playwright/test'
import { registerAndSignIn, goToFiles, goToHome, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH } from './helpers'

test('creating a text-only post appears on the board and links to its detail page', async ({ page }) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('post-text')

  await registerAndSignIn(page, uniqueEmail('post-text'))

  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Body', { exact: true }).fill('A text-only post body.')
  await page.getByRole('button', { name: 'Post', exact: true }).click()

  // 이 폼은 쓰기가 성공한 뒤에만 필드를 스스로 비운다.
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

  // 첫 번째 게시글로 파일을 청구한다.
  await page.getByLabel('Title', { exact: true }).fill(firstPostTitle)
  await page.getByLabel('Body', { exact: true }).fill('First post claims the file.')
  await page.getByRole('radio', { name: fileTitle }).check()
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 15_000 })

  // 이미 청구된 같은 파일을 첨부하려는 다른 두 번째 게시글은 거절된다.
  await page.getByLabel('Title', { exact: true }).fill(secondPostTitle)
  await page.getByLabel('Body', { exact: true }).fill('Second post tries the same file.')
  await page.getByRole('radio', { name: fileTitle }).check()
  await page.getByRole('button', { name: 'Post', exact: true }).click()

  // PostForm의 messageForError는 ErrorCode.POST_FILE_TAKEN을 이 고정 문자열로 매핑한다.
  await expect(page.getByText('That file is already attached to another post.')).toBeVisible({ timeout: 15_000 })
})
