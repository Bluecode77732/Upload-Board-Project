// 목적: 인증된 모든 화면 상단에 표시되는 헤더 내비게이션 — 게시글 보드(홈)와 파일 보드로 가는
//   링크, 라이트/다크 테마 토글, 로그아웃.
// 사용처: RequireAuth 하위 각 화면 상단에 렌더링된다(PostBoard, PostDetailPage,
//   DashboardPage, FileDetailPage).
// 근거: Posts가 앱의 홈인 "/"로 옮겨오면서(backend Stage 3 board 완료) 예전에는 DashboardPage
//   헤더에만 있던 nav/로그아웃 마크업을 여기로 모았다. STYLE-PLAN.md의 토큰 기반 작업
//   (frontend/docs/STYLE-PLAN.md)에서 CSS Module로 전환하고 테마 토글이 추가됐다.

import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useTheme } from '../theme/useTheme'
import styles from './NavBar.module.css'

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return isActive ? styles.navLinkActive : styles.navLink
}

export function NavBar() {
  const { signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" end className={navLinkClassName}>
          Posts
        </NavLink>
        <NavLink to="/files" className={navLinkClassName}>
          Files
        </NavLink>
        <NavLink to="/settings" className={navLinkClassName}>
          Settings
        </NavLink>
      </nav>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button type="button" className={styles.signOut} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </header>
  )
}
