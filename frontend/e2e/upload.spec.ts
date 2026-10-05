// 목적: 2단계 업로드(UploadForm: POST /upload/attach 후 POST /file)와 그것이 파일
//   보드에 미치는 영향에 대한 브라우저 레벨 검증. 여러 파일을 한 번에 골라 하나씩 올리는 흐름을 포함한다.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 업로드는 이 앱의 핵심 쓰기 경로다(temp_ -> granted_, ADR 0019) — API를 직접 호출하는
//   대신 실제 파일 input/FormData 제출을 통해 구동한다.

import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import {
  registerAndSignIn,
  goToFiles,
  uniqueEmail,
  uniqueTitle,
  uploadThroughForm,
  VIDEO_FIXTURE_PATH,
} from './helpers'

test('uploading a video promotes it and it appears in the file board as Private', async ({ page }) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('upload-video')

  await registerAndSignIn(page, uniqueEmail('upload'))
  await goToFiles(page)

  // 줄이 "Uploaded"가 되는 것은 두 단계(attach + promote)가 모두 성공한 뒤다.
  await uploadThroughForm(page, title)

  const row = page.locator('li', { hasText: title })
  await expect(row.getByRole('link', { name: title })).toBeVisible()
  // 새로 생성되는 행은 visibility: 'private'이 기본값이다(ADR 0025 D1).
  await expect(row.getByText('Private', { exact: true })).toBeVisible()
})

test('a duplicate title fails on its own row, and fixing the title retries without sending the file again', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const title = uniqueTitle('upload-dupe')

  await registerAndSignIn(page, uniqueEmail('upload-dupe'))
  await goToFiles(page)
  await uploadThroughForm(page, title)

  let attachRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/upload/attach')) attachRequests += 1
  })

  // 새 temp 업로드를 다시 첨부하고(이전 것은 이미 청구됐다) 같은 제목을 재사용한다.
  await uploadThroughForm(page, title, { expectSuccess: false })

  // UploadForm의 messageForError는 ErrorCode.FILE_TITLE_TAKEN을 이 고정 문자열로 매핑한다 —
  // (백엔드의 원본 메시지가 아니라) 이 문자열을 단언하는 것이 code 기반 검증이다.
  await expect(page.getByText('A file with that title already exists — pick another.')).toBeVisible({
    timeout: 30_000,
  })

  // 제목만 고쳐 다시 누르면 승격만 재시도된다 — 파일은 이미 temp에 올라가 있으므로 다시 보내지 않는다.
  await page.getByLabel('Title', { exact: true }).fill(`${title} fixed`)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByText('Uploaded', { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(attachRequests).toBe(1)
})

test('an image, an audio file and a video chosen together are uploaded one by one', async ({ page }) => {
  test.setTimeout(90_000)
  const token = uniqueTitle('upload-multi').replace(/\s+/g, '-')
  const titles = [`${token}-image`, `${token}-audio`, `${token}-video`]

  await registerAndSignIn(page, uniqueEmail('upload-multi'))
  await goToFiles(page)

  let attachRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/upload/attach')) attachRequests += 1
  })

  // 백엔드의 허용목록은 확장자와 mimetype만 본다(upload.controller.ts) — 이미지와 mp3는 작은 버퍼로 충분하다.
  await page.getByLabel(/^Files/).setInputFiles([
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('e2e-jpg-bytes') },
    { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('e2e-mp3-bytes') },
    { name: 'clip.mp4', mimeType: 'video/mp4', buffer: readFileSync(VIDEO_FIXTURE_PATH) },
  ])

  // 종류는 고르지 않는다 — 줄마다 확장자로 정해지고, 기본 제목은 확장자를 뗀 파일명이다.
  const titleInputs = page.getByLabel('Title', { exact: true })
  await expect(titleInputs).toHaveCount(3)
  await expect(titleInputs.nth(0)).toHaveValue('photo')
  for (const [index, title] of titles.entries()) {
    await titleInputs.nth(index).fill(title)
  }

  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(3, { timeout: 60_000 })

  // 요청 하나에 파일 하나다. 필드가 파일 종류와 어긋나면 백엔드가 400 UPLOAD_INVALID_TYPE으로 거부하므로,
  // 세 줄이 모두 "Uploaded"라는 것은 파일마다 맞는 필드로 나갔다는 뜻이기도 하다.
  expect(attachRequests).toBe(3)

  for (const title of titles) {
    await expect(page.getByRole('link', { name: title })).toBeVisible()
  }
})
