// 목적: JWT로 채워진 request.user가 있으면 { id, role }을 뽑고, 없어도 예외를 던지지 않는다.
// 사용처: 핸들러 파라미터 @OptionalAuthUser() actor: AuthUser | null — GET /file/:id/content에서,
// 신원은 owner/admin 우회만 허용할 뿐 라우트 전체를 막는 조건이 되면 안 될 때(ADR 0025 D1/D2) 사용.
// 근거: @AuthUser는 미인증 시 401을 던지는데, 이는 다른 모든 파일 라우트에는 맞지만 여기서는
// 틀리다; 이 데코레이터는 request.user를 읽는 방식은 그대로 두고 던지기만 뺀 것이다.

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
