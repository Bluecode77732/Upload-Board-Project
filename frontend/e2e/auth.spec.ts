// 목적: register/sign-in/sign-out 흐름(LoginPage + RequireAuth)에 대한 브라우저 레벨 검증.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 인증은 다른 모든 흐름(upload, board)이 그 뒤에 있는 게이트다 — registerAndSignIn을
//   fixture 헬퍼로만 의존하지 않고 직접 검증하는 유일한 spec이다.

import { test, expect, type Response } from '@playwright/test'
import { registerAndSignIn, uniqueEmail, TEST_PASSWORD } from './helpers'

test('registering a new account signs in and lands on the authenticated home', async ({ page }) => {
  const email = uniqueEmail('auth-register')

  await registerAndSignIn(page, email)

  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('signing out returns to the login screen', async ({ page }) => {
  const email = uniqueEmail('auth-signout')
  await registerAndSignIn(page, email)

  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('registering an already-used email surfaces the AUTH_EMAIL_TAKEN message', async ({ page }) => {
  const email = uniqueEmail('auth-dupe')
  await registerAndSignIn(page, email)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole('button', { name: 'Need an account? Register' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Register & sign in' }).click()

  // LoginPage의 messageForError는 ErrorCode.AUTH_EMAIL_TAKEN을 이 고정 문자열로 매핑한다 —
  // (백엔드의 원본 메시지가 아니라) 이 문자열을 단언하는 것이 code 기반 검증이다.
  await expect(page.getByText('That email is already registered — try signing in.')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('registering with a weak password surfaces the AUTH_WEAK_PASSWORD message', async ({ page }) => {
  // 백엔드는 강도 검사를 이메일 중복 검사보다 먼저 실행하므로(auth.service.ts register), 이 요청은
  // 어떤 계정도 만들지 않는다 — 실제 백엔드에 register 호출 한 번만 나간다(분당 5회 제한 안에서).
  await page.goto('/login')
  await page.getByRole('button', { name: 'Need an account? Register' }).click()
  await page.getByLabel('Email').fill(uniqueEmail('auth-weakpw'))
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Register & sign in' }).click()

  await expect(
    page.getByText('Password must be at least 10 characters and include lowercase, uppercase, a digit, and a symbol.'),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('hitting the rate limit surfaces the RATE_LIMITED message', async ({ page }) => {
  // 실제로 429를 유발하면 같은 IP를 쓰는 다른 spec의 분당 5회 한도(backend ADR 0054)를 소진해
  // flaky해지므로, 백엔드의 ErrorBody 모양 그대로 응답을 스텁한다 — 검증 대상은 code→문구 매핑이다.
  await page.route('**/auth/signin', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'ThrottlerException: Too Many Requests',
        timestamp: new Date().toISOString(),
        path: '/auth/signin',
      }),
    }),
  )

  await page.goto('/login')
  await page.getByLabel('Email').fill(uniqueEmail('auth-ratelimit'))
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByText('Too many attempts. Please wait a minute and try again.')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('signing in with the wrong password surfaces the AUTH_INVALID_CREDENTIALS message', async ({ page }) => {
  const email = uniqueEmail('auth-badpw')
  await registerAndSignIn(page, email)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('WrongPassword!1')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByText('Incorrect email or password.')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('reloading while signed in keeps the session, and each page load refreshes it exactly once', async ({ page }) => {
  await registerAndSignIn(page, uniqueEmail('auth-reload'))

  // dev 모드의 StrictMode가 시작 refresh를 두 번 보내면, 두 번째가 이미 회전된 쿠키를 다시 보내 401
  // AUTH_REFRESH_REUSED가 되고 서버가 세션을 폐기한다 — 두 번째 새로고침에서 로그인 화면이 됐다.
  const statuses: number[] = []
  const onResponse = (res: Response) => {
    if (res.url().endsWith('/auth/token/refresh')) statuses.push(res.status())
  }
  page.on('response', onResponse)

  for (const round of [1, 2, 3]) {
    statuses.length = 0
    await page.reload()
    await expect(page.getByRole('button', { name: 'Sign out' }), `reload ${round}`).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(statuses, `refresh calls on reload ${round}`).toEqual([201])
  }

  page.off('response', onResponse)
})
