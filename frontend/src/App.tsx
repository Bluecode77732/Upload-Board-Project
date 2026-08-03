import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './features/auth/LoginPage'
import { DashboardPage } from './features/files/DashboardPage'
import { FileDetailPage } from './features/files/FileDetailPage'
import { AdminPage } from './features/admin/AdminPage'
import { RequireAuth } from './auth/RequireAuth'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
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
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
