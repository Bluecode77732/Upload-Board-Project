// 목적: register/sign-in/sign-out 흐름(LoginPage + RequireAuth)에 대한 브라우저 레벨 검증.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 인증은 다른 모든 흐름(upload, board)이 그 뒤에 있는 게이트다 — registerAndSignIn을
//   fixture 헬퍼로만 의존하지 않고 직접 검증하는 유일한 spec이다.

import { test, expect } from '@playwright/test'
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
