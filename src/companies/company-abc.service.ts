import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CurvaAbc } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// Papéis que podem recalcular. Mesmo critério das outras ações
// administrativas do projeto (ver EgestorSyncController): reclassifica a
// carteira inteira do workspace de uma vez, não é ação de representante.
const RECALCULO_ROLES = new Set(['owner', 'admin']);

// Corte clássico da curva ABC. A = os clientes que, somados do maior pro
// menor, formam os primeiros 80% do faturamento; B = até 95%; C = o resto.
const CORTE_A = 80;
const CORTE_B = 95;

export interface CurvaAbcResumo {
  classificadas: number;
  a: number;
  b: number;
  c: number;
  // Empresas sem compra nenhuma — ficam sem classe (não viram "D", nem
  // são empurradas pra C junto com quem comprou pouco: quem nunca comprou
  // não está na curva).
  semCompra: number;
  faturamentoTotal: string;
  calculadaEm: Date;
}

// Curva ABC de clientes (pedido do usuário, 2026-08-21) — botão "Calcular
// curva ABC" na tela Empresas.
//
// A classe é GRAVADA em `companies.curva_abc`, não calculada a cada
// leitura: é assim que ela fica estável entre uma revisão e outra. Se
// fosse recalculada na hora, a classe de um cliente mudaria sozinha
// sempre que qualquer outro cliente comprasse — e classe de cliente é
// coisa que se usa pra decidir prioridade de atendimento.
@Injectable()
export class CompanyAbcService {
  async calcular(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<CurvaAbcResumo> {
    if (!RECALCULO_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem recalcular a curva ABC de clientes.',
      );
    }

    const faturamento = await this.faturamentoPorEmpresa(
      tx,
      membership.workspaceId,
    );

    // Mesma base do LTV da tela Empresas: venda importada do eGestor +
    // oportunidade ganha no pipeline. Uma das duas sozinha daria uma curva
    // que não bate com o número que aparece na coluna ao lado.
    const empresas = await tx.company.findMany({
      where: { workspaceId: membership.workspaceId, deletedAt: null },
      select: { id: true, tags: true },
    });

    const comCompra: Array<{ id: string; valor: number }> = [];
    const semCompra: string[] = [];
    for (const empresa of empresas) {
      // Empresa ainda em triagem não é cliente — não entra na curva (mesmo
      // critério de exclusão da lista de Empresas).
      if (empresa.tags.includes('lead-triagem')) continue;
      const valor = faturamento.get(empresa.id) ?? 0;
      if (valor > 0) comCompra.push({ id: empresa.id, valor });
      else semCompra.push(empresa.id);
    }

    comCompra.sort((a, b) => b.valor - a.valor);
    const total = comCompra.reduce((s, e) => s + e.valor, 0);

    const porClasse: Record<CurvaAbc, string[]> = { A: [], B: [], C: [] };
    let acumulado = 0;
    for (const empresa of comCompra) {
      // A classe olha o acumulado ANTES de somar este cliente — quem
      // atravessa a linha dos 80% ainda pertence ao A. Usar o acumulado
      // depois jogaria o último cliente da lista sempre pra C, inclusive
      // no caso de um cliente só (que seria C sozinho, sem fazer sentido).
      const classe: CurvaAbc =
        acumulado < CORTE_A ? 'A' : acumulado < CORTE_B ? 'B' : 'C';
      porClasse[classe].push(empresa.id);
      // Total zero não acontece aqui (só entra quem tem valor > 0), mas a
      // guarda evita divisão por zero se a regra de entrada mudar.
      acumulado += total > 0 ? (empresa.valor / total) * 100 : 100;
    }

    const calculadaEm = new Date();
    for (const classe of ['A', 'B', 'C'] as const) {
      if (porClasse[classe].length === 0) continue;
      await tx.company.updateMany({
        where: { id: { in: porClasse[classe] } },
        data: { curvaAbc: classe, curvaAbcCalculadaEm: calculadaEm },
      });
    }
    // Quem deixou de ter compra desde o último cálculo volta pra "sem
    // classe" em vez de carregar a classe antiga pra sempre.
    if (semCompra.length > 0) {
      await tx.company.updateMany({
        where: { id: { in: semCompra } },
        data: { curvaAbc: null, curvaAbcCalculadaEm: calculadaEm },
      });
    }

    return {
      classificadas: comCompra.length,
      a: porClasse.A.length,
      b: porClasse.B.length,
      c: porClasse.C.length,
      semCompra: semCompra.length,
      faturamentoTotal: total.toFixed(2),
      calculadaEm,
    };
  }

  // Soma por empresa, feita no banco (não trazendo 1.000 vendas pro Node):
  // é uma varredura só de duas tabelas, e o resultado é uma linha por
  // empresa.
  private async faturamentoPorEmpresa(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<Map<string, number>> {
    const vendas = await tx.salesHistory.groupBy({
      by: ['companyId'],
      where: { workspaceId },
      _sum: { valorTotal: true },
    });
    const ganhas = await tx.opportunity.groupBy({
      by: ['companyId'],
      where: { workspaceId, status: 'won', deletedAt: null },
      _sum: { amount: true },
    });

    const mapa = new Map<string, number>();
    for (const linha of vendas) {
      mapa.set(linha.companyId, Number(linha._sum.valorTotal ?? 0));
    }
    for (const linha of ganhas) {
      mapa.set(
        linha.companyId,
        (mapa.get(linha.companyId) ?? 0) + Number(linha._sum.amount ?? 0),
      );
    }
    return mapa;
  }
}
