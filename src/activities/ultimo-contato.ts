import type { TenantTx } from '../tenancy/tenant-context.service';

// Coluna "Último contato" das listas de Prospecção e Empresas (pedido do
// usuário, 2026-09-16): data da interação mais recente registrada na
// Timeline da empresa. Só note/call/email — os tipos que uma pessoa grava
// à mão (mesmo recorte de apenasInteracoes no frontend); field_update e
// stage_change são auditoria automática e marcariam "contato" em toda
// edição de cadastro.
//
// Quem chama já recortou as empresas visíveis pro usuário — aqui só se
// agrega em cima dessa lista, um group by só.
export async function ultimoContatoPorEmpresa(
  tx: TenantTx,
  workspaceId: string,
  companyIds: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (companyIds.length === 0) return mapa;
  const grupos = await tx.activity.groupBy({
    by: ['companyId'],
    where: {
      workspaceId,
      companyId: { in: companyIds },
      type: { in: ['note', 'call', 'email'] },
    },
    _max: { occurredAt: true },
  });
  for (const g of grupos) {
    if (g.companyId && g._max.occurredAt) {
      mapa.set(g.companyId, g._max.occurredAt.toISOString());
    }
  }
  return mapa;
}
