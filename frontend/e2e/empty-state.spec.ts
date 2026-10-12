// 목적: Post·File 목록이 비었을 때의 안내 문구를 검증한다 — 필터를 건 적이 없으면 "아직 없다", 필터가 걸렸으면
//   "조건에 맞는 항목이 없다"여야 한다.
// 사용처: `pnpm test:e2e`로 실행된다; API를 스텁(helpers.ts)하므로 계정을 만들지 않고 백엔드도 필요 없다.
// 근거: 새 계정처럼 항목이 하나도 없는 화면에서 필터를 건 적도 없는데 "No post matches the current filter."가
//   떠서, 존재하지 않는 필터가 있는 것처럼 읽혔다.

import { test, expect } from '@playwright/test'
import { stubAuthenticatedApi } from './helpers'

const SCREENS = [
  { path: '/', noun: 'post', none: 'No post yet.', noneKo: '아직 게시글이 없습니다.', filtered: 'No post matches the current filter.', api: /\/post(\?.*)?$/ },
  { path: '/files', noun: 'file', none: 'No file yet.', noneKo: '아직 파일이 없습니다.', filtered: 'No file matches the current filter.', api: /\/file(\?.*)?$/ },
]

for (const screen of SCREENS) {
  test(`an empty ${screen.noun} list says there is none yet, and only a filter says nothing matches`, async ({ page }) => {
    await stubAuthenticatedApi(page)
    await page.route(screen.api, (route) => route.fulfill({ json: [[], 0] }))
    await page.goto(screen.path)

    // 필터를 건 적이 없다 — "조건에 맞는"이라고 말하면 안 된다.
    await expect(page.getByText(screen.none, { exact: true })).toBeVisible()
    await expect(page.getByText(screen.filtered, { exact: true })).toHaveCount(0)

    // 검색어를 넣으면 이제 필터가 걸린 상태다.
    await page.getByLabel('Search', { exact: true }).fill('nothing')
    await expect(page.getByText(screen.filtered, { exact: true })).toBeVisible()
    await expect(page.getByText(screen.none, { exact: true })).toHaveCount(0)

    // 필터를 지우면 다시 "아직 없다"로 돌아온다.
    await page.getByRole('button', { name: 'Clear filter' }).click()
    await expect(page.getByText(screen.none, { exact: true })).toBeVisible()

    // 한국어도 같은 구분을 한다.
    await page.getByRole('button', { name: 'Switch to Korean' }).click()
    await expect(page.getByText(screen.noneKo, { exact: true })).toBeVisible()
  })
}
