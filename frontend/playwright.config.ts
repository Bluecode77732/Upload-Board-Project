// 목적: 이후의 플로우 E2E(로그인, 업로드, 게시판, 상세, admin)가 딛고 설 공유 Playwright 하네스 설정.
// 사용처: `pnpm test:e2e`가 읽는다; 스펙은 frontend/e2e/ 아래에 있다.
// 근거: 지금 이 앱에는 브라우저 레벨 검증이 없다(build/lint/unit은 tsc와 jsdom 없는 unit test에서 멈춘다) —
//   이후 세션들은 각자 새로 만들지 말고 이 설정 하나를 확장해서 쓴다.

import { defineConfig, devices } from '@playwright/test'

// 리프레시 쿠키(SameSite=Strict)가 실제 사용 환경과 동일하게 동작하도록 same-origin dev 서버(:5173)를 쓴다 —
// 테스트가 백엔드의 :3000을 직접 타겟해서는 안 된다.
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
