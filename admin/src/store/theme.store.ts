// Purpose: holds the admin console's light/dark theme choice and keeps the DOM in sync with it.
// Usage: imported by main.tsx (before render, to avoid a flash of the wrong theme) and by
// theme-toggle.tsx (to read/flip it).
// Rationale: auth.store.ts's zustand pattern already exists in this project; a theme toggle
// needs the same shape (state + setter) but with localStorage persistence instead of
// session-only state, since a UI preference should survive across sign-outs.

import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'admin-theme';

// 목적: localStorage에 저장된 테마가 있으면 그것을, 없으면 OS 설정을 초기값으로 고른다.
// 이유: 관리자가 명시적으로 고른 테마는 시스템 설정보다 우선해야 하지만, 아무 선택도 없었다면
//       시스템 다크 모드 사용자에게 밝은 화면을 강제로 보여주지 않는 편이 낫다.
// 방법: localStorage 값이 'light'|'dark'면 그대로 쓰고, 아니면 matchMedia로 폴백한다.
function resolveInitialTheme(): Theme {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// 목적: 현재 테마를 <html> 클래스와 localStorage 양쪽에 반영한다.
// 이유: index.css의 @custom-variant dark는 documentElement의 .dark 클래스를 읽으므로,
//       상태만 바꾸고 클래스를 안 바꾸면 화면이 갱신되지 않는다.
// 방법: theme === 'dark'일 때만 documentElement에 'dark' 클래스를 추가/제거하고, 선택을 저장한다.
function applyTheme(theme: Theme): void {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
}

interface ThemeState {
    theme: Theme;
    toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
    theme: resolveInitialTheme(),
    toggleTheme: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        set({ theme: next });
    },
}));

// Applies the resolved initial theme immediately on module load (not inside a component
// effect) so the `dark` class is on documentElement before React's first paint.
applyTheme(useThemeStore.getState().theme);
