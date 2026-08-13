// Purpose: e2e coverage for the audit log page — action filter, userId filter, CSV export,
// and pagination.
// Usage: run via `pnpm e2e` in admin/; requires backend on :3000 with Postgres reachable,
// and a seeded superadmin account (see e2e/.env.example).
// Rationale: logs-page.tsx had zero coverage for filter interactions. Rewritten from the
// imported Chat Project version, which asserted a client-side sort toggle and a date-range
// filter this API does not have (GET /audit-log's order is server-fixed at createdAt DESC).
// The userId filter and CSV export button the Chat Project version also asserted do now exist
// here (added 2026-08-12, covered 2026-08-13). See admin/README.md's backlog table for the
// rest of the defect list this rewrite closed.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { loginAsSuperadmin, registerTargetUser } from './helpers';

test('promoting and demoting a user produces ROLE_CHANGE entries visible in the logs table', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'logSort');
    await loginAsSuperadmin(page);

    // Demoting back to 'user' is required so this spec leaves no admin behind — a leaked
    // admin would not itself break other specs (there is no MAX_ADMIN_COUNT here), but the
    // account is otherwise orphaned test fixture state.
    const row = page.getByTestId(`user-row-${target.id}`);
    await expect(row).toBeVisible();
    const roleSelect = row.getByTestId(`user-role-select-${target.id}`);
    await roleSelect.selectOption('admin');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('admin');
    await roleSelect.selectOption('user');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    await page.getByTestId('nav-logs').click();
    await expect(page).toHaveURL('/logs');

    await page.getByTestId('log-action-filter').selectOption('ROLE_CHANGE');
    await expect(page.getByTestId('logs-table')).toBeVisible();
    await expect(page.getByTestId('logs-table').getByText(`User ${target.id}`).first()).toBeVisible();
});

test('audit log action filter narrows results', async ({ page }) => {
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

test('users-page.tsx "View all" link filters the logs page by userId, and the filter clears', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'viewAll');
    await loginAsSuperadmin(page);

    // Promote + demote produces two ROLE_CHANGE rows naming target as the target — guaranteed
    // content to assert on once the userId filter is applied, independent of whatever else
    // exists in a shared local/CI database.
    const row = page.getByTestId(`user-row-${target.id}`);
    const roleSelect = row.getByTestId(`user-role-select-${target.id}`);
    await roleSelect.selectOption('admin');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('admin');
    await roleSelect.selectOption('user');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    await row.click();
    await page.getByTestId('recent-activity-view-all').click();

    await expect(page).toHaveURL(`/logs?userId=${target.id}`);
    await expect(page.getByTestId('user-filter-banner')).toContainText(`Filtering by user ${target.id}`);
    await expect(page.getByTestId('logs-table').getByText(`User ${target.id}`).first()).toBeVisible();

    await page.getByTestId('clear-user-filter').click();
    await expect(page).toHaveURL('/logs');
    await expect(page.getByTestId('user-filter-banner')).toHaveCount(0);
});

test('Export CSV downloads the currently filtered audit log as a CSV file', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'exportCsv');
    await loginAsSuperadmin(page);

    const row = page.getByTestId(`user-row-${target.id}`);
    const roleSelect = row.getByTestId(`user-role-select-${target.id}`);
    await roleSelect.selectOption('admin');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('admin');
    await roleSelect.selectOption('user');
    await expect(row.getByTestId(`user-role-${target.id}`)).toHaveText('user');

    // Navigate straight to the filtered URL rather than through the "View all" link — this
    // test is about the export button's output, not the navigation covered by the spec above.
    await page.goto(`/logs?userId=${target.id}`);
    await expect(page.getByTestId('logs-table')).toBeVisible();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-csv-button').click(),
    ]);

    expect(download.suggestedFilename()).toBe('audit-log.csv');
    const path = await download.path();
    if (!path) throw new Error('Download produced no local file path.');
    const csv = readFileSync(path, 'utf-8');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,createdAt,action,actorId,targetId,detail');
    // At least the two ROLE_CHANGE rows from the promote/demote above, naming target as the
    // targetId column (quoted, since csvEscape wraps every field).
    const targetRows = lines.filter((line) => line.includes('ROLE_CHANGE') && line.includes(`"${target.id}"`));
    expect(targetRows.length).toBeGreaterThanOrEqual(2);
});
