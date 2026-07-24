// Purpose: the React context object + shared types for auth state (kept separate from the provider so
//   Vite fast-refresh stays happy — a file exporting a component shouldn't also export a context/hook).
// Usage: AuthProvider supplies the value; useAuth (its own file) consumes it.
// Rationale: splitting context/provider/hook across files is the fast-refresh-safe convention.

import { createContext } from 'react'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  signIn: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
