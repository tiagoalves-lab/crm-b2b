import { ForbiddenException, Injectable } from '@nestjs/common';
import type { SalesHistory, SalesHistoryItem } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// Histórico de vendas importado de sistema externo (eGestor), separado de
// Opportunity de propósito (ver migration 20260801230000_sales_history):
// alimenta LTV/última compra/selo Cliente tanto na lista de Empresas
// quanto nas abas Vendas / ABC de Produtos / Serviços da ficha — não é
// negócio de pipeline.
@Injectable()
export class SalesHistoryService {
  constructor(private readonly policy: PolicyService) {}

  // Duas permissões servem esta leitura, e basta uma:
  //  - `empresas_vendas` — as abas de venda em si (2026-08-21);
  //  - `empresas_posvenda` — quem já lia isto antes de aquele módulo
  //    existir, incluindo o LTV/última compra da lista de Empresas e da
  //    Visão geral.
  // Manter as duas evita que a aba nova mude, de lado, o que as telas
  // antigas mostram — e quando a diretriz de acesso do representante for
  // fechada, desligar Pós-venda pra ele já o deixa sem nenhuma das duas.
  findAll(
    tx: TenantTx,
    membership: MembershipContext,
    companyId?: string,
  ): Promise<SalesHistory[]> {
    if (
      !this.policy.canModule(membership, 'empresas_vendas', 'ver') &&
      !this.policy.canModule(membership, 'empresas_posvenda', 'ver')
    ) {
      throw new ForbiddenException(
        'Sem permissão para ver o histórico de vendas.',
      );
    }
    return tx.salesHistory.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { dtVenda: 'desc' },
    });
  }

  // Itens (o que foi vendido) — base das abas "ABC de Produtos" e
  // "Serviços". Exige `empresas_vendas` sozinho: é dado mais granular que
  // o total da venda, e nasceu junto com o módulo.
  findItems(
    tx: TenantTx,
    membership: MembershipContext,
    companyId?: string,
  ): Promise<SalesHistoryItem[]> {
    if (!this.policy.canModule(membership, 'empresas_vendas', 'ver')) {
      throw new ForbiddenException(
        'Sem permissão para ver o detalhe de produtos e serviços vendidos.',
      );
    }
    return tx.salesHistoryItem.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { valorTotal: 'desc' },
    });
  }
}
