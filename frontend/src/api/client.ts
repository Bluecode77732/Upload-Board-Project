// 목적: 모든 백엔드 호출을 위한 단일 fetch 래퍼 — 액세스 토큰을 붙이고, refresh 쿠키를 함께
//   보내고, ErrorBody 계약을 파싱하며, 만료된 액세스 토큰에 대해 1회 투명하게 리프레시한다.
// 사용처: 기능 모듈은 api.get/post/등을 호출하고, 인증 흐름은 아래 signin/refresh/signout/register를 쓴다.
// 근거: credentials:'include'(httpOnly refresh 쿠키가 함께 실리도록), Bearer 헤더, 401→refresh→재시도
//   흐름을 한곳에 모아두면 모든 호출부가 ADR 0012 토큰 메커니즘을 몰라도 되게 만든다.

import { getAccessToken, setAccessToken } from './authStore'
import type { ErrorBody, ErrorCode } from './errorCodes'
import type { AccessTokenResponse } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

// 2xx가 아닌 모든 응답에서 던져진다; 분기 기준이 되는 백엔드의 고정된 `code`를 담는다.
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
  // 인증 엔드포인트(signin/refresh)는 refresh-재시도 루프를 트리거하면 안 된다.
  skipAuthRefresh?: boolean
}

async function parseError(response: Response): Promise<ErrorBody | undefined> {
  try {
    return (await response.json()) as ErrorBody
  } catch {
    return undefined
  }
}

// 목적: 인증 헤더/크리덴셜을 붙여 fetch를 수행하고, 만료된 액세스 토큰이면 1회 리프레시 후 재시도한다.
// 이유: request()와 postWithStatus() 둘 다 이 401→refresh→재시도 로직이 그대로 필요한데, 응답 바디를
//       어떻게 소비할지(파싱된 값만 vs status까지)는 서로 다르다 — fetch/재시도 부분만 공유해 중복을 없앤다.
// 방법: doFetch → 401이면 tryRefresh 성공 시에만 한 번 더 doFetch. ok 여부 판정과 바디 파싱은 호출자 몫.
async function fetchWithAuthRetry(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, headers = {}, skipAuthRefresh = false } = options

  // multipart일 때는 브라우저가 (boundary와 함께) Content-Type을 직접 설정해야 하므로,
  // 여기서는 헤더도 설정하지 않고 body를 JSON.stringify하지도 않는다.
  const isFormData = body instanceof FormData

  const doFetch = () => {
    const token = getAccessToken()
    return fetch(`${BASE}${path}`, {
      method,
      // 모든 호출에 httpOnly refresh 쿠키를 함께 보낸다(쓰이지 않는 곳에서는 무해하다).
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

  // 만료된 액세스 토큰에 대해 투명하게 1회 리프레시한 뒤, 원래 호출을 재시도한다.
  if (response.status === 401 && !skipAuthRefresh && getAccessToken()) {
    const refreshed = await tryRefresh()
    if (refreshed) response = await doFetch()
  }

  return response
}

// 목적: 인증 헤더/크리덴셜을 붙여 백엔드 REST 호출을 수행하고 성공 응답을 호출자가 기대하는 타입으로 반환한다.
// 이유: 만료된 액세스 토큰의 401→refresh→재시도, 그리고 JSON이 아닌 성공 응답(예: DELETE /file/:id의
//       순수 텍스트 200 "File 3 deleted.")의 파싱까지 호출자마다 각자 처리하면 ADR 0012 토큰 로직과
//       파싱 예외 처리가 흩어진다. 후자는 response.json()이 무조건 호출되어 SyntaxError로 깨지던 실제
//       버그였다(FileDetailPage.handleDelete가 성공한 삭제를 "Network error"로 오인).
// 방법: fetchWithAuthRetry → !ok면 ApiError. 204는 그대로 undefined, Content-Type이 application/json이
//       아니면 파싱하지 않고 undefined를 반환 — 어떤 api.delete 호출부도 반환값을 쓰지 않으므로 안전하다.
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetchWithAuthRetry(path, options)

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response))
  }

  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined as T
  return (await response.json()) as T
}

// 목적: request()와 동일하게 호출하되 HTTP status도 함께 돌려준다.
// 이유: POST /file은 replay(멱등 재청구, ADR 0019)와 신규 승격을 각각 200/201로 구분해 응답하는데,
//       request()는 status를 버려서 UploadForm이 이 둘을 구분할 방법이 없었다. 이 한 호출부만을 위한
//       헬퍼로 두고 api.post<T>()의 범용 시그니처는 그대로 둔다 — 다른 호출부는 status를 쓸 일이 없다.
// 방법: fetchWithAuthRetry로 응답을 받아 request()와 같은 방식으로 파싱한 뒤 { data, status }로 감싼다.
async function requestWithStatus<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; status: number }> {
  const response = await fetchWithAuthRetry(path, options)

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response))
  }

  const contentType = response.headers.get('content-type') ?? ''
  const data =
    response.status === 204 || !contentType.includes('application/json')
      ? (undefined as T)
      : ((await response.json()) as T)
  return { data, status: response.status }
}

// 인증이 필요한 바이너리 fetch(예: private 파일의 GET /file/:id/content) — request()의
// 인증 헤더 + single-flight 401-refresh-재시도를 그대로 따르지만, 콘텐츠 엔드포인트는 성공
// 시 ErrorBody 형태를 반환하지 않으므로 JSON을 파싱하지 않고 Blob을 반환한다.
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

// XMLHttpRequest로 multipart POST를 1회 시도하며 업로드 진행률을 보고한다.
// fetch()는 업로드 진행률 이벤트를 제공하지 않으므로(XHR의 upload.onprogress만 제공한다),
// fetch 래퍼가 아니라 request()와는 별개의 primitive로 둔다.
function xhrPostForm<T>(
  path: string,
  form: FormData,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    xhr.withCredentials = true // httpOnly refresh 쿠키를 보낸다 — fetch의 credentials:'include'와 동일한 동작
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

// 업로드 진행률을 보고하는 multipart POST(예: POST /upload/attach) — fetch는 업로드
// 진행률을 보고할 수 없어 xhrPostForm 위에 만들었으며, request()의 단일 401-refresh-재시도를
// 그대로 따른다.
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

// Single-flight 리프레시: 동시에 여러 401이 발생해도 리프레시 호출은 하나만 공유한다.
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

// --- 인증 흐름 (ADR 0001 Basic signin, ADR 0012 쿠키 로테이션) ---

// POST /auth/signin — Basic 헤더; refresh 토큰은 httpOnly 쿠키로 돌아온다.
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

// POST /auth/register — Basic 헤더(세션은 수립되지 않는다; 호출부가 이어서 signin한다).
export async function register(email: string, password: string): Promise<void> {
  const response = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Basic ${btoa(`${email}:${password}`)}` },
  })
  if (!response.ok) throw new ApiError(response.status, await parseError(response))
}

// POST /auth/token/refresh — httpOnly 쿠키를 읽어 로테이션하고, 새 액세스 토큰을 반환한다.
export async function refreshAccessToken(): Promise<void> {
  const data = await request<AccessTokenResponse>('/auth/token/refresh', {
    method: 'POST',
    skipAuthRefresh: true,
  })
  setAccessToken(data.accessToken)
}

// POST /auth/signout — 서버 앵커 + 쿠키를 지운다; 메모리 상의 토큰도 버린다.
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
  // post()와 같지만 HTTP status도 함께 반환한다 — 위 requestWithStatus 참고(ADR 0019 replay UX).
  postWithStatus: <T>(path: string, body?: unknown) =>
    requestWithStatus<T>(path, { method: 'POST', body }),
  // Multipart POST — FormData를 넘긴다; boundary Content-Type은 브라우저가 설정한다.
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  // 업로드 진행률을 보고하는 multipart POST(XHR 기반 — requestFormWithProgress 참고).
  postFormWithProgress: <T>(
    path: string,
    form: FormData,
    onProgress?: (loaded: number, total: number) => void,
  ) => requestFormWithProgress<T>(path, form, onProgress),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // 인증이 필요한 바이너리 읽기(예: private 파일의 콘텐츠) — 위 requestBlob 참고.
  getBlob: (path: string) => requestBlob(path),
}
