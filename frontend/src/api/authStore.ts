// Purpose: holds the access token in module memory (never localStorage) and notifies subscribers on change.
// Usage: the API client reads/sets the token here; AuthContext subscribes to reflect auth state in the UI.
// Rationale: ADR 0012 keeps the refresh token in an httpOnly cookie the JS can't read; the access token is
//   deliberately memory-only so an XSS payload can't exfiltrate a persistable credential. A page reload
//   drops it and the app silently re-refreshes from the cookie.

let accessToken: string | null = null
const listeners = new Set<(token: string | null) => void>()

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
  for (const listener of listeners) listener(token)
}

export function subscribe(listener: (token: string | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
