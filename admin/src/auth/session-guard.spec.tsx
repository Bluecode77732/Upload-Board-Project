// Purpose: pins the session-owner record's lifecycle — login writes it, sign-out clears it —
// so a same-tab account switch is not misread as a sibling tab hijacking the session.
// Usage: `pnpm test` in admin/; the only spec that drives session-guard's real doRefresh path.
// Rationale: recordSessionUser/clearSessionUser had zero call sites outside session-guard.ts,
// and no existing spec (protected-route/axios) mocks the guard away rather than exercising it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { recordSessionUser, refreshAccessTokenSafely } from './session-guard';
import LoginPage from '../pages/login-page';
import DashboardPage from '../pages/dashboard-page';

vi.mock('../api/axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

import api from '../api/axios';

const mockApi = api as unknown as {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
};

const SESSION_USER_KEY = 'admin:sessionUserId';

// jwt-decode never verifies a signature, so an unsigned base64url payload is enough here.
const makeAccessToken = (sub: number, role = 'admin') => {
    const encode = (value: object) =>
        btoa(JSON.stringify(value))
            .split('+')
            .join('-')
            .split('/')
            .join('_')
            .split('=')
            .join('');
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub, role })}.signature`;
};

const renderLoginPage = () =>
    render(
        <MemoryRouter initialEntries={['/']}>
            <LoginPage />
        </MemoryRouter>,
    );

const renderDashboardPage = () =>
    render(
        <MemoryRouter initialEntries={['/dashboard']}>
            <DashboardPage />
        </MemoryRouter>,
    );

// Drives the real login form so the session-owner record is written by the page under
// test, not by the spec — a direct recordSessionUser() call would pass even unfixed.
const signInAs = async (userId: number) => {
    mockApi.post.mockResolvedValue({ data: { accessToken: makeAccessToken(userId) } });
    const view = renderLoginPage();
    await userEvent.type(screen.getByTestId('login-email-input'), `admin${userId}@example.com`);
    await userEvent.type(screen.getByTestId('login-password-input'), 'password');
    await userEvent.click(screen.getByTestId('login-submit-button'));
    await waitFor(() => expect(useAuthStore.getState().userId).toBe(userId));
    view.unmount();
};

// Drives a real page's sign-out button for the same reason.
const signOutFromDashboard = async () => {
    const view = renderDashboardPage();
    await userEvent.click(await screen.findByTestId('sign-out-button'));
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull());
    view.unmount();
};

describe('admin session-owner lifecycle', () => {
    beforeEach(() => {
        sessionStorage.clear();
        useAuthStore.getState().clearTokens();
        mockApi.get.mockReset();
        mockApi.post.mockReset();
        // DashboardPage's mount fires four stat reads; every response is a [rows, total] tuple.
        mockApi.get.mockResolvedValue({ data: [[], 0] });
        mockApi.post.mockResolvedValue({ data: {} });
        // rejectSession() hard-navigates; jsdom cannot, so observe the attempt instead.
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...window.location, replace: vi.fn() },
        });
    });

    afterEach(() => {
        sessionStorage.clear();
        useAuthStore.getState().clearTokens();
        vi.unstubAllGlobals();
    });

    it("records the signed-in account as this tab's session owner on login.", async () => {
        mockApi.post.mockResolvedValue({ data: { accessToken: makeAccessToken(7) } });

        renderLoginPage();
        await userEvent.type(screen.getByTestId('login-email-input'), 'admin@example.com');
        await userEvent.type(screen.getByTestId('login-password-input'), 'password');
        await userEvent.click(screen.getByTestId('login-submit-button'));

        await waitFor(() => expect(sessionStorage.getItem(SESSION_USER_KEY)).toBe('7'));
    });

    it('leaves no session owner recorded when a non-admin login is refused.', async () => {
        mockApi.post.mockResolvedValue({ data: { accessToken: makeAccessToken(7, 'user') } });

        renderLoginPage();
        await userEvent.type(screen.getByTestId('login-email-input'), 'user@example.com');
        await userEvent.type(screen.getByTestId('login-password-input'), 'password');
        await userEvent.click(screen.getByTestId('login-submit-button'));

        expect(await screen.findByTestId('login-error')).toBeInTheDocument();
        expect(sessionStorage.getItem(SESSION_USER_KEY)).toBeNull();
    });

    it('clears the recorded session owner on sign-out.', async () => {
        recordSessionUser(7);
        useAuthStore.getState().setTokens(makeAccessToken(7), 7, 'admin');

        renderDashboardPage();
        await userEvent.click(await screen.findByTestId('sign-out-button'));

        await waitFor(() => expect(sessionStorage.getItem(SESSION_USER_KEY)).toBeNull());
        expect(useAuthStore.getState().accessToken).toBeNull();
    });

    it("accepts the next account's refresh after a sign-out and re-login in the same tab.", async () => {
        // Account A owns the tab, then signs out.
        await signInAs(1);
        expect(sessionStorage.getItem(SESSION_USER_KEY)).toBe('1');
        await signOutFromDashboard();

        // Account B signs in and the tab reloads — the guard's first refresh must adopt B.
        await signInAs(2);
        expect(sessionStorage.getItem(SESSION_USER_KEY)).toBe('2');
        const tokenB = makeAccessToken(2);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: tokenB }) }),
        );

        await expect(refreshAccessTokenSafely()).resolves.toBe(tokenB);
        expect(window.location.replace).not.toHaveBeenCalled();
        expect(useAuthStore.getState().userId).toBe(2);
    });

    it('still rejects a refresh for a different account while the tab is owned.', async () => {
        // The multi-tab defence itself is unchanged: only the record's lifecycle was broken.
        recordSessionUser(1);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ accessToken: makeAccessToken(2) }),
            }),
        );

        await expect(refreshAccessTokenSafely()).resolves.toBeNull();
        expect(window.location.replace).toHaveBeenCalledWith('/');
        expect(sessionStorage.getItem(SESSION_USER_KEY)).toBeNull();
    });
});
