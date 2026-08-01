// Purpose: extracts { id, role } from a JWT-populated request.user when present, without throwing when absent.
// Usage: handler param @OptionalAuthUser() actor: AuthUser | null — for GET /file/:id/content, where identity
// only grants an owner/admin bypass and must never gate the whole route (ADR 0025 D1/D2).
// Rationale: @AuthUser throws 401 when unauthenticated, which is correct for every other file route but
// wrong here; this mirrors that decorator's exact reading of request.user, just without the throw.

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth-user.decorator';
import { UserRole } from '../role/role';

export const OptionalAuthUser = createParamDecorator(
  (data: unknown, context: ExecutionContext): AuthUser | null => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number; role?: UserRole } }>();

    if (!request.user?.id) return null;

    return { id: request.user.id, role: request.user.role ?? UserRole.user };
  },
);
