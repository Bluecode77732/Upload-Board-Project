import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";

export const UserId = createParamDecorator(
    (data: unknown, context: ExecutionContext) => {
        const request = context.switchToHttp().getRequest();

        // Identity always comes from the JWT-populated request.user
        // (set by JwtStrategy.validate), never from the request body.
        if (!request.user?.id) {
            throw new UnauthorizedException("No authenticated user.");
        }

        return request.user.id;
    }
)
