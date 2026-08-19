import { Controller, Get } from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CountsService } from './counts.service';

// GET /counts — só os números dos badges da barra lateral. Ver
// counts.service.ts pro motivo de existir.
@Controller('counts')
export class CountsController {
  constructor(
    private readonly counts: CountsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  forSidebar(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.counts.forSidebar(tx, membership),
    );
  }
}
