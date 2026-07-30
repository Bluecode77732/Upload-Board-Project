// Purpose: single entry point for silent token refresh and multi-tab session-conflict
// detection in the admin app, mirroring frontend/src/auth/session-guard.ts.
// Usage: imported by api/axios.ts (response interceptor), api/apollo.ts (errorLink), and
// components/protected-route.tsx — no other call site should hit /auth/token/refreshaccess.
// Rationale: axios and apollo previously called the refresh endpoint independently with no
// shared in-flight guard and no cross-tab account-conflict check, unlike the main frontend.

import { jwtDecode } from 'jwt-decode';
import { useAuthStore } from '../store/auth.store';

const SESSION_USER_KEY = 'admin:sessionUserId';

export const recordSessionUser = (userId: number) => {
    sessionStorage.setItem(SESSION_USER_KEY, String(userId));
};

export const clearSessionUser = () => {
    sessionStorage.removeItem(SESSION_USER_KEY);
};

// A tab's first token refresh adopts whichever account the shared refreshToken
// cookie currently belongs to. Any refresh after that must match, otherwise a
// sibling tab logging in as a different admin would silently take this tab over.
const assertSessionUser = (userId: number): boolean => {
    const recorded = sessionStorage.getItem(SESSION_USER_KEY);
    if (recorded === null) {
        recordSessionUser(userId);
        return true;
    }
    return Number(recorded) === userId;
};

const rejectSession = () => {
    useAuthStore.getState().clearTokens();
    clearSessionUser();
    window.location.replace('/');
};

const doRefresh = async (): Promise<string | null> => {
    try {
        // refreshToken cookie is sent automatically via credentials: 'include'.
        // Uses fetch directly (not the axios instance in api/axios.ts) to avoid a
        // circular import, since axios.ts itself calls refreshAccessTokenSafely().
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/token/refreshaccess`, {
            method: 'POST',
            credentials: 'include',
        });
        if (!res.ok) throw new Error('Refresh failed');

        const data = await res.json();
        const { sub, role } = jwtDecode<{ sub: number; role: number }>(data.accessToken);

        if (!assertSessionUser(sub)) {
            rejectSession();
            return null;
        }

        useAuthStore.getState().setTokens(data.accessToken, sub, role);
        return data.accessToken;
    } catch {
        rejectSession();
        return null;
    }
};

let pendingRefresh: Promise<string | null> | null = null;

// Concurrent callers (e.g. an axios 401 and an Apollo UNAUTHENTICATED error firing at
// the same time) share one in-flight request instead of each independently calling the
// refresh endpoint.
export const refreshAccessTokenSafely = (): Promise<string | null> => {
    if (!pendingRefresh) {
        pendingRefresh = doRefresh().finally(() => {
            pendingRefresh = null;
        });
    }
    return pendingRefresh;
};
