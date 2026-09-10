// 목적: ThemeProvider 밖에서 쓰이면 에러를 던지는, 타입이 있는 theme 컨텍스트 접근자.
// 사용처: provider 하위 어떤 컴포넌트에서든 const { theme, toggleTheme } = useTheme()로 사용.
// 근거: 별도 파일로 분리해야 fast-refresh 경계가 깨끗하게 유지된다(hook과 provider 컴포넌트
//   분리) — src/auth/useAuth.ts와 동일한 패턴.

import { useContext } from 'react'
import { ThemeContext } from './themeContext'

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within a ThemeProvider')
  return value
}
