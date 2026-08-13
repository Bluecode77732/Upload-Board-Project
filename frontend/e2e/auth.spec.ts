// Purpose: browser-level verification of the register/sign-in/sign-out flow (LoginPage + RequireAuth).
// Usage: run via `pnpm test:e2e`; builds on the shared harness (playwright.config.ts).
// Rationale: auth is the gate every other flow (upload, board) sits behind — this is the one spec
//   that exercises it directly instead of only relying on registerAndSignIn as a fixture helper.

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

  // LoginPage's messageForError maps ErrorCode.AUTH_EMAIL_TAKEN to this fixed string —
  // asserting on it (not the backend's raw message) is the code-based check.
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
