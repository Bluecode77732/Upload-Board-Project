// 목적: admin e2e 플로우가 실제 백엔드를 상대로 동작하도록 Playwright를 구성한다.
// 사용처: admin/에서 `pnpm e2e`로 실행한다; in-app 플로우로는 superadmin 계정을 만들 수 없으므로
//        백엔드와 시딩된 superadmin 계정(e2e/.env.example 참고)이 필요하다.
// 근거: admin은 권한이 필요한 user/room/audit-log 액션에 대한 커버리지가 전혀 없었다.

import { defineConfig, devices } from '@playwright/test';

try {
    process.loadEnvFile('./e2e/.env');
} catch {
    // e2e/.env는 git에서 제외되며 개발자가 직접 준비한다; 이게 필요한 테스트는 조용히 건너뛰는 대신
    // "credentials missing"이라는 명확한 에러로 실패한다.
}

export default defineConfig({
    testDir: './e2e',
    // 테스트들이 하나의 실제 백엔드와 시딩된 superadmin 세션 하나를 공유하므로,
    // 동시에 돌리면 서로 간섭하게 된다.
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
