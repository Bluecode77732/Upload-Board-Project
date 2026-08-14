// Purpose: typed accessor for the theme context that throws if used outside ThemeProvider.
// Usage: const { theme, toggleTheme } = useTheme() inside any component under the provider.
// Rationale: its own file keeps fast-refresh boundaries clean (hook separate from provider
//   component), mirroring src/auth/useAuth.ts.

import { useContext } from 'react'
import { ThemeContext } from './themeContext'

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within a ThemeProvider')
  return value
}
