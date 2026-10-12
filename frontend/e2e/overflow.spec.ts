// 목적: 폰부터 랩톱까지의 폭에서 긴 이메일·제목·URL이 들어와도 인증된 화면이 가로로 스크롤되지 않는지 검증한다.
// 사용처: `pnpm test:e2e`로 실행된다; API를 스텁(helpers.ts)하므로 계정을 만들지 않고 백엔드도 필요 없다.
// 근거: 공백 없는 긴 URL 댓글이 Post 상세를 가로로 밀어내고(710px), 긴 이메일이 File 상세를 넘치게 하며,
//   320px에서는 맨 위 메뉴의 Sign out이 잘렸다. 641px 이상(가로 폰·태블릿·랩톱)에서는 긴 제목+긴 이메일 행이
//   Post 목록을 1400px 이상으로 늘렸다 — 실제 사용자가 붙여 넣는 값으로 재현했다.

import { test, expect, type Page } from '@playwright/test'
import { stubAuthenticatedApi } from './helpers'

const SCREENS = ['/', '/files', '/settings', '/posts/1', '/view/1']
const LONG_EMAIL = 'very.long.email.address.for.layout.testing@example-company-domain.com'
const LONG_TITLE = 'A fairly long title that a real user might type when naming an upload for a trip 2026'
const LONG_URL = 'https://example.com/a/very/long/path/without/any/spaces/that/a/real/user/might/paste/into/a/comment/field'

// 폰 둘, 641px 바로 위(가로 폰), 태블릿, 랩톱 — 640px를 경계로 목록 행의 규칙이 갈린다.
for (const width of [375, 320, 667, 768, 1366]) {
  test(`no authenticated screen scrolls sideways with long text (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await stubAuthenticatedApi(page)

    const now = new Date().toISOString()
    const creator = { id: 123456, email: LONG_EMAIL }
    const file = {
      id: 1,
      title: LONG_TITLE,
      fileUrl: '/file/1/content',
      visibility: 'unlisted',
      mediaType: 'image',
      creator,
      createdAt: now,
      updatedAt: now,
      shareUrl: 'http://localhost/file/1/content?share=abcdefabcdefabcdefabcdefabcdefabcdefabcdef',
    }
    const post = { id: 1, title: LONG_TITLE, body: `${LONG_URL}\n\nSecond paragraph of the body.`, creator, file, createdAt: now, updatedAt: now }
    const comment = { id: 1, body: LONG_URL, creator, postId: 1, createdAt: now, updatedAt: now }
    await page.route(/\/post(\?.*)?$/, (route) => route.fulfill({ json: [[post], 1] }))
    await page.route(/\/post\/1$/, (route) => route.fulfill({ json: post }))
    await page.route(/\/post\/1\/comment(\?.*)?$/, (route) => route.fulfill({ json: [[comment], 1] }))
    await page.route(/\/file(\?.*)?$/, (route) => route.fulfill({ json: [[file], 1] }))
    await page.route(/\/file\/1$/, (route) => route.fulfill({ json: file }))

    for (const screen of SCREENS) {
      await page.goto(screen)
      await expect(page.locator('main h1')).toBeVisible()
      await page.waitForLoadState('networkidle')

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth, `${screen} at ${width}px scrolls sideways`).toBeLessThanOrEqual(clientWidth)
    }
  })
}

// 목적: 지금 화면이 가로로 스크롤되지 않는지 단언한다.
// 이유: 아래 테스트가 같은 측정을 상태마다 되풀이한다.
// 방법: 문서의 scrollWidth가 clientWidth를 넘지 않는지 본다(위 테스트의 측정과 같다).
async function expectNoSidewaysScroll(page: Page, state: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${state} scrolls sideways`).toBeLessThanOrEqual(clientWidth)
}

// 위 테스트가 열지 않는 상태들이다 — 로그인 화면, 파일을 고른 뒤의 업로드 줄, 작성자에게만 보이는 Post 수정 폼과
// 소유권 양도 폼. 모두 <input>이 들어 있는데, <input>의 고유 폭(size=20)은 글꼴 엔진마다 달라서 Linux에서는
// 폰 폭보다 넓다(Noto Sans KR 16px: Windows 215px, Linux 350px). 그래서 이 테스트는 Windows에서는 고치기
// 전에도 통과한다 — 결함을 잡아내는 곳은 Linux인 CI다.
for (const width of [375, 320]) {
  test(`no form with a text input scrolls sideways (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })

    // 로그인 화면: silent refresh가 실패해야 /login에 머문다.
    await page.route(/\/auth\/token\/refresh$/, (route) =>
      route.fulfill({ status: 401, json: { code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized' } }),
    )
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expectNoSidewaysScroll(page, `/login at ${width}px`)

    // 스텁의 계정(sub: 1)이 스텁의 Post와 File을 만든 사람이다 → 수정 버튼과 양도 폼이 보인다.
    // 나중에 등록한 route가 먼저 적용되므로 refresh는 여기서부터 성공한다.
    await stubAuthenticatedApi(page)

    await page.goto('/files')
    const uploadForm = page.locator('form', { has: page.getByRole('heading', { name: 'Upload a file' }) })
    await uploadForm.getByLabel(/^Files/).setInputFiles({ name: 'a-photo.png', mimeType: 'image/png', buffer: Buffer.from('e2e') })
    await expect(uploadForm.getByLabel('Title', { exact: true })).toBeVisible()
    await expectNoSidewaysScroll(page, `/files with a file chosen at ${width}px`)

    await page.goto('/posts/1')
    // Post의 Edit가 댓글의 Edit보다 문서에서 먼저 나온다.
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await expect(page.getByLabel('Title', { exact: true })).toBeVisible()
    await expectNoSidewaysScroll(page, `/posts/1 edit form at ${width}px`)

    await page.goto('/view/1')
    await expect(page.getByLabel('Recipient email')).toBeVisible()
    await expectNoSidewaysScroll(page, `/view/1 transfer form at ${width}px`)
  })
}
