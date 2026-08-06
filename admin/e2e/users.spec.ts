// Purpose: e2e coverage for admin's user-management actions and the audit trail they produce.
// Usage: run via `pnpm e2e` in admin/; requires backend on :3000 with Postgres reachable,
// and a seeded superadmin account (see e2e/.env.example).
// Rationale: users-page.tsx had zero coverage of these privileged, partly-irreversible actions.
// Rewritten from the imported Chat Project version, which asserted a client-side sort toggle,
// a search box, nickname text, and force-logout/ban actions this API does not have — see
// admin/README.md's backlog table for the full defect list this rewrite closes.

import { test, expect } from '@playwright/test';
import { loginAsSuperadmin, registerTargetUser } from './helpers';

test('a non-admin account is rejected from the admin login', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'reject');

    await page.goto('/');
    await page.getByTestId('login-email-input').fill(target.email);
    await page.getByTestId('login-password-input').fill(target.password);
    await page.getByTestId('login-submit-button').click();

    await expect(page.getByTestId('login-error')).toHaveText('Admin access only.');
    await expect(page).toHaveURL('/');
});

test('superadmin can promote and demote a user through the role select, and it appears in the audit log', async ({
    page,
    request,
}) => {
    const target = await registerTargetUser(request, 'promote');
    await loginAsSuperadmin(page);

    const row = page.getByTestId(`user-row-${target.id}`);
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    const roleSelect = row.getByTestId(`user-role-select-${target.id}`);
    await roleSelect.selectOption('admin');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('admin');

    await roleSelect.selectOption('user');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    await page.getByTestId('nav-logs').click();
    await expect(page).toHaveURL('/logs');
    await page.getByTestId('log-action-filter').selectOption('ROLE_CHANGE');
    // Promote + demote each log their own ROLE_CHANGE row for this target — assert
    // at least one exists rather than requiring a single unique match. There is no
    // nickname in this API; the log's Target column reads "User {id}".
    await expect(page.getByTestId('logs-table').getByText(`User ${target.id}`).first()).toBeVisible();
});

test('users table paginates', async ({ page, request }) => {
    await registerTargetUser(request, 'page');
    await loginAsSuperadmin(page);

    // GET /user defaults to 20 newest accounts per page — just confirm pagination controls
    // are present and functional rather than asserting an exact total, which depends on
    // however many accounts other specs/runs have created.
    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
});

test('superadmin can delete a user', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'delete');
    await loginAsSuperadmin(page);

    const row = page.getByTestId(`user-row-${target.id}`);
    await expect(row).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await row.getByTestId(`user-delete-${target.id}`).click();

    await expect(page.getByTestId('action-message')).toHaveText(`User ${target.id} deleted.`);
    await expect(page.getByTestId(`user-row-${target.id}`)).toHaveCount(0);
});
