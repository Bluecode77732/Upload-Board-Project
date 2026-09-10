// 목적: 모든 페이지의 nav bar가 공유하는 라이트/다크 토글 버튼.
// 사용처: login-page.tsx, dashboard-page.tsx, users-page.tsx, logs-page.tsx에서 렌더링된다.
// 근거: lib/audit.ts는 세 번째 페이지가 필요해지고 나서야 공유 audit-log 렌더링을 분리했지만
// (그 파일 자체의 헤더 주석 참고), 이 버튼은 네 페이지가 동시에 필요로 하므로 처음부터
// 같은 방식으로 분리한다.

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
