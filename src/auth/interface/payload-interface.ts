// Minimal JWT payload.
export interface Payload {
  // User ID for lookup.
  sub: number;

  // Distinguishes access/refresh tokens.
  type: 'refresh' | 'access';

  // Refresh tokens only: random unique id so two tokens issued in the same
  // second never share a signature — rotation/reuse detection (ADR 0012)
  // depends on every issued refresh token being distinct.
  jti?: string;

  // JWT library handles automatically the `iat/exp`.
}
