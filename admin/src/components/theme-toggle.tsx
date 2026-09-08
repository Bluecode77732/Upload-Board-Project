// Purpose: light/dark toggle button shared by every page's nav bar.
// Usage: rendered in login-page.tsx, dashboard-page.tsx, users-page.tsx, logs-page.tsx.
// Rationale: lib/audit.ts extracted shared audit-log rendering once a third page needed
// it (see its own header comment) — this button needs the same treatment from the start,
// since all four pages need it simultaneously.

import { useThemeStore } from '../store/theme.store';

function ThemeToggle() {
    const { theme, toggleTheme } = useThemeStore();

    return (
        <button
            onClick={toggleTheme}
            data-testid="theme-toggle"
            className="text-sm text-gray-600 hover:underline dark:text-gray-300"
        >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
    );
}

export default ThemeToggle;
