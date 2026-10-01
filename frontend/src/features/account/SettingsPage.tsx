// 목적: 로그인한 사용자가 본인 계정을 삭제하게 한다 — 백엔드에 이미 완성돼 있던
//   DELETE /user/:id?deleteFiles= 확인 흐름(ADR 0020)을 호출하는 UI가 그동안 없었다.
// 사용처: RequireAuth 하위 /settings에 렌더링된다; NavBar에서 링크로 연결된다.
// 근거: DashboardPage도 FileDetailPage도 (파일 수준이 아닌) 계정 수준 액션을 둘 적절한 곳이
//   아니어서, files/posts/auth와 같은 레이아웃을 따르는 새 feature 폴더를 만들었다.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { ErrorCode } from '../../api/errorCodes'
import { useAuth } from '../../auth/useAuth'
import { useLanguage } from '../../i18n/useLanguage'
import type { Translatable } from '../../i18n/messages'
import { NavBar } from '../../shared/NavBar'
import styles from './SettingsPage.module.css'

// 목적: 계정 삭제 실패 응답을 화면에 보여줄 메시지 키로 바꾼다.
// 이유: 한/영 토글 후에도 떠 있는 에러가 새 언어로 다시 그려지도록 번역된 문자열이 아니라 키를 돌려준다.
// 방법: ApiError의 고정 code로 switch(backend ADR 0011)해 키를 고르고, 문구는 렌더 시 t()가 만든다.
function messageForError(error: unknown): Translatable {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.USER_FILES_IN_USE:
        return 'settings.err.filesInUse'
      default:
        return 'settings.err.deleteFailed'
    }
  }
  return 'common.networkError'
}

export function SettingsPage() {
  const { currentUserId, signOut } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [error, setError] = useState<Translatable | null>(null)
  // 백엔드의 409 USER_HAS_FILES 메시지(파일 개수 포함) — 백엔드가 이미 계산한 개수를
  // 다시 산출하지 않도록 그대로 표시한다(서버가 준 영어 문구라 번역하지 않는다).
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
    if (!window.confirm(t('settings.confirmDelete'))) return
    setError(null)
    setFilesWarning(null)
    setBusy(true)
    void deleteAccount(false)
  }

  function handleConfirmDeleteWithFiles() {
    if (!window.confirm(t('settings.confirmDeleteWithFiles'))) return
    setFilesWarning(null)
    setBusy(true)
    void deleteAccount(true)
  }

  return (
    <main className={styles.page}>
      <NavBar />
      <h1>{t('settings.heading')}</h1>
      <section className={styles.danger}>
        <h2 className={styles.dangerHeading}>{t('settings.deleteHeading')}</h2>
        <p className={styles.meta}>{t('settings.deleteDescription')}</p>
        {error && <p className={styles.error}>{t(error)}</p>}
        {filesWarning && (
          <div className={styles.warningBox}>
            <p className={styles.warningText}>{filesWarning}</p>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmDeleteWithFiles}
              className={styles.deleteButton}
            >
              {t('settings.deleteWithFiles')}
            </button>
          </div>
        )}
        <button type="button" disabled={busy} onClick={handleDeleteAccount} className={styles.deleteButton}>
          {t('settings.deleteButton')}
        </button>
      </section>
    </main>
  )
}
