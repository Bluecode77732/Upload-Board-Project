// Purpose: browser-level verification of the "Posts to home" route reshuffle (App.tsx) — the
//   NavBar and the PostBoard/DashboardPage split between "/" and "/files"/"/posts/:id".
// Usage: run via `pnpm test:e2e`; builds on the shared harness (playwright.config.ts).
// Rationale: this reshuffle depends on the dev proxy (vite.config.ts) NOT swallowing "/files"
//   or "/posts/:id" into the backend — a plain '/file'/'/post' proxy prefix would otherwise
//   404 those routes before the SPA router ever sees them (found live while building this
//   spec's target routes). Regex-anchoring ('^/file($|[/?])', '^/post($|[/?])') fixes it; this
//   spec is the regression guard for that fix specifically, on top of the general nav flow.
//   PostBoard/PostDetailPage write-path coverage (create/edit/delete, comments) lives in
//   posts.spec.ts — this file stays scoped to routing/proxy behavior.

import { test, expect } from '@playwright/test'
import { registerAndSignIn, goToFiles, uniqueEmail } from './helpers'

test('authenticated home is the post board, reachable via the NavBar "Posts" link', async ({ page }) => {
  await registerAndSignIn(page, uniqueEmail('nav-home'))

  await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Posts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'My Files' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('NavBar "My Files" link reaches the file board at /files, not swallowed by the dev proxy', async ({
  page,
}) => {
  await registerAndSignIn(page, uniqueEmail('nav-files'))

  await goToFiles(page)

  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
  // Confirms the SPA rendered (upload form present) rather than a proxied backend 404 body —
  // the exact failure mode a plain '/file' proxy prefix produces for "/files".
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Posts' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible()
})

test('a direct load of /files renders the file board (regex-anchored proxy, not a backend 404)', async ({
  page,
}) => {
  await registerAndSignIn(page, uniqueEmail('nav-files-direct'))

  await page.goto('/files')

  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible()
})

test('a direct load of /posts/:id renders PostDetailPage (regex-anchored proxy, not a backend 404)', async ({
  page,
}) => {
  await registerAndSignIn(page, uniqueEmail('nav-post-detail'))

  // A non-existent id still proves the SPA router (not the backend) handled the route: a
  // proxied-through-to-backend 404 would render as raw JSON, not this app's error message.
  await page.goto('/posts/999999')

  await expect(page.getByText('게시글을 찾을 수 없습니다.')).toBeVisible()
  // exact: true — PostDetailPage's own error-state "Back to posts" link otherwise also
  // matches a plain substring query for "Posts" (frontend/CLAUDE.md E2E gotchas).
  await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'My Files' })).toBeVisible()
})

test('unauthenticated visits to /files and /posts/:id redirect to /login', async ({ page }) => {
  await page.goto('/files')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  await page.goto('/posts/1')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
