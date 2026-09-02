// Purpose: extracts { id, role } from a JWT-populated request.user when present, without throwing when absent.
// Usage: handler param @OptionalAuthUser() actor: AuthUser | null — for GET /file/:id/content, where identity
// only grants an owner/admin bypass and must never gate the whole route (ADR 0025 D1/D2).
// Rationale: @AuthUser throws 401 when unauthenticated, which is correct for every other file route but
// wrong here; this mirrors that decorator's exact reading of request.user, just without the throw.

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth-user.decorator';
import { UserRole } from '../role/role';

// 목적: 인증돼 있으면 { id, role }을, 아니면 예외 없이 null을 돌려준다.
// 이유: GET /file/:id/content는 익명 접근이 허용돼야 하는 라우트라(public/unlisted, ADR
//       0025 D1/D2) @AuthUser의 401-on-missing 동작을 쓸 수 없다 — 신원은 선택적 보너스일 뿐
//       라우트 전체를 막는 조건이면 안 된다.
// 방법: @AuthUser와 동일하게 request.user를 읽되, 없으면 던지지 않고 null만 반환한다.
export const OptionalAuthUser = createParamDecorator(
  (data: unknown, context: ExecutionContext): AuthUser | null => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number; role?: UserRole } }>();

    if (!request.user?.id) return null;

    return { id: request.user.id, role: request.user.role ?? UserRole.user };
  },
);
