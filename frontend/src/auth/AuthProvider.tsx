// Purpose: owns auth state — attempts a silent refresh on mount, tracks the in-memory access token,
//   and exposes signIn/register/signOut to the tree.
// Usage: wrap the app once in main.tsx; children read state via useAuth.
// Rationale: the access token is memory-only (ADR 0012), so a fresh page load starts anonymous and
//   silently re-establishes the session from the httpOnly refresh cookie — this is where that happens.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  register as apiRegister,
  signin as apiSignin,
  signout as apiSignout,
  refreshAccessToken,
} from '../api/client'
import { getAccessToken, getCurrentUserId, subscribe } from '../api/authStore'
import { AuthContext, type AuthStatus } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  // Reflect token changes (login, silent refresh, expiry) into render state.
  useEffect(() => {
    return subscribe((token) => {
      setStatus(token ? 'authenticated' : 'anonymous')
      setCurrentUserId(getCurrentUserId())
    })
  }, [])

  // On mount, try to revive a session from the refresh cookie.
  useEffect(() => {
    let cancelled = false
    refreshAccessToken()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setStatus(getAccessToken() ? 'authenticated' : 'anonymous')
          setCurrentUserId(getCurrentUserId())
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    await apiSignin(email, password)
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    await apiRegister(email, password)
  }, [])

  const signOut = useCallback(async () => {
    await apiSignout()
  }, [])

  return (
    <AuthContext.Provider value={{ status, currentUserId, signIn, register, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
