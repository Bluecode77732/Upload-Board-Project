// Purpose: extracts the authenticated { id, role } from the JWT-populated request.user in one typed accessor.
// Usage: handler param @AuthUser() actor: AuthUser — used where a check needs the actor's role (ownership OR admin).
// Rationale: @UserId returns id only; ownership-vs-admin checks (ADR 0013) also need role, so this extends that pattern.

import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../role/role';
import { ErrorCode } from 'backend/common/error-code';

export interface AuthUser {
  id: number;
  role: UserRole;
}

export const AuthUser = createParamDecorator(
  (data: unknown, context: ExecutionContext): AuthUser => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number; role?: UserRole } }>();

    // Identity comes from the validated JWT (JwtStrategy.validate), never the body.
    if (!request.user?.id) {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_UNAUTHORIZED,
        message: 'No authenticated user.',
      });
    }

    return { id: request.user.id, role: request.user.role ?? UserRole.user };
  },
);
