import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './supabase-auth.guard';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
