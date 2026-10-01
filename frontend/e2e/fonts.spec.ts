// 목적: 제목은 Hahmlet, 본문·버튼·내비는 Noto Sans KR 웹 폰트로 실제 그려지는지 검증한다 — 한글과 영문 모두.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 글꼴은 못 받으면 조용히 시스템 글꼴로 대체돼 눈으로는 구분이 어렵다. computed font-family는 이
//   경우를 못 잡으므로(목록에 이름이 있어도 파일이 없을 수 있다), 브라우저가 실제로 쓴 플랫폼 글꼴을
//   CDP(CSS.getPlatformFontsForNode)로 읽는다. 버튼·입력창에 글꼴이 닿지 않던 문제(브라우저 기본 Arial)도
//   함께 막는다. API는 스텁(helpers.ts)이라 계정을 만들지 않는다.

import { test, expect, type Page } from '@playwright/test'
import { stubAuthenticatedApi } from './helpers'

interface PlatformFont {
  familyName: string
  isCustomFont: boolean
}

// 선택자에 해당하는 첫 요소의 글자를 그린 플랫폼 글꼴 목록을 돌려준다.
async function platformFontsOf(page: Page, selector: string): Promise<PlatformFont[]> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) throw new Error(`no element for "${selector}"`)
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    return fonts
  } finally {
    await cdp.detach()
  }
}

const CASES: Array<{ label: string; selector: string; family: RegExp }> = [
  { label: 'page heading', selector: 'main h1', family: /^Hahmlet/ },
  { label: 'card heading', selector: 'main form h2', family: /^Hahmlet/ },
  { label: 'form label', selector: 'main form label', family: /^Noto Sans KR/ },
  { label: 'submit button', selector: 'main form button[type=submit]', family: /^Noto Sans KR/ },
  { label: 'nav link', selector: 'main nav a', family: /^Noto Sans KR/ },
  { label: 'sign-out button', selector: 'main header button:last-child', family: /^Noto Sans KR/ },
]

for (const language of ['ko', 'en'] as const) {
  test(`headings use Hahmlet and everything else uses Noto Sans KR (${language})`, async ({ page }) => {
    await page.addInitScript((lang) => localStorage.setItem('ui-lang', lang), language)
    await stubAuthenticatedApi(page)
    await page.goto('/')
    await expect(page.locator('main h1')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    for (const { label, selector, family } of CASES) {
      // 글꼴 파일이 내려오기 전의 첫 레이아웃은 대체 글꼴을 쓸 수 있어 폴링한다.
      await expect
        .poll(
          async () => {
            const fonts = await platformFontsOf(page, selector)
            return fonts.length > 0 && fonts.every((f) => f.isCustomFont && family.test(f.familyName))
          },
          { message: `${label} (${selector}) is drawn with a ${family} web font`, timeout: 10_000 },
        )
        .toBe(true)
    }
  })
}
