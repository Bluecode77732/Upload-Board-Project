// Purpose: configures Playwright to drive admin e2e flows against a real backend.
// Usage: run via `pnpm e2e` in admin/; requires backend + a seeded superadmin account
//        (see e2e/.env.example) since no in-app flow can create one.
// Rationale: admin had zero coverage of its privileged user/room/audit-log actions.

import { defineConfig, devices } from '@playwright/test';

try {
    process.loadEnvFile('./e2e/.env');
} catch {
    // e2e/.env is git-ignored and developer-provided; tests that need it will fail
    // with a clear "credentials missing" error rather than a silent skip.
}

export default defineConfig({
    testDir: './e2e',
    // Tests share one live backend and a single seeded superadmin session,
    // so running them concurrently would make them interfere with each other.
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:5174',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: 'pnpm dev',
        url: 'http://localhost:5174',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
