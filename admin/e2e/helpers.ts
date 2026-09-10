// 목적: admin e2e spec들이 공유하는 로그인 및 테스트 fixture 헬퍼.
// 사용처: admin/e2e/*.spec.ts에서만 import한다.
// 근거: superadmin 계정이나 조작 대상이 될 일반 사용자를 만드는 in-app 플로우가 없다 —
// 이 fixture들은 테스트 대상 UI 바깥에서 만들어져야 한다.

import { type APIRequestContext, type Page, expect } from '@playwright/test';

const BACKEND_URL = 'http://localhost:3000';

export async function loginAsSuperadmin(page: Page): Promise<void> {
    const email = process.env.E2E_SUPERADMIN_EMAIL;
    const password = process.env.E2E_SUPERADMIN_PASSWORD;
    if (!email || !password) {
        throw new Error(
            'E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD are not set — copy e2e/.env.example to e2e/.env and fill in a seeded superadmin account.',
        );
    }
    await page.goto('/');
    await page.getByTestId('login-email-input').fill(email);
    await page.getByTestId('login-password-input').fill(password);
    await page.getByTestId('login-submit-button').click();
    // 로그인은 이제 대시보드로 이동한다 (이 헬퍼가 처음 작성된 이후 추가됨) —
    // 기존 호출부는 모두 /users에 도착한다고 가정하므로, 여기서도 그리로 이동해 준다.
    await expect(page).toHaveURL('/dashboard');
    await page.getByTestId('nav-users').click();
    await expect(page).toHaveURL('/users');
}

function uniqueSuffix(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function decodeUserId(accessToken: string): number {
    const payload = accessToken.split('.')[1];
    const json = Buffer.from(payload, 'base64url').toString('utf-8');
    return (JSON.parse(json) as { sub: number }).sub;
}

export interface TargetUser {
    id: number;
    email: string;
    password: string;
}

async function signInViaApi(
    request: APIRequestContext,
    email: string,
    password: string,
): Promise<string> {
    const credential = Buffer.from(`${email}:${password}`).toString('base64');
    const res = await request.post(`${BACKEND_URL}/auth/signin`, {
        headers: { Authorization: `Basic ${credential}` },
    });
    if (!res.ok()) {
        throw new Error(`Sign-in failed for ${email}: ${res.status()} ${await res.text()}`);
    }
    const body = (await res.json()) as { accessToken: string };
    return body.accessToken;
}

// 일반(role: user) 계정을 백엔드 REST API에 직접 등록한다 —
// admin에는 자체 회원가입 UI가 없고, 이건 테스트 대상이 아니라 fixture 준비 과정이다.
// POST /auth/register는 body를 읽지 않으므로(Basic 헤더만 사용, ADR 0002) 보낼 닉네임
// 필드가 없다.
export async function registerTargetUser(
    request: APIRequestContext,
    label: string,
): Promise<TargetUser> {
    const suffix = uniqueSuffix();
    const email = `admin-e2e-${label}-${suffix}@test.local`;
    const password = 'E2ETestPassword123';

    const credential = Buffer.from(`${email}:${password}`).toString('base64');
    const registerRes = await request.post(`${BACKEND_URL}/auth/register`, {
        headers: { Authorization: `Basic ${credential}` },
    });
    if (!registerRes.ok()) {
        throw new Error(
            `Failed to register fixture user ${email}: ${registerRes.status()} ${await registerRes.text()}`,
        );
    }

    const accessToken = await signInViaApi(request, email, password);
    return { id: decodeUserId(accessToken), email, password };
}
