// 목적: 앱이 부팅되고 인증 가드가 실제로 리다이렉트하는지 확인하는 최소한의 브라우저 레벨 스모크 체크.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 Playwright 하네스(playwright.config.ts)의 첫 번째 spec이다.
// 근거: 이전에는 tsc/lint/유닛 레벨 너머로 앱을 검증한 적이 없었다 — 이 spec이 이후 추가되는
//   flow E2E(login, upload, board, detail, admin)의 기준선이 된다.

import { test, expect } from '@playwright/test'

test('unauthenticated visit to / redirects to /login', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
