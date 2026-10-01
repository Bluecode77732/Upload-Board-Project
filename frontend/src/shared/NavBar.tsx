// 목적: 인증된 모든 화면 상단에 표시되는 헤더 내비게이션 — 게시글 보드(홈)와 파일 보드로 가는
//   링크, 한/영 언어 토글, 라이트/다크 테마 토글, 로그아웃.
// 사용처: RequireAuth 하위 각 화면 상단에 렌더링된다(PostBoard, PostDetailPage,
//   DashboardPage, FileDetailPage).
// 근거: Posts가 앱의 홈인 "/"로 옮겨오면서(backend Stage 3 board 완료) 예전에는 DashboardPage
//   헤더에만 있던 nav/로그아웃 마크업을 여기로 모았다. STYLE-PLAN.md의 토큰 기반 작업
//   (frontend/docs/STYLE-PLAN.md)에서 CSS Module로 전환하고 테마 토글이 추가됐고, 언어 토글은 그
//   왼쪽에 같은 크기로 붙였다.

import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useLanguage } from '../i18n/useLanguage'
import { useTheme } from '../theme/useTheme'
import styles from './NavBar.module.css'

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return isActive ? styles.navLinkActive : styles.navLink
}

// 목적: 헤더 내비게이션과 언어/테마 토글, 로그아웃 버튼을 그린다.
// 이유: 문구가 한/영으로 바뀌어야 하므로 링크·버튼 이름을 사전 키로 읽고, 언어 토글 버튼이 새로 필요했다.
// 방법: useLanguage의 t()로 문구를 만들고, 토글은 테마 버튼처럼 "눌렀을 때 바뀔 쪽"을 보여준다 —
//   영어일 때 "한", 한국어일 때 "EN". 의미는 aria-label/title이 문장으로 알려준다.
export function NavBar() {
  const { signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { language, toggleLanguage, t } = useLanguage()

  const themeLabel = t(theme === 'dark' ? 'nav.theme.toLight' : 'nav.theme.toDark')
  const languageLabel = t(language === 'en' ? 'nav.language.toKorean' : 'nav.language.toEnglish')

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" end className={navLinkClassName}>
          {t('nav.post')}
        </NavLink>
        <NavLink to="/files" className={navLinkClassName}>
          {t('nav.file')}
        </NavLink>
        <NavLink to="/settings" className={navLinkClassName}>
          {t('nav.setting')}
        </NavLink>
      </nav>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.langToggle}
          onClick={toggleLanguage}
          aria-label={languageLabel}
          title={languageLabel}
        >
          {language === 'en' ? '한' : 'EN'}
        </button>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={toggleTheme}
          aria-label={themeLabel}
          title={themeLabel}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button type="button" className={styles.signOut} onClick={() => void signOut()}>
          {t('nav.signOut')}
        </button>
      </div>
    </header>
  )
}
