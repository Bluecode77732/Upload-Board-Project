// 목적: 보호된 라우트의 게이트 — 로그아웃 상태면 /login으로 리다이렉트하고, silent refresh 동안은 대기한다.
// 사용처: 보호할 라우트 엘리먼트를 감싼다: <RequireAuth><Dashboard/></RequireAuth>.
// 근거: 마운트 시점의 리프레시(AuthProvider) 때문에 'loading'은 anonymous로 취급하면 안 되는 실제
//   상태다 — 그러지 않으면 새로고침 시 쿠키를 시도해보기도 전에 인증된 사용자가 /login으로 튕긴다.

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === 'loading') return <p style={{ padding: 24 }}>Loading…</p>
  if (status === 'anonymous') return <Navigate to="/login" replace />
  return <>{children}</>
}
