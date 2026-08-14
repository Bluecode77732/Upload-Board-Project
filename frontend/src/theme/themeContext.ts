// Purpose: the React context object + shared types for the light/dark theme choice (kept
//   separate from the provider so Vite fast-refresh stays happy — a file exporting a
//   component shouldn't also export a context/hook).
// Usage: ThemeProvider supplies the value; useTheme (its own file) consumes it.
// Rationale: splitting context/provider/hook across files is the fast-refresh-safe
//   convention already used by src/auth/.

import { createContext } from 'react'

export type Theme = 'light' | 'dark'

export interface ThemeContextValue {
  // The theme currently in effect — an explicit user pick, or the resolved OS preference
  // when nothing has been picked yet.
  theme: Theme
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)
