// Purpose: holds the access token in module memory (never localStorage) and notifies subscribers on change.
// Usage: the API client reads/sets the token here; AuthContext subscribes to reflect auth state in the UI.
// Rationale: ADR 0012 keeps the refresh token in an httpOnly cookie the JS can't read; the access token is
//   deliberately memory-only so an XSS payload can't exfiltrate a persistable credential. A page reload
//   drops it and the app silently re-refreshes from the cookie.

let accessToken: string | null = null
let currentUserId: number | null = null
const listeners = new Set<(token: string | null) => void>()

// 목적: access token의 sub(userId) 클레임을 읽어 canManage(본인 판단)에 쓸 수 있게 한다.
// 이유: 서버가 서명 발급한 페이로드를 읽는 것이므로 소유권을 클라이언트가 추정하는 것이 아니다 —
//   프론트는 이 값을 실제 권한 판단(서버의 403)의 참고용 UI 힌트로만 쓴다.
// 방법: JWT 세 세그먼트 중 payload(가운데)만 base64url 디코드해 JSON.parse, sub가 number면 반환.
function decodeUserId(token: string): number | null {
  const segment = token.split('.')[1]
  if (!segment) return null
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const payload: unknown = JSON.parse(atob(padded))
    if (typeof payload === 'object' && payload !== null && typeof (payload as { sub?: unknown }).sub === 'number') {
      return (payload as { sub: number }).sub
    }
  } catch {
    return null
  }
  return null
}

export function getAccessToken(): string | null {
  return accessToken
}

// The `sub` claim of the current access token, or null when signed out / unparsable.
export function getCurrentUserId(): number | null {
  return currentUserId
}

export function setAccessToken(token: string | null): void {
  accessToken = token
  currentUserId = token ? decodeUserId(token) : null
  for (const listener of listeners) listener(token)
}

export function subscribe(listener: (token: string | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
