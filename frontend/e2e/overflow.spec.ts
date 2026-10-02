// 목적: 폰부터 랩톱까지의 폭에서 긴 이메일·제목·URL이 들어와도 인증된 화면이 가로로 스크롤되지 않는지 검증한다.
// 사용처: `pnpm test:e2e`로 실행된다; API를 스텁(helpers.ts)하므로 계정을 만들지 않고 백엔드도 필요 없다.
// 근거: 공백 없는 긴 URL 댓글이 Post 상세를 가로로 밀어내고(710px), 긴 이메일이 File 상세를 넘치게 하며,
//   320px에서는 맨 위 메뉴의 Sign out이 잘렸다. 641px 이상(가로 폰·태블릿·랩톱)에서는 긴 제목+긴 이메일 행이
//   Post 목록을 1400px 이상으로 늘렸다 — 실제 사용자가 붙여 넣는 값으로 재현했다.

import { test, expect } from '@playwright/test'
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
