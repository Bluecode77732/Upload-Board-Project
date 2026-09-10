// 목적: "Posts를 홈으로" 라우트 재편(App.tsx)에 대한 브라우저 레벨 검증 — NavBar와
//   "/"·"/files"·"/posts/:id" 사이의 PostBoard/DashboardPage 분리.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 이 재편은 dev 프록시(vite.config.ts)가 "/files"나 "/posts/:id"를 백엔드로 삼켜버리지
//   않는다는 데 의존한다 — 단순한 '/file'/'/post' 프록시 접두사였다면 SPA 라우터가 보기도
//   전에 이 라우트들이 404가 됐을 것이다(이 spec의 대상 라우트를 만들다가 실제로 발견했다).
//   정규식 앵커링('^/file($|[/?])', '^/post($|[/?])')이 이를 고쳤고, 이 spec은 일반적인 nav
//   흐름 위에 그 수정에 대한 회귀 가드 역할을 특히 맡는다. PostBoard/PostDetailPage의 쓰기
//   경로 커버리지(생성/수정/삭제, 댓글)는 posts.spec.ts에 있다 — 이 파일은 라우팅/프록시
//   동작으로 범위를 한정한다.

import { test, expect } from '@playwright/test'
import { registerAndSignIn, goToFiles, uniqueEmail } from './helpers'

test('authenticated home is the post board, reachable via the NavBar "Posts" link', async ({ page }) => {
  await registerAndSignIn(page, uniqueEmail('nav-home'))

  await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Posts' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Files', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('NavBar "Files" link reaches the file board at /files, not swallowed by the dev proxy', async ({
  page,
}) => {
  await registerAndSignIn(page, uniqueEmail('nav-files'))

  await goToFiles(page)

  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()
  // 프록시된 백엔드 404 본문이 아니라 SPA가 실제로 렌더링됐음(업로드 폼 존재)을 확인한다 —
  // 단순한 '/file' 프록시 접두사가 "/files"에 대해 정확히 이런 실패 방식을 만들어낸다.
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

  // 존재하지 않는 id라도 라우트를 처리한 게 (백엔드가 아니라) SPA 라우터임을 여전히 증명한다:
  // 백엔드까지 프록시되어 나온 404였다면 이 앱의 에러 메시지가 아니라 raw JSON으로 렌더링됐을 것이다.
  await page.goto('/posts/999999')

  await expect(page.getByText('Post not found.')).toBeVisible()
  // exact: true — 이게 없으면 PostDetailPage 자체의 에러 상태 "Back to posts" 링크도
  // "Posts"에 대한 단순 부분 문자열 쿼리에 걸린다(frontend/CLAUDE.md E2E gotchas).
  await expect(page.getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Files', exact: true })).toBeVisible()
})

test('unauthenticated visits to /files and /posts/:id redirect to /login', async ({ page }) => {
  await page.goto('/files')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  await page.goto('/posts/1')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
