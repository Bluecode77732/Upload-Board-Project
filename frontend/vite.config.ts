import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy so the browser sees a single origin (localhost:5173): API calls to
// /auth,/file,/user,/upload are forwarded to the backend on :3000. This keeps
// the refresh cookie (SameSite=Strict, no Secure in dev) working without CORS —
// same-origin requests carry it; production uses a real origin + CORS instead.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '/file': { target: 'http://localhost:3000', changeOrigin: true },
      '/user': { target: 'http://localhost:3000', changeOrigin: true },
      '/upload': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
