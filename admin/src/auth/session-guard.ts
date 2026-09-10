// 목적: admin 앱에서 무음(silent) 토큰 갱신과 다중 탭 세션 충돌 감지를 담당하는 단일 진입점 —
// frontend/src/auth/AuthProvider.tsx의 무음 갱신과 같은 역할을 한다 (동명의 session-guard.ts가
// 아니라 그 파일이 실제 대응 파일이다).
// 사용처: api/axios.ts(response interceptor)와 components/protected-route.tsx에서 import한다 —
// 그 외 어떤 호출부도 /auth/token/refresh를 직접 호출해서는 안 된다.
// 근거: 기존 axios는 refresh 엔드포인트를 호출할 때 공유 in-flight 가드도, 메인 프론트엔드에
// 있는 탭 간 계정 충돌 검사도 없었다.

import { jwtDecode } from 'jwt-decode';
import { useAuthStore, type UserRole } from '../store/auth.store';

const SESSION_USER_KEY = 'admin:sessionUserId';

export const recordSessionUser = (userId: number) => {
    sessionStorage.setItem(SESSION_USER_KEY, String(userId));
};

export const clearSessionUser = () => {
    sessionStorage.removeItem(SESSION_USER_KEY);
};

// 탭에서 처음 발생하는 토큰 갱신은 그 시점에 공유 refreshToken 쿠키가 속한 계정을 그대로
// 받아들인다. 이후의 갱신은 반드시 그 계정과 일치해야 한다 — 그렇지 않으면 다른 관리자로
// 로그인한 형제 탭이 이 탭을 조용히 가로챌 수 있다.
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
        // refreshToken 쿠키는 credentials: 'include'를 통해 자동으로 전송된다.
        // axios.ts가 refreshAccessTokenSafely()를 호출하는 구조라 순환 참조를 피하기 위해
        // api/axios.ts의 axios 인스턴스 대신 fetch를 직접 사용한다.
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/token/refresh`, {
            method: 'POST',
            credentials: 'include',
        });
        if (!res.ok) throw new Error('Refresh failed');

        const data = await res.json();
        // role은 access token에만 담기는 claim이다 (ADR 0028) — 없다면 이 콘솔이 쓸 수 없는
        // 토큰이라는 뜻이므로 `null`을 저장하지 않고 세션 거부로 처리한다.
        const { sub, role } = jwtDecode<{ sub: number; role?: UserRole }>(data.accessToken);
        if (!role) {
            rejectSession();
            return null;
        }

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

// 동시에 발생하는 호출들(예: axios 401과 Apollo UNAUTHENTICATED 에러가 같은 시점에 발생하는
// 경우)은 각자 refresh 엔드포인트를 따로 호출하지 않고 하나의 in-flight 요청을 공유한다.
export const refreshAccessTokenSafely = (): Promise<string | null> => {
    if (!pendingRefresh) {
        pendingRefresh = doRefresh().finally(() => {
            pendingRefresh = null;
        });
    }
    return pendingRefresh;
};
