import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { RawLeadService } from './raw-lead.service';

@Controller('raw-leads')
export class RawLeadController {
  constructor(
    private readonly rawLeads: RawLeadService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post(':id/approve')
  approve(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.rawLeads.approve(tx, membership, id),
    );
  }
}
