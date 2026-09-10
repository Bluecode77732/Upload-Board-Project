import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from 'backend/common/error-code';

// 목적: JWT로 인증된 요청자의 id만 핸들러 파라미터로 뽑아준다.
// 이유: "누가 행동하는가"는 body가 아니라 검증된 토큰에서만 와야 한다(Never Do G3) —
//       매 핸들러가 request.user를 직접 읽고 널 체크를 반복하지 않도록 한 곳에 모은다.
// 방법: request.user.id가 있으면 그대로 반환, 없으면(가드를 안 거친 라우트 등) 401을 던진다.
export const UserId = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number } }>();

    // 신원은 항상 JWT로 채워진 request.user에서만 온다
    // (JwtStrategy.validate가 설정), 요청 본문에서는 절대 오지 않는다.
    if (!request.user?.id) {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_UNAUTHORIZED,
        message: 'No authenticated user.',
      });
    }

    return request.user.id;
  },
);
