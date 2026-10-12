// 목적: 폰 폭에서 인증된 모든 화면의 누를 수 있는 요소(링크, 버튼, 선택 상자, 입력창, 라디오)가 세로 40px 이상인지
//   검증한다.
// 사용처: `pnpm test:e2e`로 실행된다; API를 스텁(helpers.ts)하므로 계정을 만들지 않고 백엔드도 필요 없다.
// 근거: 폰에서 내비 링크·목록 행 링크·뒤로가기 링크가 23px, 라디오 라벨이 23px, 기본 파일 버튼이 21px, 선택 상자가
//   39px라 손가락으로 누르기 어려웠다. 마우스를 쓰는 넓은 화면은 그대로이므로 폭 375px에서만 확인한다. 선택 상자의
//   39px는 데스크톱 모드에서는 드러나지 않고 모바일(isMobile) 에뮬레이션에서만 나와서, 실제 폰처럼 터치 에뮬레이션으로 잰다.

import { test, expect } from '@playwright/test'
import { stubAuthenticatedApi } from './helpers'

const SCREENS = ['/', '/files', '/settings', '/posts/1', '/view/1']
const MIN_HEIGHT = 40

test.use({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true })

test(`every tappable element is at least ${MIN_HEIGHT}px tall on a phone`, async ({ page }) => {
  await stubAuthenticatedApi(page)

  // 작성자가 본인(sub 1)이라 수정·삭제·관리 버튼까지 화면에 나온다.
  const now = new Date().toISOString()
  const me = { id: 1, email: 'me@example.com' }
  const file = { id: 1, title: 'My video', fileUrl: '/file/1/content', visibility: 'unlisted', mediaType: 'video', creator: me, createdAt: now, updatedAt: now, shareUrl: 'http://localhost/file/1/content?share=abc' }
  const post = { id: 1, title: 'My post', body: 'Body text', creator: me, file, createdAt: now, updatedAt: now }
  const comment = { id: 1, body: 'My comment', creator: me, postId: 1, createdAt: now, updatedAt: now }
  await page.route(/\/post(\?.*)?$/, (route) => route.fulfill({ json: [[post], 1] }))
  await page.route(/\/post\/1$/, (route) => route.fulfill({ json: post }))
  await page.route(/\/post\/1\/comment(\?.*)?$/, (route) => route.fulfill({ json: [[comment], 1] }))
  await page.route(/\/file(\?.*)?$/, (route) => route.fulfill({ json: [[file], 1] }))
  await page.route(/\/file\/1$/, (route) => route.fulfill({ json: file }))

  for (const screen of SCREENS) {
    await page.goto(screen)
    await expect(page.locator('main h1')).toBeVisible()
    await page.waitForLoadState('networkidle')
    // 웹 폰트(글자 조각을 쓸 때 늦게 로드된다)가 오기 전후로 줄 높이가 달라져 선택 상자가 39px와 40px 사이를
    // 오간다 — 글꼴이 준비된 뒤에 잰다.
    await page.evaluate(() => document.fonts.ready)

    const tooSmall = await page.evaluate((min) => {
      const out: string[] = []
      for (const el of document.querySelectorAll('a, button, select, input, textarea')) {
        const input = el as HTMLInputElement
        if (input.type === 'hidden') continue
        // 라디오는 입력 점이 아니라 감싸는 라벨 전체가 누르는 면이다.
        const target = input.type === 'radio' || input.type === 'checkbox' ? (el.closest('label') ?? el) : el
        const rect = target.getBoundingClientRect()
        const style = getComputedStyle(target)
        if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
        const label = (el.textContent || input.value || input.placeholder || '').trim().slice(0, 24)
        if (Math.round(rect.height) < min) {
          out.push(`${el.tagName.toLowerCase()}${input.type ? `:${input.type}` : ''} "${label}" ${Math.round(rect.height)}px`)
        }
        // 선택 상자의 그려진 높이는 브라우저마다 다르다(눈에 보이는 Windows Chrome은 39px, headless는 41px) — 높이만
        // 재면 headless에서는 수정을 되돌려도 통과한다. 그래서 어느 렌더링에서도 40px가 보장되도록 min-height가 선언돼
        // 있는지도 확인한다.
        if (el.tagName === 'SELECT' && !(parseFloat(style.minHeight) >= min)) {
          out.push(`select "${label}" declares no min-height of ${min}px (min-height: ${style.minHeight})`)
        }
      }
      return out
    }, MIN_HEIGHT)

    expect(tooSmall, `${screen}: tappable elements under ${MIN_HEIGHT}px`).toEqual([])
  }
})
