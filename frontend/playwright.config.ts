// Purpose: shared Playwright harness config that later flow E2Es (login, upload, board, detail, admin) build on.
// Usage: read by `pnpm test:e2e`; specs live under frontend/e2e/.
// Rationale: the app has no browser-level verification today (build/lint/unit stop at tsc and jsdom-free unit
//   tests) — this is the one config later sessions extend rather than each inventing their own.

import { defineConfig, devices } from '@playwright/test'

// Same-origin dev server (:5173) so the refresh cookie (SameSite=Strict) behaves exactly as in real use —
// tests must never target the backend's :3000 directly.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
