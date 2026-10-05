// 목적: flow E2E spec들을 위한 공유 테스트 데이터 + UI 기반 register/sign-in 흐름.
// 사용처: auth/upload/board spec들이 임포트한다; 이 테스트들은 절대 truncate되지 않는 공유
//   dev DB를 대상으로 돌아가므로, 모든 spec은 고유한 계정과 제목이 필요하다.
// 근거: register→signIn은 반복되는 다단계 UI 상호작용(LoginPage)이다 — 한곳에 모아두면
//   각 spec이 실제로 검증하려는 동작에만 집중할 수 있다.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

// 실제 유효한 mp4 파일(리포의 backend e2e fixture에서 복사) — 백엔드의 fileFilter는
// 클라이언트가 제공한 mimetype/확장자를 신뢰하지만(upload.controller.ts), 진짜 영상
// 파일을 쓰면 이 spec이 실제 업로드 경로를 더 잘 대표하게 된다.
export const VIDEO_FIXTURE_PATH = path.join(here, 'fixtures', 'sample.mp4')

// 실행 결과는 공유 dev DB에서 절대 truncate되지 않는다(고유 title/email 제약이 실행 간에도
// 유지된다), 그래서 생성되는 모든 값은 타임스탬프와 랜덤 접미사를 함께 가진다.
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

// 목적: 계정 없이 인증된 화면(Post/File/Setting 목록과 두 상세)을 렌더할 수 있게 API를 스텁한다.
// 이유: 레이아웃·언어 토글처럼 UI만 검증하는 spec이 공유 dev DB에 e2e 계정을 늘리거나 분당 5회 제한
//       (backend ADR 0054)을 소진하지 않게 하려는 것이다.
// 방법: silent refresh가 서명 없는 토큰(클라이언트는 sub 클레임만 읽는다, authStore.ts)을 받게 하고,
//       목록·상세·댓글·콘텐츠 요청에 고정 데이터를 돌려준다. 파일은 public이라 콘텐츠 blob fetch를 타지 않는다.
export async function stubAuthenticatedApi(page: Page): Promise<void> {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const accessToken = `${encode({ alg: 'none' })}.${encode({ sub: 1, type: 'access', role: 'user' })}.sig`
  const now = new Date().toISOString()
  const creator = { id: 1, email: 'stub@example.com' }
  const file = {
    id: 1,
    title: 'Stub file',
    fileUrl: '/file/1/content',
    visibility: 'public',
    mediaType: 'image',
    creator,
    createdAt: now,
    updatedAt: now,
  }
  const post = { id: 1, title: 'Stub post', body: 'Stub body.', creator, file, createdAt: now, updatedAt: now }
  const comment = { id: 1, body: 'Stub comment.', creator, postId: 1, createdAt: now, updatedAt: now }

  await page.route(/\/auth\/token\/refresh$/, (route) => route.fulfill({ json: { accessToken } }))
  await page.route(/\/post(\?.*)?$/, (route) => route.fulfill({ json: [[post], 1] }))
  await page.route(/\/post\/1$/, (route) => route.fulfill({ json: post }))
  await page.route(/\/post\/1\/comment(\?.*)?$/, (route) => route.fulfill({ json: [[comment], 1] }))
  await page.route(/\/file(\?.*)?$/, (route) => route.fulfill({ json: [[file], 1] }))
  await page.route(/\/file\/1$/, (route) => route.fulfill({ json: file }))
  await page.route(/\/file\/\d+\/content/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('x') }),
  )
}

// LoginPage의 register-후-signIn 흐름(제출 한 번이 둘 다 처리한다)을 구동하고 인증된
// 홈(PostBoard, "/")으로의 리다이렉트를 기다린다. 페이지별 heading이 아니라 NavBar의
// Sign out 버튼으로 단언한다 — PostBoard 자체 콘텐츠는 여전히 플레이스홀더고(App.tsx),
// Sign out 버튼이 인증된 모든 화면에 공통으로 있는 유일한 요소다.
export async function registerAndSignIn(page: Page, email: string, password = TEST_PASSWORD): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Need an account? Register' }).click()
  await page.getByLabel('Email').fill(email)
  // exact: 비밀번호 표시 버튼의 aria-label("Show password")과 부분 일치하지 않게 한다.
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Register & sign in' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

// 파일 보드(업로드 폼 + FileBoard)는 /files에 있다, 이제 PostBoard가 된 홈 "/"이 아니다 —
// 업로드 폼이나 파일 목록을 대상으로 단언하는 spec에서는 registerAndSignIn 다음에 호출한다.
export async function goToFiles(page: Page): Promise<void> {
  // 내비 링크와 제목 이름이 단수("File")가 되면서 "Upload a file" 같은 다른 제목·파일 제목에도 부분
  // 일치하므로 exact: true가 필수다(frontend/CLAUDE.md E2E gotchas).
  await page.getByRole('link', { name: 'File', exact: true }).click()
  await expect(page).toHaveURL(/\/files$/)
  await expect(page.getByRole('heading', { name: 'File', exact: true })).toBeVisible()
}

// 게시글 보드 홈("/")으로 돌아간다. URL만이 아니라 PostForm 자체의 heading도 기다린다 —
// URL 매칭은 React Router가 history를 바꾸는 순간 바로 발생해, 새 라우트의 DOM(과 그
// "Title"/"Body" 라벨)이 실제로 마운트되기 전이다; URL 단언 직후 바로 필드를 채우면
// 이 전환과 경쟁 상태가 돼 이전 페이지의 아직 남아있는 DOM에 입력될 수 있다.
export async function goToHome(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Post', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'New post' })).toBeVisible()
}
