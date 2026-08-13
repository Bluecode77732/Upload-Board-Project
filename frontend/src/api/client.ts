// Purpose: the single fetch wrapper for all backend calls — attaches the access token, sends the refresh
//   cookie, parses the ErrorBody contract, and transparently refreshes once on an expired access token.
// Usage: feature modules call api.get/post/etc.; auth flows use signin/refresh/signout/register below.
// Rationale: centralizing credentials:'include' (so the httpOnly refresh cookie rides along), the Bearer
//   header, and the 401→refresh→retry dance keeps every caller ignorant of the ADR 0012 token mechanics.

import { getAccessToken, setAccessToken } from './authStore'
import type { ErrorBody, ErrorCode } from './errorCodes'
import type { AccessTokenResponse } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

// Thrown for every non-2xx response; carries the backend's stable `code` to branch on.
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode | undefined
  readonly body: ErrorBody | undefined
  constructor(status: number, body: ErrorBody | undefined) {
    super(
      body
        ? Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message
        : `Request failed (${status})`,
    )
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code
    this.body = body
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  // Auth endpoints (signin/refresh) must not trigger the refresh-retry loop.
  skipAuthRefresh?: boolean
}

async function parseError(response: Response): Promise<ErrorBody | undefined> {
  try {
    return (await response.json()) as ErrorBody
  } catch {
    return undefined
  }
}

// 목적: 인증 헤더/크리덴셜을 붙여 백엔드 REST 호출을 수행하고 성공 응답을 호출자가 기대하는 타입으로 반환한다.
// 이유: 만료된 액세스 토큰의 401→refresh→재시도, 그리고 JSON이 아닌 성공 응답(예: DELETE /file/:id의
//       순수 텍스트 200 "File 3 deleted.")의 파싱까지 호출자마다 각자 처리하면 ADR 0012 토큰 로직과
//       파싱 예외 처리가 흩어진다. 후자는 response.json()이 무조건 호출되어 SyntaxError로 깨지던 실제
//       버그였다(FileDetailPage.handleDelete가 성공한 삭제를 "Network error"로 오인).
// 방법: fetch → 401이면 1회 리프레시 후 재시도 → !ok면 ApiError. 204는 그대로 undefined, Content-Type이
//       application/json이 아니면 파싱하지 않고 undefined를 반환 — 어떤 api.delete 호출부도 반환값을
//       쓰지 않으므로 안전하다.
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, skipAuthRefresh = false } = options

  // For multipart the browser must set Content-Type itself (with the boundary),
  // so we neither set the header nor JSON-stringify the body.
  const isFormData = body instanceof FormData

  const doFetch = () => {
    const token = getAccessToken()
    return fetch(`${BASE}${path}`, {
      method,
      // Send the httpOnly refresh cookie on every call (harmless where unused).
      credentials: 'include',
      headers: {
        ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
    })
  }

  let response = await doFetch()

  // One transparent refresh on an expired access token, then retry the original call.
  if (response.status === 401 && !skipAuthRefresh && getAccessToken()) {
    const refreshed = await tryRefresh()
    if (refreshed) response = await doFetch()
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response))
  }

  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined as T
  return (await response.json()) as T
}

// Authenticated binary fetch (e.g. GET /file/:id/content for a private file) — mirrors
// request()'s auth header + single-flight 401-refresh-retry, but returns a Blob instead
// of parsing JSON, since content endpoints don't return the ErrorBody shape on success.
async function requestBlob(path: string): Promise<Blob> {
  const doFetch = () => {
    const token = getAccessToken()
    return fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  }

  let response = await doFetch()

  if (response.status === 401 && getAccessToken()) {
    const refreshed = await tryRefresh()
    if (refreshed) response = await doFetch()
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response))
  }

  return response.blob()
}

// One attempt at a multipart POST via XMLHttpRequest, reporting upload progress.
// fetch() exposes no upload-progress event (only XHR's upload.onprogress does),
// so this is a separate primitive from request() rather than a fetch wrapper.
function xhrPostForm<T>(
  path: string,
  form: FormData,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    xhr.withCredentials = true // send the httpOnly refresh cookie, mirroring fetch's credentials:'include'
    const token = getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total)
      }
    }
    xhr.onload = () => {
      let body: unknown
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined
      } catch {
        body = undefined
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T)
      } else {
        reject(new ApiError(xhr.status, body as ErrorBody | undefined))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, undefined))
    xhr.send(form)
  })
}

// Multipart POST with upload-progress reporting (e.g. POST /upload/attach) — mirrors
// request()'s single 401-refresh-retry, built on xhrPostForm since fetch cannot report
// upload progress.
async function requestFormWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  try {
    return await xhrPostForm<T>(path, form, onProgress)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && getAccessToken()) {
      const refreshed = await tryRefresh()
      if (refreshed) return await xhrPostForm<T>(path, form, onProgress)
    }
    throw err
  }
}

// Single-flight refresh: concurrent 401s share one refresh call.
let refreshInFlight: Promise<boolean> | null = null

export function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken()
      .then(() => true)
      .catch(() => {
        setAccessToken(null)
        return false
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

// --- Auth flows (ADR 0001 Basic signin, ADR 0012 cookie rotation) ---

// POST /auth/signin — Basic header; refresh token comes back as an httpOnly cookie.
export async function signin(email: string, password: string): Promise<void> {
  const response = await fetch(`${BASE}/auth/signin`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Basic ${btoa(`${email}:${password}`)}` },
  })
  if (!response.ok) throw new ApiError(response.status, await parseError(response))
  const data = (await response.json()) as AccessTokenResponse
  setAccessToken(data.accessToken)
}

// POST /auth/register — Basic header (no session established; caller then signs in).
export async function register(email: string, password: string): Promise<void> {
  const response = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Basic ${btoa(`${email}:${password}`)}` },
  })
  if (!response.ok) throw new ApiError(response.status, await parseError(response))
}

// POST /auth/token/refresh — reads the httpOnly cookie, rotates it, returns a new access token.
export async function refreshAccessToken(): Promise<void> {
  const data = await request<AccessTokenResponse>('/auth/token/refresh', {
    method: 'POST',
    skipAuthRefresh: true,
  })
  setAccessToken(data.accessToken)
}

// POST /auth/signout — clears the server anchor + cookie; drop the in-memory token.
export async function signout(): Promise<void> {
  try {
    await request<{ success: boolean }>('/auth/signout', { method: 'POST' })
  } finally {
    setAccessToken(null)
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  // Multipart POST — pass a FormData; the browser sets the boundary Content-Type.
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  // Multipart POST with upload-progress reporting (XHR-based — see requestFormWithProgress).
  postFormWithProgress: <T>(
    path: string,
    form: FormData,
    onProgress?: (loaded: number, total: number) => void,
  ) => requestFormWithProgress<T>(path, form, onProgress),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // Authenticated binary read (e.g. a private file's content) — see requestBlob above.
  getBlob: (path: string) => requestBlob(path),
}
