// Purpose: typed accessor for the auth context that throws if used outside AuthProvider.
// Usage: const { status, signIn, signOut } = useAuth() inside any component under the provider.
// Rationale: its own file keeps fast-refresh boundaries clean (hook separate from provider component).

import { useContext } from 'react'
import { AuthContext } from './authContext'

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within an AuthProvider')
  return value
}
