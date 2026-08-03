// Purpose: minimal browser-level smoke check that the app boots and the auth guard actually redirects.
// Usage: run via `pnpm test:e2e`; the first spec in the shared Playwright harness (playwright.config.ts).
// Rationale: nothing before this exercised the app past tsc/lint/unit level — this is the baseline later
//   flow E2Es (login, upload, board, detail, admin) are added alongside.

import { test, expect } from '@playwright/test'

test('unauthenticated visit to / redirects to /login', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
