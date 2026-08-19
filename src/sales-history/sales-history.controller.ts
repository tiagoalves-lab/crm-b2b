import { Controller, Get, Query } from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { ListSalesHistoryQueryDto } from './dto/list-sales-history-query.dto';
import { SalesHistoryService } from './sales-history.service';

@Controller('sales-history')
export class SalesHistoryController {
  constructor(
    private readonly salesHistory: SalesHistoryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListSalesHistoryQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.salesHistory.findAll(tx, membership, query.companyId),
    );
  }
}
