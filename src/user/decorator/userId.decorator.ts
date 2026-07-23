import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from 'src/common/error-code';

export const UserId = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number } }>();

    // Identity always comes from the JWT-populated request.user
    // (set by JwtStrategy.validate), never from the request body.
    if (!request.user?.id) {
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_UNAUTHORIZED,
        message: 'No authenticated user.',
      });
    }

    return request.user.id;
  },
);
