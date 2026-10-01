// 목적: 이메일/비밀번호 로그인 폼 — Basic-token 흐름으로 signin(또는 register 후 signin)한다.
// 사용처: /login에 렌더링된다; 성공하면 /로 리다이렉트한다.
// 근거: 정식 signin 경로는 POST /auth/signin(Basic)이다 — 클라이언트의 btoa 헤더 조립은
//   api/client.ts 안에 숨어 있으므로, 이 컴포넌트는 자격 증명을 모으고 에러 `code`로 분기만 한다.

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import { useLanguage } from '../../i18n/useLanguage'
import type { Translatable } from '../../i18n/messages'
import styles from './LoginPage.module.css'

// 목적: 로그인/가입 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 비밀번호가 약해 가입이 거절돼도 AUTH_WEAK_PASSWORD가 default로 떨어져 "Something went wrong"만
//       보였고, 분당 5회 제한(RATE_LIMITED)에 걸려도 똑같았다. 또 한/영 토글 후에도 떠 있는 에러가
//       새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
// 방법: ApiError의 고정 code로 switch(message는 파싱하지 않는다)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    // 사람이 읽는 메시지가 아니라 고정된 code로 분기한다(backend ADR 0011).
    switch (error.code) {
      case ErrorCode.AUTH_INVALID_CREDENTIALS:
        return 'login.err.invalidCredentials'
      case ErrorCode.AUTH_EMAIL_TAKEN:
        return 'login.err.emailTaken'
      case ErrorCode.AUTH_WEAK_PASSWORD:
        return 'login.err.weakPassword'
      case ErrorCode.RATE_LIMITED:
        return 'login.err.rateLimited'
      case ErrorCode.VALIDATION_FAILED:
        return 'login.err.validation'
      default:
        return 'login.err.default'
    }
  }
  return 'common.networkError'
}

export function LoginPage() {
  const { signIn, register } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [error, setError] = useState<Translatable | null>(null)
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
        <h1 className={styles.heading}>{t(mode === 'signin' ? 'login.signIn' : 'login.register')}</h1>
        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.field}>
            {t('login.email')}
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
            {t('login.password')}
            <input
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <p className={styles.error}>{t(error)}</p>}
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? t('login.wait') : t(mode === 'signin' ? 'login.signIn' : 'login.registerAndSignIn')}
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
          {t(mode === 'signin' ? 'login.switchToRegister' : 'login.switchToSignIn')}
        </button>
      </div>
    </main>
  )
}
