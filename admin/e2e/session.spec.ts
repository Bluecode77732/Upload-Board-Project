// 목적: 한 탭 안에서 계정을 전환하는 흐름에 대한 e2e 커버리지 — 예전에는 첫 hard
// navigation에서 멀쩡히 유효한 세션이 로그인 화면으로 튕겨나가던 문제가 있었다.
// 사용처: admin/에서 `pnpm e2e`로 실행한다; backend가 :3000에서 떠 있고 시딩된
// superadmin이 필요하다 (e2e/.env).
// 근거: 단위 테스트(src/auth/session-guard.spec.tsx)는 fetch를 스텁으로 대체하므로,
// 이 결함이 실제로 발생하던 refreshToken 쿠키 + sessionStorage 조합은 e2e 실행에서만
// 검증된다.

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

    // A 계정(superadmin)이 탭을 소유한 채, fixture 사용자가 여기 로그인할 수 있도록 승급시킨다.
    await loginAsSuperadmin(page);
    // A 자신의 hard navigation이 guard로 하여금 A를 이 탭의 소유자로 기록하게 만든다 —
    // 이게 없으면 탭에 아직 소유자가 없어서 아래의 계정 전환이 애초에 오판될 여지가 없다.
    await page.reload();
    await expect(page).toHaveURL('/users');
    await setRole(page, target, 'admin');
    await signOutFromCurrentPage(page);

    try {
        // B 계정이 로그인한 뒤 hard navigation을 한다 — 페이지 새로고침으로 메모리에
        // 있던 access token이 사라지므로 ProtectedRoute가 무음으로 갱신해야 하고, 그
        // 갱신이 형제 탭이 세션을 가로챈 것으로 오판되어서는 안 된다.
        await loginAsAdmin(page, target);
        await page.goto('/users');

        await expect(page).toHaveURL('/users');
        await expect(page.getByTestId('user-search-input')).toBeVisible();
    } finally {
        // 실패하더라도 fixture 계정의 role을 복구한다: PATCH /user/:id/role은 superadmin
        // 전용이라 B는 스스로를 강등시킬 수 없으므로, 그렇지 않으면 실패한 실행이 공유
        // 개발 데이터베이스에 떠도는 admin 계정을 남기게 된다.
        await page.goto('/');
        await loginAsSuperadmin(page);
        await setRole(page, target, 'user');
    }
});
