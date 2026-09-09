// 목적: AuthProvider 밖에서 쓰이면 에러를 던지는, 타입이 있는 auth 컨텍스트 접근자.
// 사용처: provider 하위 어떤 컴포넌트에서든 const { status, signIn, signOut } = useAuth()로 사용.
// 근거: 별도 파일로 분리해야 fast-refresh 경계가 깨끗하게 유지된다(hook과 provider 컴포넌트 분리).

import { useContext } from 'react'
import { AuthContext } from './authContext'

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within an AuthProvider')
  return value
}
