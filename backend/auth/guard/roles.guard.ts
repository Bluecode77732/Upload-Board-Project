// 목적: JWT로 채워진 request.user.role을 사용해 @Roles의 최소 역할 요구사항을 강제한다.
// 사용처: @UseGuards(JwtAuthGuard, RolesGuard) + @Roles(UserRole.admin); JwtAuthGuard가 request.user를 채운 뒤 실행.
// 근거: Stage 0 RBAC(ADR 0013) — 랭크 비교로 상위 역할이 하위 요구사항을 만족시키고, @Roles가 없는 핸들러는 통과한다.

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

  // 목적: 핸들러에 붙은 @Roles(최소 role) 요구사항을 요청자의 role과 비교해 통과/거부를 정한다.
  // 이유: 상위 role이 하위 role의 권한을 포함해야 한다(admin은 user 전용 라우트도 통과) —
  //       role별로 별도 가드를 두면 이 포함 관계가 반복 구현되며 어긋날 여지가 생긴다(ADR 0013).
  // 방법: @Roles가 없는 핸들러는 이 가드가 아무것도 강제하지 않고 통과시킨다(JwtAuthGuard만
  //       적용). 있으면 JWT의 role 클레임(없으면 UserRole.user로 취급)과 ROLE_RANK 순위를
  //       비교해, 요구 랭크 미만이면 FORBIDDEN 403을 던진다.
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get(Roles, context.getHandler());

    // 핸들러에 @Roles가 없으면 이 가드는 아무것도 강제하지 않는다(JwtAuthGuard는 여전히 적용됨).
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
