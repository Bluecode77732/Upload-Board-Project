// 목적: audit log 페이지 — action 필터, userId 필터, CSV 내보내기, 페이지네이션 — 에
// 대한 e2e 커버리지.
// 사용처: admin/에서 `pnpm e2e`로 실행한다; backend가 :3000에서 떠 있고 Postgres에 연결
// 가능해야 하며, 시딩된 superadmin 계정이 필요하다 (e2e/.env.example 참고).
// 근거: logs-page.tsx는 필터 상호작용에 대한 커버리지가 전혀 없었다. 원본은 클라이언트
// 측 정렬 토글과 이 API에 없는 날짜 범위 필터(GET /audit-log의 정렬 순서는 createdAt
// DESC로 서버에 고정되어 있다)를 검증하던 Chat Project 버전을 그대로 가져온 것이었다.
// Chat Project 버전이 검증하던 userId 필터와 CSV 내보내기 버튼은 이제 여기에도 존재한다
// (2026-08-12 추가, 2026-08-13 커버). 이 재작성이 해소한 나머지 결함 목록은
// admin/README.md의 backlog 표 참고.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { loginAsSuperadmin, registerTargetUser } from './helpers';

test('promoting and demoting a user produces ROLE_CHANGE entries visible in the logs table', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'logSort');
    await loginAsSuperadmin(page);

    // 'user'로 다시 강등해야 이 spec이 admin 계정을 남기지 않는다 — 유출된 admin 자체가
    // 다른 spec을 깨뜨리진 않지만(여기엔 MAX_ADMIN_COUNT가 없다), 그렇지 않으면
    // 고아가 된 테스트 fixture 상태로 남는다.
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
    // 화면에 보이는 모든 action 배지는 USER_DELETE여야 한다 (또는 행이 아예 없어야 한다)
    const badges = page.getByTestId('logs-table').locator('tbody td span');
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
        await expect(badges.nth(i)).toHaveText('USER_DELETE');
    }
});

test('users-page.tsx "View all" link filters the logs page by userId, and the filter clears', async ({ page, request }) => {
    const target = await registerTargetUser(request, 'viewAll');
    await loginAsSuperadmin(page);

    // 승급 + 강등은 target을 대상으로 하는 ROLE_CHANGE 행을 두 개 만든다 — userId 필터를
    // 적용하면, 공유되는 로컬/CI 데이터베이스에 그 밖에 무엇이 있든 상관없이 검증할 수
    // 있는 확실한 데이터가 된다.
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

    // "View all" 링크를 거치지 않고 필터가 적용된 URL로 바로 이동한다 — 이 테스트는
    // 위 spec이 다루는 내비게이션이 아니라 export 버튼의 출력을 검증하는 것이다.
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
    // `targetType`은 백엔드가 다형적인 `targetId`를 구분하는 값을 보내기 시작하면서
    // 내보내기에 추가됐다 (backend ADR 0045) — 단순 id 컬럼만으로는 그것이 user인지
    // file, post, comment인지 알 수 없었다.
    expect(lines[0]).toBe('id,createdAt,action,actorId,targetType,targetId,detail');
    // 위의 승급/강등에서 나온 ROLE_CHANGE 행이 최소 두 개는 있어야 하며, target을
    // targetId 컬럼으로 담고 있다 (csvEscape가 모든 필드를 감싸므로 따옴표로 묶여 있다).
    const targetRows = lines.filter((line) => line.includes('ROLE_CHANGE') && line.includes(`"${target.id}"`));
    expect(targetRows.length).toBeGreaterThanOrEqual(2);
});
