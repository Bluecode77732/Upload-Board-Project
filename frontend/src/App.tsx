import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './features/auth/LoginPage'
import { DashboardPage } from './features/files/DashboardPage'
import { FileDetailPage } from './features/files/FileDetailPage'
import { PostBoard } from './features/posts/PostBoard'
import { PostDetailPage } from './features/posts/PostDetailPage'
import { RequireAuth } from './auth/RequireAuth'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <PostBoard />
          </RequireAuth>
        }
      />
      {/* Safe against the dev proxy: vite.config.ts anchors '/post' as the regex
          '^/post($|/)' specifically so it does not also swallow "/posts/...". */}
      <Route
        path="/posts/:id"
        element={
          <RequireAuth>
            <PostDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/files"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      {/* Not "/file/:id" — the dev proxy forwards any path starting with /file to the
          backend API (vite.config.ts), which would shadow this client route entirely. */}
      <Route
        path="/view/:id"
        element={
          <RequireAuth>
            <FileDetailPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
