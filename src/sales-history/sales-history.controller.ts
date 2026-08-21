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

  // Itens das vendas (produto/serviço) — abas "ABC de Produtos" e
  // "Serviços" da ficha da empresa. Rota separada da de vendas de
  // propósito: a lista de Empresas só precisa do total por venda, e
  // carregar item a item de 1.000 vendas ali seria peso puro.
  @Get('itens')
  findItems(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListSalesHistoryQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.salesHistory.findItems(tx, membership, query.companyId),
    );
  }
}
