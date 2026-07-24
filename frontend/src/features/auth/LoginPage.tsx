// Purpose: the email/password login form — signs in (or registers then signs in) via the Basic-token flow.
// Usage: rendered at /login; redirects to / on success.
// Rationale: the canonical signin path is POST /auth/signin (Basic) — the client's btoa header assembly is
//   hidden inside api/client.ts, so this component just collects credentials and branches on error `code`.

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    // Branch on the stable code, not the human-readable message (backend ADR 0011).
    switch (error.code) {
      case ErrorCode.AUTH_INVALID_CREDENTIALS:
        return 'Incorrect email or password.'
      case ErrorCode.AUTH_EMAIL_TAKEN:
        return 'That email is already registered — try signing in.'
      case ErrorCode.VALIDATION_FAILED:
        return 'Please enter a valid email and password.'
      default:
        return 'Something went wrong. Please try again.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function LoginPage() {
  const { signIn, register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'register') {
        await register(email, password)
      }
      await signIn(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(messageForError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 24 }}>
      <h1>{mode === 'signin' ? 'Sign in' : 'Register'}</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Register & sign in'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signin' ? 'register' : 'signin')
          setError(null)
        }}
        style={{ marginTop: 12, background: 'none', border: 'none', color: '#646cff', cursor: 'pointer' }}
      >
        {mode === 'signin' ? 'Need an account? Register' : 'Have an account? Sign in'}
      </button>
    </main>
  )
}
