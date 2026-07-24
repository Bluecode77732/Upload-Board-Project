// Purpose: gate for protected routes — redirects to /login while anonymous, waits during the silent refresh.
// Usage: wrap protected route elements: <RequireAuth><Dashboard/></RequireAuth>.
// Rationale: the mount-time refresh (AuthProvider) means 'loading' is a real state we must not treat as
//   anonymous, or a reload would bounce an authenticated user to /login before the cookie is tried.

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === 'loading') return <p style={{ padding: 24 }}>Loading…</p>
  if (status === 'anonymous') return <Navigate to="/login" replace />
  return <>{children}</>
}
