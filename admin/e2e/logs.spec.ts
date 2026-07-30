// Purpose: e2e coverage for the audit log page — time sort and action filter.
// Usage: run via `pnpm e2e` in admin/; requires backend on :3000 with Postgres/Redis
// reachable, and a seeded superadmin account (see e2e/.env.example).
// Rationale: logs-page.tsx had zero coverage for sort and filter interactions.

import { test, expect } from '@playwright/test';
import { loginAsSuperadmin, registerTargetUser } from './helpers';

test('Audit log Time header is always bold and toggling sort re-renders the table', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'logSort');
    await loginAsSuperadmin(page);

    // Promote then demote target to produce ROLE_CHANGE log entries. Demoting back is
    // required so this spec leaves no admin behind — a leaked admin would consume a
    // MAX_ADMIN_COUNT slot and make the promote/demote spec in users.spec.ts fail.
    const row = page.getByTestId(`user-row-${target.id}`);
    await expect(row).toBeVisible();
    await row.getByTestId(`user-promote-${target.id}`).click();
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('admin');
    await row.getByTestId(`user-promote-${target.id}`).click();
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    await page.getByTestId('nav-logs').click();
    await expect(page).toHaveURL('/logs');

    const timeBtn = page.getByRole('columnheader').filter({ hasText: 'Time' }).getByRole('button');

    // Time is the only sortable column — always bold
    await expect(timeBtn).toHaveClass(/font-bold/);

    // Toggle to ASC and back — table must remain visible
    await timeBtn.click();
    await expect(page.getByTestId('logs-table')).toBeVisible();

    await timeBtn.click();
    await expect(page.getByTestId('logs-table')).toBeVisible();
});

test('Audit log action filter narrows results', async ({ page }) => {
    await loginAsSuperadmin(page);
    await page.getByTestId('nav-logs').click();
    await expect(page).toHaveURL('/logs');

    await page.getByTestId('log-action-filter').selectOption('USER_DELETE');
    await expect(page.getByTestId('logs-table')).toBeVisible();
    // Every visible action badge must be USER_DELETE (or no rows)
    const badges = page.getByTestId('logs-table').locator('tbody td span');
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
        await expect(badges.nth(i)).toHaveText('USER_DELETE');
    }
});
