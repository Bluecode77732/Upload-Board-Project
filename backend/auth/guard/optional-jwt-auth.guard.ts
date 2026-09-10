// 목적: 베어러 토큰이 있으면 인증하고, 없어도 요청을 거부하지 않는다.
// 사용처: GET /file/:id/content에 @UseGuards(OptionalJwtAuthGuard)로 적용 — public/unlisted
// 콘텐츠는 미인증 방문자에게도 도달해야 하지만(ADR 0025 D1/D2), owner/admin 베어러 토큰이 있으면
// private/owner-bypass 분기를 위해 request.user는 여전히 채워져야 한다.
// 근거: JwtAuthGuard의 기본 handleRequest는 토큰이 없거나 무효하면 401을 던져 라우트 전체를
// 막는다; 이 가드는 토큰 검증은 유지하면서 "반드시 있어야 한다"는 요구만 뺀 최소 오버라이드다.

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
