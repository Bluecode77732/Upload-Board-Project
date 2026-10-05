// 목적: 업로드 폼의 파일 선택 단계를 검증한다 — 여러 개 선택, 종류 자동 판별, 기본 제목, 15개 상한,
//   허용되지 않는 확장자, 줄 빼기.
// 사용처: `pnpm test:e2e`로 실행된다; API를 스텁(helpers.ts)하므로 계정을 만들지 않고 백엔드도 필요 없다.
// 근거: 이 단계는 서버에 아무것도 보내기 전에 끝난다 — 실제 계정으로 돌리면 분당 5회 인증 한도(backend
//   ADR 0054)만 쓰게 되므로 upload.spec.ts와 나눴다.

import { test, expect, type Page } from '@playwright/test'
import { stubAuthenticatedApi } from './helpers'

function fakeFile(name: string, mimeType: string) {
  return { name, mimeType, buffer: Buffer.from(`e2e-${name}`) }
}

async function openUploadForm(page: Page) {
  await stubAuthenticatedApi(page)
  await page.goto('/files')
  const form = page.locator('form', { has: page.getByRole('heading', { name: 'Upload a file' }) })
  await expect(form).toBeVisible()
  return form
}

test('files of different kinds chosen together each get a row, a kind and a default title', async ({ page }) => {
  const form = await openUploadForm(page)

  await form.getByLabel(/^Files/).setInputFiles([
    fakeFile('holiday photo.JPG', 'image/jpeg'),
    fakeFile('song.mp3', 'audio/mpeg'),
    fakeFile('clip.final.webm', 'video/webm'),
  ])

  const rows = form.locator('li')
  await expect(rows).toHaveCount(3)
  // 종류는 확장자로 정해진다(대소문자 무관). 기본 제목은 마지막 확장자만 뗀 파일명이다.
  await expect(rows.nth(0).getByText('Image', { exact: true })).toBeVisible()
  await expect(rows.nth(1).getByText('Audio', { exact: true })).toBeVisible()
  await expect(rows.nth(2).getByText('Video', { exact: true })).toBeVisible()
  await expect(rows.nth(0).getByLabel('Title', { exact: true })).toHaveValue('holiday photo')
  await expect(rows.nth(2).getByLabel('Title', { exact: true })).toHaveValue('clip.final')

  // 줄 하나를 빼면 나머지는 그대로 남는다.
  await form.getByRole('button', { name: 'Remove song.mp3' }).click()
  await expect(rows).toHaveCount(2)
  await expect(form.getByText('song.mp3')).toHaveCount(0)
})

test('a file with an extension the backend does not accept is marked on its own row', async ({ page }) => {
  const form = await openUploadForm(page)

  await form.getByLabel(/^Files/).setInputFiles([fakeFile('photo.png', 'image/png'), fakeFile('notes.txt', 'text/plain')])

  const rows = form.locator('li')
  await expect(rows).toHaveCount(2)
  await expect(
    rows.nth(1).getByText('Unsupported file type — allowed: jpg, jpeg, png, webp, mp3, mp4, mov, webm.'),
  ).toBeVisible()
  // 올릴 수 없는 줄에는 제목 칸이 없다.
  await expect(form.getByLabel('Title', { exact: true })).toHaveCount(1)
})

test('more than 15 files at once is refused, and submitting with nothing chosen asks for a file', async ({ page }) => {
  const form = await openUploadForm(page)

  await form.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(form.getByText('Please choose a file to upload.')).toBeVisible()

  const sixteen = Array.from({ length: 16 }, (_, index) => fakeFile(`photo-${index}.png`, 'image/png'))
  await form.getByLabel(/^Files/).setInputFiles(sixteen)
  await expect(form.getByText('You can upload up to 15 files at a time.')).toBeVisible()
  await expect(form.locator('li')).toHaveCount(0)

  // 15개는 받는다.
  await form.getByLabel(/^Files/).setInputFiles(sixteen.slice(0, 15))
  await expect(form.locator('li')).toHaveCount(15)

  // 한국어로 바꿔도 떠 있는 문구는 새 언어로 다시 그려진다. form 로케이터는 영어 제목으로 찾으므로 여기서는 page로 찾는다.
  await form.getByLabel(/^Files/).setInputFiles(sixteen)
  await page.getByRole('button', { name: 'Switch to Korean' }).click()
  await expect(page.getByText('한 번에 15개까지 올릴 수 있습니다.')).toBeVisible()
})
