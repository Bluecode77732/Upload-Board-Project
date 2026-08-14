// Purpose: header navigation shown on every authenticated screen — links to the post board
//   (home) and the file board, a light/dark theme toggle, and sign-out.
// Usage: rendered at the top of each screen behind RequireAuth (PostBoard, PostDetailPage,
//   DashboardPage, FileDetailPage).
// Rationale: Posts moved to "/" as the app's home (backend Stage 3 board complete); this
//   centralizes the nav/sign-out markup that used to live only in DashboardPage's header.
//   Converted to a CSS Module and gained the theme toggle as part of the STYLE-PLAN.md
//   token-foundation pass (frontend/docs/STYLE-PLAN.md).

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
          My Files
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
