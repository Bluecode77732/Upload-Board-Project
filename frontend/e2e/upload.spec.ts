// 목적: 2단계 영상 업로드(UploadForm: POST /upload/attach 후 POST /file)와 그것이 파일
//   보드에 미치는 영향에 대한 브라우저 레벨 검증.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 업로드는 이 앱의 핵심 쓰기 경로다(temp_ -> granted_, ADR 0019) — API를 직접 호출하는
//   대신 실제 파일 input/FormData 제출을 통해 구동한다.

import { test, expect } from '@playwright/test'
import { registerAndSignIn, goToFiles, uniqueEmail, uniqueTitle, VIDEO_FIXTURE_PATH } from './helpers'

test('uploading a video promotes it and it appears in the file board as Private', async ({ page }) => {
  test.setTimeout(60_000)
  const title = uniqueTitle('upload-video')

  await registerAndSignIn(page, uniqueEmail('upload'))
  await goToFiles(page)

  await page.getByLabel('Title', { exact: true }).fill(title)
  // Video는 UploadForm의 기본 fieldType이지만, 테스트가 그 기본값에 의존하지 않도록
  // 명시적으로 선택한다.
  await page.getByRole('radio', { name: 'Video' }).check()
  await page.getByLabel(/^Video file/).setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()

  // 이 폼은 두 단계(attach + promote)가 모두 성공한 뒤에만 필드를 스스로 비운다.
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('', { timeout: 30_000 })

  const row = page.locator('li', { hasText: title })
  await expect(row.getByRole('link', { name: title })).toBeVisible()
  // 새로 생성되는 행은 visibility: 'private'이 기본값이다(ADR 0025 D1).
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

  // 새 temp 업로드를 다시 첨부하고(이전 것은 이미 청구됐다) 같은 제목을 재사용한다.
  // 먼저 비워야 <input type="file">에 실제 값 변경이 발생한다 — 동일한 경로를 연달아
  // 두 번 설정하면 change 이벤트가 안정적으로 발생하지 않는다.
  await page.getByLabel('Title', { exact: true }).fill(title)
  const fileInput = page.getByLabel(/^Video file/)
  await fileInput.setInputFiles([])
  await fileInput.setInputFiles(VIDEO_FIXTURE_PATH)
  await page.getByRole('button', { name: 'Upload', exact: true }).click()

  // UploadForm의 messageForError는 ErrorCode.FILE_TITLE_TAKEN을 이 고정 문자열로 매핑한다 —
  // (백엔드의 원본 메시지가 아니라) 이 문자열을 단언하는 것이 code 기반 검증이다.
  await expect(page.getByText('A file with that title already exists — pick another.')).toBeVisible({
    timeout: 30_000,
  })
})
