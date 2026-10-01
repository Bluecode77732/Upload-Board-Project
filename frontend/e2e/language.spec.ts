// 목적: NavBar의 한/영 토글(LanguageProvider) — 문구 전환, 새로고침 후 유지, 버튼의 크기·위치를 검증한다.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 계정을 만들 필요가 없는 UI 전용 동작이라 인증·목록 API를 스텁한다 — 공유 dev DB에 e2e
//   계정을 늘리지 않고, 분당 5회 제한(backend ADR 0054)도 건드리지 않는다.

import { test, expect, type Page } from '@playwright/test'

// 서명 검증은 서버 몫이고 클라이언트는 sub 클레임만 읽는다(authStore.ts) — 스텁에는 서명 없는 토큰이면 된다.
function fakeAccessToken(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: 1, type: 'access', role: 'user' })}.sig`
}

async function stubAuthenticatedHome(page: Page): Promise<void> {
  await page.route(/\/auth\/token\/refresh$/, (route) => route.fulfill({ json: { accessToken: fakeAccessToken() } }))
  await page.route(/\/post(\?.*)?$/, (route) => route.fulfill({ json: [[], 0] }))
  await page.route(/\/file(\?.*)?$/, (route) => route.fulfill({ json: [[], 0] }))
}

test('the language toggle switches the UI between English and Korean and survives a reload', async ({ page }) => {
  await stubAuthenticatedHome(page)
  await page.goto('/')

  // 기본은 영어다 — 저장된 선택이 없으면 브라우저 언어를 추측하지 않는다.
  await expect(page.getByRole('link', { name: 'Post', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Post', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await page.getByRole('button', { name: 'Switch to Korean' }).click()

  await expect(page.getByRole('link', { name: '게시글', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '파일', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '설정', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '게시글', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '새 게시글' })).toBeVisible()
  // 서버로 가는 sortBy 값은 그대로(createdAt)이고 라벨만 바뀐다.
  await expect(page.getByLabel('정렬 기준')).toHaveValue('createdAt')
  await expect(page.getByLabel('정렬 기준').locator('option').first()).toHaveText('날짜')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')

  await page.reload()
  await expect(page.getByRole('link', { name: '게시글', exact: true })).toBeVisible()

  // 되돌리면 다시 영어이고, 정렬 라벨은 "createdAt"이 아니라 "Date"다.
  await page.getByRole('button', { name: '영어로 전환' }).click()
  await expect(page.getByRole('link', { name: 'Post', exact: true })).toBeVisible()
  await expect(page.getByLabel('Sort by').locator('option').first()).toHaveText('Date')
})

test('the language toggle sits immediately left of the theme toggle at the same size', async ({ page }) => {
  await stubAuthenticatedHome(page)
  await page.goto('/')

  const language = await page.getByRole('button', { name: 'Switch to Korean' }).boundingBox()
  const theme = await page.getByRole('button', { name: /^Switch to (dark|light) mode$/ }).boundingBox()
  if (!language || !theme) throw new Error('toggle buttons were not rendered')

  expect(language.width).toBe(theme.width)
  expect(language.height).toBe(theme.height)
  expect(language.x + language.width).toBeLessThanOrEqual(theme.x)
  // 같은 줄에 있다 — 줄바꿈으로 아래로 밀려나지 않았다.
  expect(Math.abs(language.y - theme.y)).toBeLessThan(1)
})
