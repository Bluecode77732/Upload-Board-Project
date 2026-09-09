// 목적: 인증 상태를 소유한다 — 마운트 시 silent refresh를 시도하고, 메모리 상의 액세스 토큰을
//   추적하며, signIn/register/signOut을 트리에 노출한다.
// 사용처: main.tsx에서 앱을 한 번 감싸고, 자식들은 useAuth로 상태를 읽는다.
// 근거: 액세스 토큰은 메모리에만 있으므로(ADR 0012) 새 페이지 로드는 anonymous로 시작해
//   httpOnly refresh 쿠키로 세션을 조용히 다시 수립한다 — 그 일이 일어나는 곳이 여기다.

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

  // 토큰 변화(로그인, silent refresh, 만료)를 렌더 상태에 반영한다.
  useEffect(() => {
    return subscribe((token) => {
      setStatus(token ? 'authenticated' : 'anonymous')
      setCurrentUserId(getCurrentUserId())
    })
  }, [])

  // 마운트 시 refresh 쿠키로 세션을 되살려본다.
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
