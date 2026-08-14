// Purpose: owns the explicit light/dark theme choice — persists it to localStorage, applies
//   it as `data-theme` on <html>, and falls back to the OS `prefers-color-scheme` (live) when
//   nothing has been picked yet.
// Usage: wrap the app once in main.tsx; children read/toggle via useTheme.
// Rationale: STYLE-PLAN.md's toggle design — a stored explicit pick survives reload, but an
//   unvisited/never-toggled app still tracks the OS preference the same way index.css's
//   `@media (prefers-color-scheme: dark)` block already did.

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

  // Reflect the current choice onto <html>, and — while nothing is explicitly stored —
  // keep tracking a live OS preference change (mirrors the old media-query-only behavior).
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
