// Purpose: shared test data + UI-driven register/sign-in flow for the flow E2E specs.
// Usage: imported by auth/upload/board specs; every spec needs a unique account and titles
//   because these tests run against the shared dev DB, which is never truncated.
// Rationale: register→signIn is one repeated multi-step UI interaction (LoginPage) — centralizing
//   it keeps each spec focused on the behavior it actually verifies.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

// A real, valid mp4 (copied from the repo's backend e2e fixture) — the backend's fileFilter
// trusts the client-supplied mimetype/extension (upload.controller.ts), but using a genuine
// video file keeps this spec representative of the real upload path.
export const VIDEO_FIXTURE_PATH = path.join(here, 'fixtures', 'sample.mp4')

// Runs are never truncated from the shared dev DB (unique title/email constraints persist
// across runs), so every generated value carries both a timestamp and a random suffix.
function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${uniqueSuffix()}@example.com`
}

export function uniqueTitle(prefix: string): string {
  return `E2E ${prefix} ${uniqueSuffix()}`
}

export const TEST_PASSWORD = 'TestPass!234'

// Drives LoginPage's register-then-signIn flow (one submit does both) and waits for the
// redirect to the authenticated home (PostBoard, "/"). Asserts on the NavBar's Sign out
// button rather than a page-specific heading — PostBoard's own content is still a
// placeholder (App.tsx), and the Sign out button is the one thing every authenticated
// screen has in common.
export async function registerAndSignIn(page: Page, email: string, password = TEST_PASSWORD): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Need an account? Register' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Register & sign in' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

// The file board (upload form + FileBoard) lives at /files, not the home "/" (which is now
// PostBoard) — call after registerAndSignIn in any spec whose assertions target the upload
// form or file list.
export async function goToFiles(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'My Files' }).click()
  await expect(page).toHaveURL(/\/files$/)
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
}
