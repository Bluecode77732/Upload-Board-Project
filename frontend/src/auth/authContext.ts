// 목적: 인증 상태를 위한 React 컨텍스트 객체 + 공유 타입(provider와 분리해 둬야 Vite
//   fast-refresh가 정상 동작한다 — 컴포넌트를 export하는 파일이 컨텍스트/hook까지 export하면 안 된다).
// 사용처: AuthProvider가 값을 공급하고, useAuth(별도 파일)가 소비한다.
// 근거: 컨텍스트/provider/hook을 파일별로 나누는 것은 fast-refresh 안전 규칙이다.

import { createContext } from 'react'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  // 로그인한 사용자의 id(액세스 토큰의 `sub` 클레임에서 디코딩), 로그아웃 상태면 null.
  // canManage를 위한 UI 힌트일 뿐 — 실제 권한 판단은 서버의 403이다.
  currentUserId: number | null
  signIn: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
