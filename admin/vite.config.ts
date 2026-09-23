import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ADR 0062: 운영 빌드(`vite build`)만 `/admin/` 서브패스에서 서빙된다 — 같은 ALB의
// `/admin` 규칙이 경로를 재작성하지 않으므로, 빌드된 자산 참조도 그 경로를 그대로 반영해야
// 한다. `pnpm dev`는 여전히 :5174 루트에서 독립적으로 뜬다(command !== 'build').
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/admin/' : '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // `vitest run`이 Playwright e2e 스펙(e2e/*.spec.ts)까지 수집하지 않도록 src로 범위를 좁힌다 —
    // 그 스펙들은 Playwright 러너 밖에서 test()를 호출해서 수집 단계 자체가 실패한다.
    // `exclude`는 기본값 그대로 둬서 node_modules는 계속 제외되게 한다.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
}))
