// 목적: 앱의 라우트 표 — 어떤 경로가 어떤 화면을 그리고, 어느 것이 로그인을 요구하는지 한곳에 둔다.
// 사용처: main.tsx가 BrowserRouter·AuthProvider 안에 렌더링한다.
// 근거: 클라이언트 경로는 API 접두사(/post, /file, /user)와 겹치면 안 돼서, 그 제약을 한 파일에서 지킨다.

import { Navigate, Route, Routes } from 'react-router-dom'
import { SettingsPage } from './features/account/SettingsPage'
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
      {/* Not "/user/..." or "/account" — the dev proxy forwards /user to the backend
          (vite.config.ts), same shadowing concern as "/view/:id" above. */}
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
