// Purpose: e2e coverage for switching accounts inside one tab — the flow whose first hard
// navigation used to bounce a perfectly valid session back to the login screen.
// Usage: run via `pnpm e2e` in admin/; needs backend on :3000 and a seeded superadmin (e2e/.env).
// Rationale: the unit spec (src/auth/session-guard.spec.tsx) stubs fetch, so only an e2e run
// exercises the real refreshToken cookie + sessionStorage pair the defect lived between.

import { test, expect, type Page } from '@playwright/test';
import { loginAsSuperadmin, registerTargetUser, type TargetUser } from './helpers';

async function signOutFromCurrentPage(page: Page): Promise<void> {
    await page.getByTestId('sign-out-button').click();
    await expect(page).toHaveURL('/');
}

async function loginAsAdmin(page: Page, user: TargetUser): Promise<void> {
    await page.goto('/');
    await page.getByTestId('login-email-input').fill(user.email);
    await page.getByTestId('login-password-input').fill(user.password);
    await page.getByTestId('login-submit-button').click();
    await expect(page).toHaveURL('/dashboard');
}

async function setRole(page: Page, target: TargetUser, role: 'user' | 'admin'): Promise<void> {
    const row = page.getByTestId(`user-row-${target.id}`);
    await expect(row).toBeVisible();
    await row.getByTestId(`user-role-select-${target.id}`).selectOption(role);
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText(role);
}

test('a second account signed in after a sign-out survives a hard navigation in the same tab', async ({
    page,
    request,
}) => {
    const target = await registerTargetUser(request, 'switch');

    // Account A (superadmin) owns the tab and promotes the fixture user so it can log in here.
    await loginAsSuperadmin(page);
    // A's own hard navigation is what makes the guard record A as this tab's owner — without
    // it the tab has no owner yet and the account switch below could never be misjudged.
    await page.reload();
    await expect(page).toHaveURL('/users');
    await setRole(page, target, 'admin');
    await signOutFromCurrentPage(page);

    try {
        // Account B signs in, then hard-navigates — the page reload drops the in-memory access
        // token, so ProtectedRoute must silently refresh, and that refresh must not be read as
        // a sibling tab having taken the session over.
        await loginAsAdmin(page, target);
        await page.goto('/users');

        await expect(page).toHaveURL('/users');
        await expect(page.getByTestId('user-search-input')).toBeVisible();
    } finally {
        // Restore the fixture account's role even on failure: PATCH /user/:id/role is
        // superadmin-only, so B cannot demote itself and a failed run would otherwise
        // leave a stray admin account behind in the shared dev database.
        await page.goto('/');
        await loginAsSuperadmin(page);
        await setRole(page, target, 'user');
    }
});
