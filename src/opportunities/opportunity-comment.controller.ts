import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CreateCommentDto } from './dto/create-comment.dto';
import { OpportunityCommentService } from './opportunity-comment.service';

@Controller('opportunities/:opportunityId/comments')
export class OpportunityCommentController {
  constructor(
    private readonly comments: OpportunityCommentService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.comments.create(tx, membership, opportunityId, dto),
    );
  }

  @Delete(':commentId')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.comments.remove(tx, membership, opportunityId, commentId),
    );
  }
}
