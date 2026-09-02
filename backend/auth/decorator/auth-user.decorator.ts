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

// 목적: JWT로 인증된 요청자의 { id, role }을 핸들러 파라미터로 뽑아준다.
// 이유: ownership-or-admin 판정(RBAC, ADR 0013)은 id뿐 아니라 role도 필요하다 — @UserId만으로는
//       부족한 호출부를 위한 확장.
// 방법: request.user가 있으면 role은 없을 때 UserRole.user로 기본값 채워 반환, 없으면
//       (가드를 안 거친 라우트 등) 401을 던진다.
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
