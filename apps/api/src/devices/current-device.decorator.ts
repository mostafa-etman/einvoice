import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SigningDevice } from '@prisma/client';

export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SigningDevice => {
    const req = ctx.switchToHttp().getRequest<{ device: SigningDevice }>();
    return req.device;
  },
);
