// Purpose: authenticates a bearer token when present without rejecting the request when absent.
// Usage: @UseGuards(OptionalJwtAuthGuard) on GET /file/:id/content — public/unlisted content must
// reach unauthenticated visitors (ADR 0025 D1/D2), but an owner/admin bearer token still resolves
// request.user for the private/owner-bypass branch.
// Rationale: JwtAuthGuard's default handleRequest throws 401 on a missing/invalid token, which
// would gate the whole route; this is the smallest override that keeps token verification while
// dropping the "must be present" requirement.

import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserEntity } from 'backend/user/entity/user.entity';

type AuthenticatedUser = Omit<UserEntity, 'password'>;

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt-auth-guard') {
  // 목적: 토큰이 유효하면 request.user를 채우고, 없거나 무효해도 요청 자체는 통과시킨다.
  // 이유: 기본 handleRequest는 인증 실패 시 401을 던져 라우트 전체를 막는데, 이 엔드포인트는
  //       public/unlisted 익명 접근을 허용해야 한다(D1/D2) — 인증은 선택, 검증은 유지.
  // 방법: 부모의 예외 던지기를 생략하고 user를 그대로(없으면 undefined) 반환한다.
  handleRequest<TUser = AuthenticatedUser>(
    _err: unknown,
    user: TUser | false,
  ): TUser | undefined {
    return user ? user : undefined;
  }
}
