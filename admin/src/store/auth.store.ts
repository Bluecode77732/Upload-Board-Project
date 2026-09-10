import { create } from 'zustand';

// 이 백엔드의 3단계 role enum(backend/auth/role/role.ts)이다 — Chat Project의 숫자형
// 0/1/2가 아니라 문자열이다.
export type UserRole = 'user' | 'admin' | 'superadmin';

interface AuthState {
    accessToken: string | null;
    userId: number | null;
    role: UserRole | null;
    setTokens: (accessToken: string, userId: number, role: UserRole) => void;
    clearTokens: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
    accessToken: null,
    userId: null,
    role: null,
    setTokens: (accessToken, userId, role) => set({ accessToken, userId, role }),
    clearTokens: () => set({ accessToken: null, userId: null, role: null }),
}));
