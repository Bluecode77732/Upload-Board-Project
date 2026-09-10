// 목적: admin 콘솔의 라이트/다크 테마 선택 상태를 보관하고 DOM과 동기화한다.
// 사용처: main.tsx(렌더 전에 호출해 잘못된 테마가 잠깐 보이는 것을 막는다)와
// theme-toggle.tsx(상태 조회/전환용)에서 import한다.
// 근거: auth.store.ts의 zustand 패턴이 이미 이 프로젝트에 있으므로, 테마 토글도 같은 형태
// (state + setter)를 쓰되 세션 한정 상태 대신 localStorage 영속화를 쓴다 — UI 선호는
// 로그아웃 이후에도 유지되어야 한다.

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

// 컴포넌트 effect 안이 아니라 모듈 로드 시점에 즉시 초기 테마를 적용해서, React의 첫
// 페인트 이전에 `dark` 클래스가 documentElement에 반영되도록 한다.
applyTheme(useThemeStore.getState().theme);
