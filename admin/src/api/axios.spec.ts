import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../store/auth.store';

interface FakeRequestConfig {
    headers: Record<string, string>;
    _retry?: boolean;
}

interface FakeAxiosError {
    response?: { status: number };
    config: FakeRequestConfig;
}

const mockAxiosInstance = vi.hoisted(() => {
    const instance = Object.assign(vi.fn(), {
        interceptors: {
            request: { use: vi.fn() },
            response: { use: vi.fn() },
        },
        post: vi.fn(),
    });
    return instance;
});

vi.mock('axios', () => ({
    default: { create: vi.fn(() => mockAxiosInstance) },
}));

vi.mock('../auth/session-guard', () => ({
    refreshAccessTokenSafely: vi.fn(),
}));

import { refreshAccessTokenSafely } from '../auth/session-guard';

await import('./axios');

const requestHandler = mockAxiosInstance.interceptors.request.use.mock.calls[0][0] as (
    config: FakeRequestConfig,
) => FakeRequestConfig;
const responseSuccessHandler = mockAxiosInstance.interceptors.response.use.mock.calls[0][0] as (
    response: unknown,
) => unknown;
const responseErrorHandler = mockAxiosInstance.interceptors.response.use.mock.calls[0][1] as (
    error: FakeAxiosError,
) => Promise<unknown>;

describe('admin axios instance', () => {
    beforeEach(() => {
        mockAxiosInstance.mockReset();
        mockAxiosInstance.post.mockReset();
        (refreshAccessTokenSafely as ReturnType<typeof vi.fn>).mockReset();

        useAuthStore.getState().clearTokens();
    });

    afterEach(() => {
        useAuthStore.getState().clearTokens();
        vi.restoreAllMocks();
    });

    describe('request interceptor', () => {
        it('attaches the bearer token when one is stored and no Authorization header is set.', () => {
            useAuthStore.getState().setTokens('token-abc', 1, 1);

            const config = requestHandler({ headers: {} });

            expect(config.headers.Authorization).toBe('Bearer token-abc');
        });

        it('does not overwrite an existing Authorization header (e.g. Basic login).', () => {
            useAuthStore.getState().setTokens('token-abc', 1, 1);

            const config = requestHandler({ headers: { Authorization: 'Basic xyz' } });

            expect(config.headers.Authorization).toBe('Basic xyz');
        });
    });

    describe('response interceptor', () => {
        it('passes successful responses through unchanged.', () => {
            const response = { data: { ok: true } };

            expect(responseSuccessHandler(response)).toBe(response);
        });

        it('refreshes the token and retries the original request on a 401.', async () => {
            const original: FakeRequestConfig = { headers: {}, _retry: false };
            const error: FakeAxiosError = { response: { status: 401 }, config: original };

            (refreshAccessTokenSafely as ReturnType<typeof vi.fn>).mockResolvedValue('new-token');
            mockAxiosInstance.mockResolvedValue('retried-response');

            const result = await responseErrorHandler(error);

            expect(refreshAccessTokenSafely).toHaveBeenCalled();
            expect(original.headers.Authorization).toBe('Bearer new-token');
            expect(original._retry).toBe(true);
            expect(mockAxiosInstance).toHaveBeenCalledWith(original);
            expect(result).toBe('retried-response');
        });

        it('rejects with the original error and does not retry when the refresh fails.', async () => {
            const original: FakeRequestConfig = { headers: {}, _retry: false };
            const error: FakeAxiosError = { response: { status: 401 }, config: original };

            (refreshAccessTokenSafely as ReturnType<typeof vi.fn>).mockResolvedValue(null);

            await expect(responseErrorHandler(error)).rejects.toBe(error);

            expect(mockAxiosInstance).not.toHaveBeenCalled();
        });

        it('does not retry a request that already failed once.', async () => {
            const original: FakeRequestConfig = { headers: {}, _retry: true };
            const error: FakeAxiosError = { response: { status: 401 }, config: original };

            await expect(responseErrorHandler(error)).rejects.toBe(error);

            expect(refreshAccessTokenSafely).not.toHaveBeenCalled();
        });

        it('passes through non-401 errors untouched.', async () => {
            const original: FakeRequestConfig = { headers: {}, _retry: false };
            const error: FakeAxiosError = { response: { status: 500 }, config: original };

            await expect(responseErrorHandler(error)).rejects.toBe(error);

            expect(refreshAccessTokenSafely).not.toHaveBeenCalled();
        });
    });
});
