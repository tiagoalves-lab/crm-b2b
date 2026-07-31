import { Controller, Get, Query } from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@Controller()
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('busca-empresa-lead')
  buscaEmpresaLead(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: SearchQueryDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.search.buscaEmpresaLead(tx, query.q),
    );
  }
}
