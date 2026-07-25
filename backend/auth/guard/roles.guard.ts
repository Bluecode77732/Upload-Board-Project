// Purpose: enforces the @Roles minimum-role requirement using the JWT-populated request.user.role.
// Usage: @UseGuards(JwtAuthGuard, RolesGuard) + @Roles(UserRole.admin); runs after JwtAuthGuard sets request.user.
// Rationale: Stage 0 RBAC (ADR 0013) — rank comparison lets a higher role satisfy a lower requirement; unmarked handlers pass.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorator/roles.decorator';
import { ROLE_RANK, UserRole } from '../role/role';
import { ErrorCode } from 'backend/common/error-code';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get(Roles, context.getHandler());

    // No @Roles on the handler → this guard imposes nothing (JwtAuthGuard still applies).
    if (!required) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: UserRole } }>();
    const role = request.user?.role ?? UserRole.user;

    if (ROLE_RANK[role] < ROLE_RANK[required]) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Insufficient role.',
      });
    }

    return true;
  }
}
