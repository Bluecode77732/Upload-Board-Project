// Purpose: shared login and test-fixture helpers for admin e2e specs.
// Usage: imported by admin/e2e/*.spec.ts only.
// Rationale: no in-app flow creates a superadmin account or a target regular user
// to act on — these fixtures must come from outside the UI under test.

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
    // Login now lands on the dashboard (added after this helper was first written) —
    // every existing caller assumes it ends up on /users, so navigate there too.
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

// Registers a plain (role: user) account directly against the backend REST API —
// admin has no registration UI of its own, and this is fixture setup, not the
// thing under test. POST /auth/register reads no body (Basic header only, ADR 0002) —
// there is no nickname field to send.
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
