// 목적: Post의 Body 박스(새 글 폼, 글 상세의 수정 폼)와 댓글 박스(새 댓글, 댓글 수정)를 사용자가 끌어서
//   키우거나 줄일 수 없음을 검증한다.
// 사용처: `pnpm test:e2e`로 실행된다; API를 스텁(helpers.ts)하므로 계정을 만들지 않고 백엔드도 필요 없다.
// 근거: 네 CSS Module의 `.textarea`가 `resize: vertical`이라 박스 크기를 사용자가 바꿀 수 있었다 — 높이는 rows가 정한다.

import { test, expect } from '@playwright/test'
import { stubAuthenticatedApi } from './helpers'

test('the Post body boxes cannot be resized by the user', async ({ page }) => {
  await stubAuthenticatedApi(page)

  await page.goto('/')
  const newPostBody = page.getByLabel('Body', { exact: true })
  await expect(newPostBody).toBeVisible()
  expect(await newPostBody.evaluate((el) => getComputedStyle(el).resize), 'new post body').toBe('none')

  await page.goto('/posts/1')
  // 첫 Edit 버튼이 게시글의 것이고, 그 아래 댓글마다 자기 Edit 버튼이 따로 있다.
  await page.getByRole('button', { name: 'Edit' }).first().click()
  // 수정 폼은 본문이 미리 채워져 있어 감싸는 라벨의 접근성 이름이 "Body Stub body."가 된다 — 라벨 대신
  // 첫 textarea를 쓴다(수정 폼이 댓글 입력창보다 DOM에서 앞선다).
  const editBody = page.locator('textarea').first()
  await expect(editBody).toBeVisible()
  expect(await editBody.evaluate((el) => getComputedStyle(el).resize), 'post edit body').toBe('none')
})

test('the comment boxes cannot be resized by the user', async ({ page }) => {
  await stubAuthenticatedApi(page)
  await page.goto('/posts/1')

  // 수정 중이 아닐 때 textarea는 새 댓글 입력창 하나뿐이다.
  const newComment = page.locator('textarea')
  await expect(newComment).toBeVisible()
  expect(await newComment.evaluate((el) => getComputedStyle(el).resize), 'new comment box').toBe('none')

  // 댓글의 Edit 버튼은 목록 항목 안에 있다(게시글의 Edit 버튼과 구분된다).
  await page.getByRole('listitem').getByRole('button', { name: 'Edit' }).click()
  const editComment = page.getByRole('listitem').locator('textarea')
  await expect(editComment).toBeVisible()
  expect(await editComment.evaluate((el) => getComputedStyle(el).resize), 'comment edit box').toBe('none')
})
