import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { userId: string } => {
    const request = ctx.switchToHttp().getRequest<{ user: { userId: string } }>();
    return request.user;
  },
);
