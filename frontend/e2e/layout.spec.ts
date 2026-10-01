// 목적: 인증된 모든 화면(Post, File, Setting, 두 상세)이 같은 main 박스와 같은 720px 칼럼을 쓰는지
//   검증한다 — src/shared/page.module.css의 공통 규격이 화면별 CSS로 다시 갈라지는 것을 막는다.
// 사용처: `pnpm test:e2e`로 실행된다; 공유 하네스(playwright.config.ts) 위에서 동작한다.
// 근거: 화면마다 `.page`를 따로 둘 때 flex column인 #root 안의 `margin: auto`가 main 폭을 내용물에
//   맞춰 줄여, 화면마다 main·헤더·제목의 폭과 위치가 달랐다(상세 화면 main이 395px/524px였다). API를
//   스텁(helpers.ts)하므로 계정을 만들지 않는다.

import { test, expect, type Page } from '@playwright/test'
import { stubAuthenticatedApi } from './helpers'

const SCREENS = ['/', '/files', '/settings', '/posts/1', '/view/1']

interface Box {
  x: number
  width: number
}

// main과 그 직계 자식들의 가로 위치/폭을 읽는다. 자식의 tag로 "칼럼보다 넓은 구역"(File의 그리드, ul)을 가린다.
async function readShell(page: Page): Promise<{ main: Box; children: Array<Box & { tag: string }> }> {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) throw new Error('no <main> on the screen')
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect()
      return { x: Math.round(rect.x), width: Math.round(rect.width) }
    }
    return {
      main: box(main),
      children: [...main.children].map((child) => ({ tag: child.tagName.toLowerCase(), ...box(child) })),
    }
  })
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 375, height: 800 },
]) {
  test(`every authenticated screen shares one main box and one column (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubAuthenticatedApi(page)

    let firstMain: Box | null = null
    let firstHeader: Box | null = null

    for (const screen of SCREENS) {
      await page.goto(screen)
      await expect(page.locator('main > header').first()).toBeVisible()
      // 상세 화면은 데이터가 와야 본문이 그려진다 — 마지막 요소까지 기다린 뒤 측정한다.
      await expect(page.locator('main h1')).toBeVisible()
      await page.waitForLoadState('networkidle')

      const { main, children } = await readShell(page)
      const header = children[0]
      expect(header?.tag, `${screen}: the nav header comes first`).toBe('header')

      // main은 모든 화면에서 같은 박스이고, 내비 헤더도 모든 화면에서 같은 위치·폭이다.
      firstMain ??= main
      firstHeader ??= { x: header.x, width: header.width }
      expect(main, `${screen}: main box`).toEqual(firstMain)
      expect({ x: header.x, width: header.width }, `${screen}: nav header box`).toEqual(firstHeader)

      for (const child of children) {
        if (child.tag === 'ul') {
          // File의 미리보기 그리드만 칼럼보다 넓다(좁은 화면에서는 칼럼과 같다).
          expect(child.x, `${screen}: grid left edge`).toBeLessThanOrEqual(header.x)
          expect(child.width, `${screen}: grid width`).toBeGreaterThanOrEqual(header.width)
        } else {
          expect(child.x, `${screen}: <${child.tag}> left edge`).toBe(header.x)
          // 인라인 링크("Back to …")는 내용 폭만큼만 차지한다.
          if (child.tag === 'a') expect(child.width).toBeLessThanOrEqual(header.width)
          else expect(child.width, `${screen}: <${child.tag}> width`).toBe(header.width)
        }
      }
    }
  })
}
