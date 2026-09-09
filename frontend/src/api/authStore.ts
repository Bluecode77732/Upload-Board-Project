// 목적: 액세스 토큰을 모듈 메모리에만 보관하고(localStorage에는 절대 저장하지 않음) 변경 시 구독자에게 알린다.
// 사용처: API 클라이언트가 여기서 토큰을 읽고/설정한다; AuthContext는 UI의 인증 상태를 반영하려고 구독한다.
// 근거: ADR 0012는 refresh 토큰을 JS가 읽을 수 없는 httpOnly 쿠키에 둔다; 액세스 토큰을 의도적으로
//   메모리에만 두는 이유는 XSS 페이로드가 영속 가능한 크리덴셜을 빼돌리지 못하게 하기 위해서다.
//   페이지를 새로고침하면 토큰은 사라지고, 앱은 쿠키를 이용해 조용히 다시 리프레시한다.

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

// 현재 액세스 토큰의 `sub` 클레임, 로그아웃 상태이거나 파싱할 수 없으면 null.
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
