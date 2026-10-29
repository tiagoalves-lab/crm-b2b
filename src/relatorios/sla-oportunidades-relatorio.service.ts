import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { COMPANY_REF_SELECT } from '../companies/company-ref';
import type { CompanyRef } from '../companies/company-ref';
import { diaBR, FUSO_PADRAO } from '../reports/report-datas';
import { diasDeSla } from '../opportunities/opportunity-sla';
import type { SlaOportunidadesQueryDto } from './dto/sla-oportunidades-query.dto';
import { periodoBrasilia } from './periodo-brasilia';

const LIMITE = 2000;

// Corte do resumo: "80% das propostas saem em até N dias úteis".
const CORTE = 0.8;

export interface SlaOportunidadeRow {
  id: string;
  abertaEm: string;
  // Dia em que a contagem começou (revisão pedida pelo cliente ou
  // abertura) e em que terminou; fim null = ainda em proposta.
  inicioSla: string;
  fimSla: string | null;
  dias: number;
  pendente: boolean;
  revisado: boolean;
  etapa: string;
  status: string;
  ownerUserId: string;
  company: CompanyRef | null;
}

export interface SlaFaixa {
  dias: number;
  total: number;
  pendentes: number;
}

export interface SlaResumo {
  total: number;
  mediana: number | null;
  media: number | null;
  maximo: number | null;
  corte: number;
  diasNoCorte: number | null;
  ateCorte: number;
  pendentes: number;
}

export interface SlaOportunidadesRelatorio {
  faixas: SlaFaixa[];
  resumo: SlaResumo;
  rows: SlaOportunidadeRow[];
  total: number;
  truncado: boolean;
}

// Histograma e resumo a partir dos dias de cada oportunidade. Uma faixa
// por dia útil de 0 até o maior SLA, inclusive as vazias — num histograma
// o dia sem nenhuma proposta é informação, e pular a coluna esconderia o
// buraco. Separado do service pra poder testar a conta sem banco.
export function montarHistograma(
  itens: { dias: number; pendente: boolean }[],
): { faixas: SlaFaixa[]; resumo: SlaResumo } {
  const total = itens.length;
  if (total === 0) {
    return {
      faixas: [],
      resumo: {
        total: 0,
        mediana: null,
        media: null,
        maximo: null,
        corte: CORTE,
        diasNoCorte: null,
        ateCorte: 0,
        pendentes: 0,
      },
    };
  }

  const ordenados = itens.map((i) => i.dias).sort((a, b) => a - b);
  const maximo = ordenados[ordenados.length - 1];
  const faixas: SlaFaixa[] = Array.from({ length: maximo + 1 }, (_, dias) => ({
    dias,
    total: 0,
    pendentes: 0,
  }));
  for (const item of itens) {
    faixas[item.dias].total++;
    if (item.pendente) faixas[item.dias].pendentes++;
  }

  const meio = Math.floor(total / 2);
  const mediana =
    total % 2 === 1 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
  const media = Math.round((ordenados.reduce((s, d) => s + d, 0) / total) * 10) / 10;
  // Menor número de dias que já cobre o corte (percentil discreto).
  const diasNoCorte = ordenados[Math.max(0, Math.ceil(total * CORTE) - 1)];

  return {
    faixas,
    resumo: {
      total,
      mediana,
      media,
      maximo,
      corte: CORTE,
      diasNoCorte,
      ateCorte: ordenados.filter((d) => d <= diasNoCorte).length,
      pendentes: itens.filter((i) => i.pendente).length,
    },
  };
}

// Relatório "SLA de Oportunidades" (pedido do usuário, 2026-10-28):
// histograma de quantas propostas levaram cada número de dias úteis de SLA,
// com a lista das oportunidades embaixo, da mais lenta para a mais rápida.
//
// O SLA é o mesmo do selo do card (src/opportunities/opportunity-sla.ts):
// dias úteis da abertura, ou da revisão pedida pelo cliente, até a
// proposta sair das etapas de proposta; pendente conta até hoje. Feriados
// não são descontados, igual ao selo.
//
// Fica fora a carga histórica de cotações ('historico-cotacoes'): ela não
// passou pelas etapas de proposta no CRM e teria SLA zero em todas.
//
// Visibilidade: a mesma do Pipeline (OpportunityService#findAll) — escopo
// por dono, com o filtro do formulário estreitando, nunca ampliando.
@Injectable()
export class SlaOportunidadesRelatorioService {
  constructor(private readonly policy: PolicyService) {}

  async gerar(
    tx: TenantTx,
    membership: MembershipContext,
    query: SlaOportunidadesQueryDto,
  ): Promise<SlaOportunidadesRelatorio> {
    if (!this.policy.canModule(membership, 'oportunidades', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver oportunidades.');
    }

    const { de, ate } = periodoBrasilia(query.inicio, query.fim);
    const scope = await this.policy.scopeFilter(tx, membership);

    const where: Prisma.OpportunityWhereInput = {
      workspaceId: membership.workspaceId,
      ...scope,
      deletedAt: null,
      createdAt: { gte: de, lte: ate },
      AND: [
        { OR: [{ origem: null }, { origem: { not: 'historico-cotacoes' } }] },
        ...(query.usuarioId ? [{ ownerUserId: query.usuarioId }] : []),
      ],
    };

    const opps = await tx.opportunity.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        slaDueDate: true,
        slaRevisionDate: true,
        status: true,
        ownerUserId: true,
        stage: { select: { name: true } },
        company: { select: COMPANY_REF_SELECT },
      },
    });

    const agora = new Date();
    const rows: SlaOportunidadeRow[] = opps
      .map((o) => ({
        id: o.id,
        abertaEm: o.createdAt.toISOString(),
        inicioSla: o.slaRevisionDate
          ? o.slaRevisionDate.toISOString().slice(0, 10)
          : diaBR(o.createdAt, FUSO_PADRAO),
        fimSla: o.slaDueDate ? o.slaDueDate.toISOString().slice(0, 10) : null,
        dias: diasDeSla(o, agora),
        pendente: !o.slaDueDate,
        revisado: !!o.slaRevisionDate,
        etapa: o.stage.name,
        status: o.status,
        ownerUserId: o.ownerUserId,
        company: o.company ?? null,
      }))
      // A mais lenta em cima — é a que a pessoa vem procurar.
      .sort((a, b) => b.dias - a.dias || a.abertaEm.localeCompare(b.abertaEm));

    const { faixas, resumo } = montarHistograma(rows);

    return {
      faixas,
      resumo,
      rows: rows.slice(0, LIMITE),
      total: rows.length,
      truncado: rows.length > LIMITE,
    };
  }
}
