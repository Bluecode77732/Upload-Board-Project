// 목적: 세션 소유자 기록의 생명주기를 고정한다 — 로그인 시 기록하고 로그아웃 시 지워서,
// 같은 탭에서의 계정 전환이 형제 탭의 세션 탈취로 오인되지 않게 한다.
// 사용처: admin/에서 `pnpm test`로 실행; session-guard의 실제 doRefresh 경로를 구동하는 유일한 spec.
// 근거: recordSessionUser/clearSessionUser는 session-guard.ts 밖에서 호출되는 곳이 전혀 없었고,
// 기존 spec(protected-route/axios)들은 guard를 mock으로 걷어내기만 할 뿐 실제로 실행하지 않았다.

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

// jwt-decode는 서명을 검증하지 않으므로 서명 없는 base64url payload만으로도 충분하다.
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

// 실제 로그인 폼을 구동해서 세션 소유자 기록이 spec이 아니라 테스트 대상 페이지에 의해
// 작성되도록 한다 — recordSessionUser()를 직접 호출하면 고치지 않아도 테스트가 통과해버린다.
const signInAs = async (userId: number) => {
    mockApi.post.mockResolvedValue({ data: { accessToken: makeAccessToken(userId) } });
    const view = renderLoginPage();
    await userEvent.type(screen.getByTestId('login-email-input'), `admin${userId}@example.com`);
    await userEvent.type(screen.getByTestId('login-password-input'), 'password');
    await userEvent.click(screen.getByTestId('login-submit-button'));
    await waitFor(() => expect(useAuthStore.getState().userId).toBe(userId));
    view.unmount();
};

// 같은 이유로 실제 페이지의 로그아웃 버튼을 구동한다.
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
        // DashboardPage가 마운트되면 통계 조회 4건이 발생하며, 각 응답은 [rows, total] 튜플이다.
        mockApi.get.mockResolvedValue({ data: [[], 0] });
        mockApi.post.mockResolvedValue({ data: {} });
        // rejectSession()은 강제 페이지 이동을 하는데 jsdom은 이를 수행할 수 없으므로
        // 시도 자체를 관찰한다.
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
        // A 계정이 탭을 소유한 후 로그아웃한다.
        await signInAs(1);
        expect(sessionStorage.getItem(SESSION_USER_KEY)).toBe('1');
        await signOutFromDashboard();

        // B 계정이 로그인하고 탭이 새로고침된다 — guard의 첫 갱신은 B를 받아들여야 한다.
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
        // 다중 탭 방어 로직 자체는 변경되지 않았다 — 깨져 있던 것은 기록의 생명주기뿐이다.
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

// ADR 0062 D4: 운영 빌드는 같은 ALB 아래 `/admin/`에서 서빙된다. 위 describe는 Vitest 기본값인
// BASE_URL('/')에서만 돌아서, 하드코딩된 '/'로 되돌려도 통과한다 — 이 describe가 그 회귀를 잡는다.
describe('admin session-guard under a subpath deployment', () => {
    beforeEach(() => {
        sessionStorage.clear();
        useAuthStore.getState().clearTokens();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...window.location, replace: vi.fn() },
        });
    });

    afterEach(() => {
        sessionStorage.clear();
        useAuthStore.getState().clearTokens();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("sends a rejected session back to this app's own base path, not the site root.", async () => {
        vi.stubEnv('BASE_URL', '/admin/');
        recordSessionUser(1);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ accessToken: makeAccessToken(2) }),
            }),
        );

        await expect(refreshAccessTokenSafely()).resolves.toBeNull();
        expect(window.location.replace).toHaveBeenCalledWith('/admin/');
    });

    it('requests a same-origin refresh URL when VITE_API_URL is unset.', async () => {
        vi.stubEnv('VITE_API_URL', undefined);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ accessToken: makeAccessToken(1) }),
        });
        vi.stubGlobal('fetch', fetchMock);

        await refreshAccessTokenSafely();

        // `?? ''`가 없으면 템플릿 리터럴이 "undefined/auth/token/refresh"를 만든다.
        expect(fetchMock).toHaveBeenCalledWith(
            '/auth/token/refresh',
            expect.objectContaining({ method: 'POST', credentials: 'include' }),
        );
    });
});
