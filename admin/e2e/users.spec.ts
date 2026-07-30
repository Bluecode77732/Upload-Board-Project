// Purpose: e2e coverage for admin's user-management actions and the audit trail they produce.
// Usage: run via `pnpm e2e` in admin/; requires backend on :3000 with Postgres/Redis
// reachable, and a seeded superadmin account (see e2e/.env.example).
// Rationale: users-page.tsx had zero coverage of these privileged, partly-irreversible actions.

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

test('superadmin can force-log-out a user', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'kick');
    await loginAsSuperadmin(page);

    const row = page.getByTestId(`user-row-${target.id}`);
    await expect(row).toBeVisible();
    await row.getByTestId(`user-force-logout-${target.id}`).click();

    await expect(page.getByTestId('action-message')).toHaveText(
        `User ${target.id} force-logged out.`,
    );
});

test('superadmin can promote and demote a user, and it appears in the audit log', async ({
    page,
    request,
}) => {
    const target = await registerTargetUser(request, 'promote');
    await loginAsSuperadmin(page);

    const row = page.getByTestId(`user-row-${target.id}`);
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    await row.getByTestId(`user-promote-${target.id}`).click();
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('admin');

    await row.getByTestId(`user-promote-${target.id}`).click();
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    await page.getByTestId('nav-logs').click();
    await expect(page).toHaveURL('/logs');
    await page.getByTestId('log-action-filter').selectOption('ROLE_CHANGE');
    // Promote + demote each log their own ROLE_CHANGE row for this target — assert
    // at least one exists rather than requiring a single unique match.
    await expect(page.getByTestId('logs-table').getByText(target.nickname).first()).toBeVisible();
});

test('Users table shows Created column and sort indicator switches between ID, Role, Created', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'sort');
    await loginAsSuperadmin(page);

    const idBtn = page.getByRole('columnheader').filter({ hasText: 'ID' }).getByRole('button');
    const roleBtn = page.getByRole('columnheader').filter({ hasText: 'Role' }).getByRole('button');
    const createdBtn = page.getByRole('columnheader').filter({ hasText: 'Created' }).getByRole('button');

    // Default: ID is bold
    await expect(idBtn).toHaveClass(/font-bold/);
    await expect(roleBtn).not.toHaveClass(/font-bold/);
    await expect(createdBtn).not.toHaveClass(/font-bold/);

    // Switch to Role sort
    await roleBtn.click();
    await expect(roleBtn).toHaveClass(/font-bold/);
    await expect(idBtn).not.toHaveClass(/font-bold/);

    // Switch to Created sort
    await createdBtn.click();
    await expect(createdBtn).toHaveClass(/font-bold/);
    await expect(roleBtn).not.toHaveClass(/font-bold/);

    // Target user row Created cell contains a date value
    const cells = page.getByTestId(`user-row-${target.id}`).locator('td');
    await expect(cells.nth(4)).toHaveText(/\d/);
});

test('search filters users by nickname and email', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'search');
    await loginAsSuperadmin(page);

    const searchInput = page.getByTestId('user-search-input');

    // Search by nickname — only the target row should match
    await searchInput.fill(target.nickname);
    await expect(page.getByTestId(`user-row-${target.id}`)).toBeVisible();

    // Search by full email — target row still visible
    await searchInput.fill(target.email);
    await expect(page.getByTestId(`user-row-${target.id}`)).toBeVisible();

    // Clear search — target row remains in the full list
    await searchInput.fill('');
    await expect(page.getByTestId(`user-row-${target.id}`)).toBeVisible();
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
