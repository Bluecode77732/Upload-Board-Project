import { describe, it, expect, afterEach } from 'vitest';
import { useAuthStore } from './auth.store';

describe('useAuthStore', () => {
    afterEach(() => {
        useAuthStore.getState().clearTokens();
    });

    it('starts with no token, userId, or role.', () => {
        const state = useAuthStore.getState();

        expect(state.accessToken).toBeNull();
        expect(state.userId).toBeNull();
        expect(state.role).toBeNull();
    });

    it('sets the token, userId, and role together.', () => {
        useAuthStore.getState().setTokens('token-abc', 1, 2);

        const state = useAuthStore.getState();
        expect(state.accessToken).toBe('token-abc');
        expect(state.userId).toBe(1);
        expect(state.role).toBe(2);
    });

    it('clears the token, userId, and role together.', () => {
        useAuthStore.getState().setTokens('token-abc', 1, 2);
        useAuthStore.getState().clearTokens();

        const state = useAuthStore.getState();
        expect(state.accessToken).toBeNull();
        expect(state.userId).toBeNull();
        expect(state.role).toBeNull();
    });
});
