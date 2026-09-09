// 목적: 명시적으로 선택한 라이트/다크 테마를 소유한다 — localStorage에 저장하고, <html>에
//   `data-theme`로 적용하며, 아직 아무것도 선택되지 않았을 때는 OS `prefers-color-scheme`(실시간)로
//   되돌아간다.
// 사용처: main.tsx에서 앱을 한 번 감싸고, 자식들은 useTheme으로 읽고/토글한다.
// 근거: STYLE-PLAN.md의 토글 설계 — 저장된 명시적 선택은 새로고침에도 유지되지만, 아직 방문/토글한
//   적 없는 앱은 index.css의 `@media (prefers-color-scheme: dark)` 블록이 하던 대로 여전히 OS
//   선호도를 따라간다.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from './themeContext'

const STORAGE_KEY = 'ui-theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function storedTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [explicit, setExplicit] = useState<Theme | null>(() => storedTheme())
  const [theme, setTheme] = useState<Theme>(() => explicit ?? systemTheme())

  // 현재 선택을 <html>에 반영하고 — 명시적으로 저장된 값이 없는 동안에는 — OS 선호도의
  // 실시간 변경도 계속 추적한다(예전의 미디어쿼리 전용 동작과 동일하다).
  useEffect(() => {
    if (explicit) {
      document.documentElement.setAttribute('data-theme', explicit)
      setTheme(explicit)
      return
    }

    document.documentElement.removeAttribute('data-theme')
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setTheme(media.matches ? 'dark' : 'light')
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [explicit])

  const toggleTheme = useCallback(() => {
    setExplicit((current) => {
      const next: Theme = (current ?? systemTheme()) === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}
