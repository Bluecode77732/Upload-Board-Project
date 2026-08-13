import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy so the browser sees a single origin (localhost:5173): API calls to
// /auth,/file,/user,/upload,/post,/comment are forwarded to the backend on :3000. This
// keeps the refresh cookie (SameSite=Strict, no Secure in dev) working without CORS —
// same-origin requests carry it; production uses a real origin + CORS instead.
// '/post' and '/file' are anchored as regex strings ('^/post($|[/?])', '^/file($|[/?])')
// rather than plain prefixes: Vite matches plain string keys with `url.startsWith(context)`,
// which would otherwise also swallow the client routes "/posts/:id" and "/files" (App.tsx)
// into the backend proxy — the same class of collision "/view/:id" already avoids for
// "/file/:id" (confirmed live: plain '/file' proxied "/files" straight to the backend,
// which 404'd instead of ever reaching the SPA router). The char class is `[/?]`, not just
// `/`: a bare list query like "/file?take=20" has "?" right after "/file" with no "/" at
// all — a `($|/)` anchor missed that case too (also confirmed live: it fell through to the
// SPA's index.html with a 200 instead of reaching the backend, which the frontend then
// failed to parse as JSON). Any future proxy prefix whose text could also prefix a client
// route name needs the same regex-anchor treatment.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '^/file($|[/?])': { target: 'http://localhost:3000', changeOrigin: true },
      '/user': { target: 'http://localhost:3000', changeOrigin: true },
      '/upload': { target: 'http://localhost:3000', changeOrigin: true },
      '^/post($|[/?])': { target: 'http://localhost:3000', changeOrigin: true },
      '/comment': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
