// Purpose: lets the signed-in user delete their own account, driving the backend's already-
//   complete DELETE /user/:id?deleteFiles= confirmation flow (ADR 0020) — no other UI called it.
// Usage: rendered at /settings behind RequireAuth; linked from NavBar.
// Rationale: neither DashboardPage nor FileDetailPage is the right home for account-level
//   (not file-level) actions — a new feature folder mirrors files/posts/auth's own layout.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import { useAuth } from '../../auth/useAuth'
import { NavBar } from '../../shared/NavBar'
import styles from './SettingsPage.module.css'

// Branch on the stable code (backend ADR 0011), never on the human-readable message.
function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.USER_FILES_IN_USE:
        return "One of your files is attached to another user's post and cannot be deleted yet — ask them to remove the post first (ADR 0024)."
      default:
        return 'Failed to delete your account. Please try again.'
    }
  }
  return 'Network error. Is the backend running?'
}

export function SettingsPage() {
  const { currentUserId, signOut } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // The backend's 409 USER_HAS_FILES message (file count included) — displayed verbatim so the
  // developer doesn't re-derive a count the backend already computed.
  const [filesWarning, setFilesWarning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 목적: DELETE /user/:id[?deleteFiles=true]를 실제로 호출하고 성공/409/기타 에러를 상태로 반영한다.
  // 이유: 파일을 보유한 계정은 기본 삭제가 409 USER_HAS_FILES로 거절되므로(ADR 0020), 그 경우와
  //       실제 성공/다른 에러를 구분해야 한다.
  // 방법: deleteFiles=false로 먼저 시도 → 409 USER_HAS_FILES면 백엔드 메시지를 그대로 노출하고 2차
  //       확인 버튼을 드러낸 뒤 종료 → 그 외 실패는 일반 에러 표시 → 성공 시 signOut 후 /login 이동
  //       (삭제된 계정의 토큰을 메모리에 남기지 않는다).
  async function deleteAccount(deleteFiles: boolean) {
    if (currentUserId === null) return
    try {
      await api.delete(`/user/${currentUserId}${deleteFiles ? '?deleteFiles=true' : ''}`)
      await signOut()
      navigate('/login')
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.USER_HAS_FILES && !deleteFiles) {
        setFilesWarning(err.message)
        setBusy(false)
        return
      }
      setError(messageForError(err))
      setBusy(false)
    }
  }

  function handleDeleteAccount() {
    if (currentUserId === null) return
    if (!window.confirm('Delete your account? This cannot be undone.')) return
    setError(null)
    setFilesWarning(null)
    setBusy(true)
    void deleteAccount(false)
  }

  function handleConfirmDeleteWithFiles() {
    if (!window.confirm('Delete your account AND all your files? This cannot be undone.')) return
    setFilesWarning(null)
    setBusy(true)
    void deleteAccount(true)
  }

  return (
    <main className={styles.page}>
      <NavBar />
      <h1>Settings</h1>
      <section className={styles.danger}>
        <h2 className={styles.dangerHeading}>Delete account</h2>
        <p className={styles.meta}>Permanently deletes your account. This cannot be undone.</p>
        {error && <p className={styles.error}>{error}</p>}
        {filesWarning && (
          <div className={styles.warningBox}>
            <p className={styles.warningText}>{filesWarning}</p>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmDeleteWithFiles}
              className={styles.deleteButton}
            >
              Delete account and all files
            </button>
          </div>
        )}
        <button type="button" disabled={busy} onClick={handleDeleteAccount} className={styles.deleteButton}>
          Delete account
        </button>
      </section>
    </main>
  )
}
