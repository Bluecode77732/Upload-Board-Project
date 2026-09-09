import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import ProtectedRoute from './protected-route';

vi.mock('../auth/session-guard', () => ({
    refreshAccessTokenSafely: vi.fn(),
}));

import { refreshAccessTokenSafely } from '../auth/session-guard';

function renderProtectedRoute() {
    return render(
        <MemoryRouter initialEntries={['/protected']}>
            <Routes>
                <Route path='/' element={<div>Login Page</div>} />
                <Route
                    path='/protected'
                    element={
                        <ProtectedRoute>
                            <div>Secret Content</div>
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </MemoryRouter>,
    );
}

describe('ProtectedRoute', () => {
    beforeEach(() => {
        useAuthStore.getState().clearTokens();
        vi.clearAllMocks();
    });

    afterEach(() => {
        useAuthStore.getState().clearTokens();
    });

    it('renders the protected content when an admin token is already present.', async () => {
        useAuthStore.getState().setTokens('token-abc', 1, 'admin');

        renderProtectedRoute();

        expect(await screen.findByText('Secret Content')).toBeInTheDocument();
        expect(refreshAccessTokenSafely).not.toHaveBeenCalled();
    });

    it("redirects a regular user (role 'user') away from the protected content.", async () => {
        useAuthStore.getState().setTokens('token-abc', 1, 'user');

        renderProtectedRoute();

        expect(await screen.findByText('Login Page')).toBeInTheDocument();
        expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
    });

    it('refreshes the token on mount when none is stored, then renders for an admin.', async () => {
        // refreshAccessTokenSafely의 실제 구현은 부수 효과로 store를 갱신하므로,
        // ProtectedRoute가 더 이상 store를 직접 건드리지 않는 만큼 mock도 이를 그대로 재현해야 한다.
        (refreshAccessTokenSafely as ReturnType<typeof vi.fn>).mockImplementation(async () => {
            useAuthStore.getState().setTokens('new-token', 5, 'admin');
            return 'new-token';
        });

        renderProtectedRoute();

        await waitFor(() => expect(refreshAccessTokenSafely).toHaveBeenCalled());
        expect(await screen.findByText('Secret Content')).toBeInTheDocument();
        expect(useAuthStore.getState().accessToken).toBe('new-token');
    });

    it('redirects to the login page when the silent refresh fails.', async () => {
        (refreshAccessTokenSafely as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        renderProtectedRoute();

        expect(await screen.findByText('Login Page')).toBeInTheDocument();
        expect(useAuthStore.getState().accessToken).toBeNull();
    });
});
