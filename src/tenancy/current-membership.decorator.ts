import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  MembershipContext,
  MembershipRequest,
} from './tenant-membership.guard';

export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): MembershipContext => {
    const request = ctx.switchToHttp().getRequest<MembershipRequest>();
    return request.membership;
  },
);
