import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
    // Scope collection to src so `vitest run` does not pick up Playwright e2e specs
    // (e2e/*.spec.ts), which call test() outside Playwright's runner and fail collection.
    // Leaving `exclude` at its default keeps node_modules excluded.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
