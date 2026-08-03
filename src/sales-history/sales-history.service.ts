import { Injectable } from '@nestjs/common';
import type { SalesHistory } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';

// Histórico de vendas importado de sistema externo (eGestor), separado de
// Opportunity de propósito (ver migration 20260801230000_sales_history):
// alimenta só LTV/última compra/selo Cliente da tela Empresas, não é
// negócio de pipeline.
@Injectable()
export class SalesHistoryService {
  async findAll(tx: TenantTx, companyId?: string): Promise<SalesHistory[]> {
    return tx.salesHistory.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { dtVenda: 'desc' },
    });
  }
}
