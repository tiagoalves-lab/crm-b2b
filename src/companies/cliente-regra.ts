import type { Prisma } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';

// Régua única de "isto é cliente" (fechada com o usuário, 2026-09-18).
//
// Cliente é quem JÁ COMPROU, e só:
//   - pedido emitido no eGestor (histórico de vendas), ou
//   - oportunidade GANHA no pipeline do CRM.
//
// A tag "cliente" NÃO entra na conta: ela só diz que o contato está
// cadastrado como cliente no eGestor, o que o ERP marca mesmo em quem
// nunca comprou (145 cadastros em 2026-09-18). Empresa sem compra é
// prospecção, venha de import de cotação, de conversão de lead ou do
// cadastro do ERP.
//
// A régua vale nos três lugares que mostram a distinção — Carteira de
// clientes, ficha da empresa e busca geral —, porque foi justamente a
// divergência entre eles que fez a mesma conta aparecer como empresa e
// como prospect na mesma tela de busca (CRDC FERRAMENTARIA).
export const TAG_CLIENTE = 'cliente';

// Mesma régua em forma de filtro, pra quem precisa cortar no banco (busca
// geral) em vez de classificar linha a linha (lista da Carteira).
export const CLIENTE_WHERE: Prisma.CompanyWhereInput = {
  OR: [
    { salesHistory: { some: {} } },
    { opportunities: { some: { status: 'won' } } },
  ],
};

// Ids das empresas que já compraram — pedido no eGestor ou oportunidade
// ganha. Duas leituras curtas (só a coluna da empresa, sem agregação),
// separadas do cálculo de LTV de propósito: classificar cliente ×
// prospect não pode depender da permissão de ver faturamento.
export async function empresasQueJaCompraram(
  tx: TenantTx,
  workspaceId: string,
): Promise<Set<string>> {
  const [vendas, ganhas] = await Promise.all([
    tx.salesHistory.findMany({
      where: { workspaceId },
      select: { companyId: true },
      distinct: ['companyId'],
    }),
    tx.opportunity.findMany({
      where: { workspaceId, status: 'won' },
      select: { companyId: true },
      distinct: ['companyId'],
    }),
  ]);
  return new Set([
    ...vendas.map((v) => v.companyId),
    ...ganhas.map((o) => o.companyId),
  ]);
}

// Versão de uma empresa só (ficha).
export async function jaComprou(
  tx: TenantTx,
  workspaceId: string,
  companyId: string,
): Promise<boolean> {
  const [venda, ganha] = await Promise.all([
    tx.salesHistory.findFirst({
      where: { workspaceId, companyId },
      select: { id: true },
    }),
    tx.opportunity.findFirst({
      where: { workspaceId, companyId, status: 'won' },
      select: { id: true },
    }),
  ]);
  return venda !== null || ganha !== null;
}
