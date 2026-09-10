// 목적: 라이트/다크 테마 선택을 위한 React 컨텍스트 객체 + 공유 타입(provider와 분리해 둬야
//   Vite fast-refresh가 정상 동작한다 — 컴포넌트를 export하는 파일이 컨텍스트/hook까지
//   export하면 안 된다).
// 사용처: ThemeProvider가 값을 공급하고, useTheme(별도 파일)이 소비한다.
// 근거: 컨텍스트/provider/hook을 파일별로 나누는 것은 src/auth/에서 이미 쓰고 있는
//   fast-refresh 안전 규칙이다.

import { createContext } from 'react'

export type Theme = 'light' | 'dark'

export interface ThemeContextValue {
  // 현재 적용 중인 테마 — 사용자가 명시적으로 선택했거나, 아직 선택한 적 없으면
  // 판별된 OS 선호도.
  theme: Theme
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)
