// 목적: JWT로 채워진 request.user에서 인증된 { id, role }을 타입 있는 접근자 하나로 뽑아낸다.
// 사용처: 핸들러 파라미터 @AuthUser() actor: AuthUser — actor의 role이 필요한 검사(ownership OR admin)에서 사용.
// 근거: @UserId는 id만 반환한다; ownership-vs-admin 판정(ADR 0013)은 role도 필요해서 이 패턴을 확장한 것이다.

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

    // 신원은 검증된 JWT(JwtStrategy.validate)에서만 온다 — body에서는 절대 가져오지 않는다.
    if (!request.user?.id) {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_UNAUTHORIZED,
        message: 'No authenticated user.',
      });
    }

    return { id: request.user.id, role: request.user.role ?? UserRole.user };
  },
);
