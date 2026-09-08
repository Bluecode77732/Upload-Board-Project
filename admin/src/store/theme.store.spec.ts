import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useThemeStore } from './theme.store';

describe('useThemeStore', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.classList.remove('dark');
    });

    afterEach(() => {
        localStorage.clear();
        document.documentElement.classList.remove('dark');
    });

    it('toggles the theme and flips the documentElement dark class.', () => {
        const before = useThemeStore.getState().theme;

        useThemeStore.getState().toggleTheme();

        const after = useThemeStore.getState().theme;
        expect(after).not.toBe(before);
        expect(document.documentElement.classList.contains('dark')).toBe(after === 'dark');
    });

    it('persists the toggled theme to localStorage.', () => {
        useThemeStore.getState().toggleTheme();

        const stored = localStorage.getItem('admin-theme');
        expect(stored).toBe(useThemeStore.getState().theme);
    });

    it('toggling twice returns to the original theme.', () => {
        const original = useThemeStore.getState().theme;

        useThemeStore.getState().toggleTheme();
        useThemeStore.getState().toggleTheme();

        expect(useThemeStore.getState().theme).toBe(original);
    });
});
