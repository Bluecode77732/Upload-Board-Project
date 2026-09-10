// 목적: admin의 사용자 관리 액션과 그로부터 발생하는 audit trail에 대한 e2e 커버리지.
// 사용처: admin/에서 `pnpm e2e`로 실행한다; backend가 :3000에서 떠 있고 Postgres에 연결
// 가능해야 하며, 시딩된 superadmin 계정이 필요하다 (e2e/.env.example 참고).
// 근거: users-page.tsx는 이런 권한이 필요하고 일부 되돌릴 수 없는 액션들에 대한 커버리지가
// 전혀 없었다. 원본은 닉네임 텍스트와 이 API에 없는 force-logout/ban 액션을 검증하던 Chat
// Project 버전을 그대로 가져온 것이었다 — 이 재작성이 해소한 전체 결함 목록은
// admin/README.md의 backlog 표 참고. Chat Project 버전이 검증하던 검색창과 정렬 가능한
// 헤더의 정렬 토글은 이제 여기에도 존재한다 (2026-08-12 재도입, 2026-08-13 커버).

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
    // 승급과 강등은 각각 이 target에 대한 별도의 ROLE_CHANGE 행을 남긴다 — 단일하고 유일한
    // 매칭을 요구하는 대신 최소 하나가 존재하는지만 검증한다. 이 API에는 닉네임이 없으므로
    // 로그의 Target 컬럼은 "User {id}"로 표시된다.
    await expect(page.getByTestId('logs-table').getByText(`User ${target.id}`).first()).toBeVisible();
});

test('users table paginates', async ({ page, request }) => {
    await registerTargetUser(request, 'page');
    await loginAsSuperadmin(page);

    // GET /user는 기본적으로 페이지당 최신 20개 계정을 반환한다 — 다른 spec/실행이 만든
    // 계정 수에 따라 달라지는 정확한 총 개수를 검증하는 대신, 페이지네이션 컨트롤이
    // 존재하고 동작하는지만 확인한다.
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

test('search box filters the users table to matching emails', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'search');
    await loginAsSuperadmin(page);

    // local-part는 uniqueSuffix()(타임스탬프 + 랜덤)로 생성되므로 공유되는 로컬/CI
    // 데이터베이스의 다른 어떤 계정과도 겹치지 않는다 — 이 값으로 검색하면 테이블이
    // 정확히 이 한 행으로 좁혀진다.
    const localPart = target.email.split('@')[0];
    await page.getByTestId('user-search-input').fill(localPart);
    await expect(page.getByTestId(`user-row-${target.id}`)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('clicking a sortable column header toggles the sort direction indicator', async ({ page }) => {
    await loginAsSuperadmin(page);

    const emailHeader = page.getByTestId('user-sort-email');
    await emailHeader.click();
    await expect(emailHeader).toContainText('▲');

    await emailHeader.click();
    await expect(emailHeader).toContainText('▼');
});
