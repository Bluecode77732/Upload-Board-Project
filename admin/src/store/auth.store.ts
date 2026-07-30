import { create } from 'zustand';

interface AuthState {
    accessToken: string | null;
    userId: number | null;
    role: number | null;
    setTokens: (accessToken: string, userId: number, role: number) => void;
    clearTokens: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
    accessToken: null,
    userId: null,
    role: null,
    setTokens: (accessToken, userId, role) => set({ accessToken, userId, role }),
    clearTokens: () => set({ accessToken: null, userId: null, role: null }),
}));
