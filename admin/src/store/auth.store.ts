import { create } from 'zustand';

// This backend's three-tier role enum (backend/auth/role/role.ts) — a string, not the
// Chat Project's numeric 0/1/2.
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
