// Purpose: header navigation shown on every authenticated screen — links to the post board
//   (home) and the file board, plus sign-out.
// Usage: rendered at the top of each screen behind RequireAuth (PostBoard, PostDetailPage,
//   DashboardPage, FileDetailPage).
// Rationale: Posts moved to "/" as the app's home (backend Stage 3 board complete); this
//   centralizes the nav/sign-out markup that used to live only in DashboardPage's header.

import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

function navLinkStyle({ isActive }: { isActive: boolean }) {
  return { fontWeight: isActive ? 700 : 400 }
}

export function NavBar() {
  const { signOut } = useAuth()

  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}
    >
      <nav style={{ display: 'flex', gap: 16 }}>
        <NavLink to="/" end style={navLinkStyle}>
          Posts
        </NavLink>
        <NavLink to="/files" style={navLinkStyle}>
          My Files
        </NavLink>
      </nav>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </header>
  )
}
