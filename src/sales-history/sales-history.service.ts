import { ForbiddenException, Injectable } from '@nestjs/common';
import type { SalesHistory } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// Histórico de vendas importado de sistema externo (eGestor), separado de
// Opportunity de propósito (ver migration 20260801230000_sales_history):
// alimenta LTV/última compra/selo Cliente tanto na lista de Empresas
// quanto na aba "Pós-venda" da ficha — mesmo endpoint pros dois usos, não
// é negócio de pipeline.
@Injectable()
export class SalesHistoryService {
  constructor(private readonly policy: PolicyService) {}

  // Gatilho único (com ou sem companyId) — 2026-08-12: aba Pós-venda é
  // só leitura, sem criar/editar/excluir próprio no app (é espelho do
  // eGestor), então empresas_posvenda só tem 'ver'.
  findAll(
    tx: TenantTx,
    membership: MembershipContext,
    companyId?: string,
  ): Promise<SalesHistory[]> {
    if (!this.policy.canModule(membership, 'empresas_posvenda', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver pós-venda.');
    }
    return tx.salesHistory.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { dtVenda: 'desc' },
    });
  }
}
