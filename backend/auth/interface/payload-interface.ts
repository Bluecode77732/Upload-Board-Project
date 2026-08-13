import { UserRole } from '../role/role';

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

  // Access tokens only (ADR 0028): lets a client read its own role without an
  // extra request. Advisory only — RolesGuard/AuthUser never read this claim,
  // they come from JwtStrategy.validate's live DB lookup on every request, so
  // a stale claim after a role change can only mislead client-side UI for the
  // remaining access-token TTL, never bypass a server-side check.
  role?: UserRole;

  // JWT library handles automatically the `iat/exp`.
}
