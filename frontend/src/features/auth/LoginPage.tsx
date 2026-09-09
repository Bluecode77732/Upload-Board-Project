// 목적: 이메일/비밀번호 로그인 폼 — Basic-token 흐름으로 signin(또는 register 후 signin)한다.
// 사용처: /login에 렌더링된다; 성공하면 /로 리다이렉트한다.
// 근거: 정식 signin 경로는 POST /auth/signin(Basic)이다 — 클라이언트의 btoa 헤더 조립은
//   api/client.ts 안에 숨어 있으므로, 이 컴포넌트는 자격 증명을 모으고 에러 `code`로 분기만 한다.

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import styles from './LoginPage.module.css'

function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    // 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011).
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
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.lockup}>
          <svg className={styles.mark} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="12" r="6" />
            <circle cx="15" cy="12" r="6" />
          </svg>
          <span>Sharenpo</span>
        </div>
        <h1 className={styles.heading}>{mode === 'signin' ? 'Sign in' : 'Register'}</h1>
        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.field}>
            Email
            <input
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className={styles.field}>
            Password
            <input
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Register & sign in'}
          </button>
        </form>
        <button
          type="button"
          className={styles.switchButton}
          onClick={() => {
            setMode(mode === 'signin' ? 'register' : 'signin')
            setError(null)
          }}
        >
          {mode === 'signin' ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
      </div>
    </main>
  )
}
