import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, RawLeadEtapa, RawLeadStatus } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { COMPANY_REF_SELECT, OPPORTUNITY_REF_SELECT } from '../companies/company-ref';
import type { CompanyRef } from '../companies/company-ref';
import type { AnotacoesQueryDto } from './dto/anotacoes-query.dto';
import { periodoBrasilia } from './periodo-brasilia';

// Teto de linhas. Um período largo não pode virar uma resposta de
// megabytes: o relatório avisa que truncou e a pessoa estreita o filtro.
const LIMITE = 2000;

export interface AnotacaoRelatorioRow {
  id: string;
  occurredAt: string;
  subtipo: string;
  texto: string;
  actorUserId: string | null;
  contatoNome: string | null;
  company: CompanyRef | null;
}

// Posição da empresa no funil de prospecção e o dia em que ela entrou em
// cada etapa (pedido do usuário, 2026-10-27: "coluna do Funil e que
// conste as datas em que a conta mudou de posição"). As datas são as
// marcas de passagem que o lead já guarda (raw_leads.*At) — null =
// passagem que não aconteceu ou anterior a existir a marca.
export interface FunilDaEmpresa {
  companyId: string;
  etapa: RawLeadEtapa;
  status: RawLeadStatus;
  entradaAt: string;
  andamentoAt: string | null;
  reuniaoAt: string | null;
  qualifiedAt: string | null;
  convertedAt: string | null;
  discardedAt: string | null;
}

export interface AnotacoesRelatorio {
  rows: AnotacaoRelatorioRow[];
  funis: FunilDaEmpresa[];
  total: number;
  truncado: boolean;
}

// Só registro feito por gente entra no relatório — os automáticos
// (field_update/stage_change, "empresa criada", "cadastro atualizado")
// são trilha de auditoria, não anotação. Mesma régua de apenasInteracoes
// no frontend.
const TIPOS_DE_INTERACAO: Prisma.ActivityWhereInput['type'] = {
  in: ['note', 'call', 'email'],
};

// Relatório "Anotações da Timeline" (pedido do usuário, 2026-09-23) — o
// primeiro da tela de Relatórios no molde do eGestor (menu à esquerda,
// filtros em cima, resultado embaixo).
//
// Visibilidade: exatamente a mesma da Timeline da ficha
// (ActivityQueryService) — empresa que o usuário enxerga
// (companyReadFilter, fonte única desde 2026-09-02) e, pra quem não é
// owner/admin, só o que ele (ou a equipe dele, no caso do gerente)
// registrou. Relatório não pode mostrar o que a ficha esconde.
@Injectable()
export class AnotacoesRelatorioService {
  constructor(private readonly policy: PolicyService) {}

  async gerar(
    tx: TenantTx,
    membership: MembershipContext,
    query: AnotacoesQueryDto,
  ): Promise<AnotacoesRelatorio> {
    if (!this.policy.canModule(membership, 'empresas_timeline', 'ver')) {
      throw new ForbiddenException(
        'Sem permissão para ver anotações da Timeline.',
      );
    }

    const { de, ate } = periodoBrasilia(query.inicio, query.fim);
    const scope = await this.policy.scopeFilter(tx, membership);
    const empresasVisiveis = await this.policy.companyReadFilter(tx, membership);

    // O filtro de usuário entra num AND à parte, nunca substituindo o
    // escopo do papel: os dois precisam valer ao mesmo tempo, senão
    // escolher outro nome no filtro viraria uma forma de ler a Timeline
    // de quem o papel não deixa ver.
    const empresaVisivel: Prisma.CompanyWhereInput = {
      AND: [empresasVisiveis, { deletedAt: null }],
    };
    const where: Prisma.ActivityWhereInput = {
      workspaceId: membership.workspaceId,
      type: TIPOS_DE_INTERACAO,
      occurredAt: { gte: de, lte: ate },
      AND: [
        ...(scope.ownerUserId !== undefined
          ? [{ actorUserId: scope.ownerUserId }]
          : []),
        ...(query.usuarioId ? [{ actorUserId: query.usuarioId }] : []),
        {
          OR: [
            { company: { is: empresaVisivel } },
            { opportunity: { is: { company: { is: empresaVisivel } } } },
          ],
        },
      ],
    };

    const encontrados = await tx.activity.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      include: {
        company: { select: COMPANY_REF_SELECT },
        opportunity: { select: OPPORTUNITY_REF_SELECT },
      },
    });

    const empresaFiltro = query.empresa?.trim().toLowerCase();

    const rows = encontrados
      .map((a) => {
        const payload = (a.payload ?? {}) as {
          texto?: string;
          subtipo?: string;
          contatoNome?: string;
        };
        return {
          id: a.id,
          occurredAt: a.occurredAt.toISOString(),
          // Mesmo fallback da ficha: registro antigo sem `subtipo` no
          // payload é lido pelo tipo do banco.
          subtipo:
            payload.subtipo ??
            (a.type === 'call' ? 'ligacao' : a.type === 'email' ? 'email' : 'nota'),
          texto: payload.texto ?? '',
          actorUserId: a.actorUserId,
          contatoNome: payload.contatoNome ?? null,
          company: a.company ?? a.opportunity?.company ?? null,
        };
      })
      // Subtipo e nome da empresa saem do payload/da relação, não de
      // coluna indexada — filtrar aqui evita um `where` em jsonb que o
      // Postgres não consegue usar índice pra resolver de qualquer jeito.
      .filter((r) => (query.subtipo ? r.subtipo === query.subtipo : true))
      .filter((r) =>
        empresaFiltro
          ? [r.company?.razaoSocial, r.company?.fantasia, r.company?.nomeParaContato]
              .filter((n): n is string => !!n)
              .some((n) => n.toLowerCase().includes(empresaFiltro))
          : true,
      );

    const visiveis = rows.slice(0, LIMITE);
    return {
      rows: visiveis,
      funis: await this.funisDasEmpresas(tx, membership, visiveis),
      total: rows.length,
      truncado: rows.length > LIMITE,
    };
  }

  // Um lead por empresa. Quando a empresa tem mais de um (reimportada,
  // descartada e cadastrada de novo), vale o que está em andamento; entre
  // iguais, o mais novo. O RLS de raw_leads continua valendo: lead que a
  // pessoa não enxerga na Prospecção fica com a coluna vazia aqui.
  private async funisDasEmpresas(
    tx: TenantTx,
    membership: MembershipContext,
    rows: AnotacaoRelatorioRow[],
  ): Promise<FunilDaEmpresa[]> {
    const ids = [...new Set(rows.map((r) => r.company?.id).filter((id): id is string => !!id))];
    if (ids.length === 0) return [];

    const leads = await tx.rawLead.findMany({
      where: { workspaceId: membership.workspaceId, promotedCompanyId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: {
        promotedCompanyId: true,
        etapa: true,
        status: true,
        createdAt: true,
        andamentoAt: true,
        reuniaoAt: true,
        qualifiedAt: true,
        convertedAt: true,
        discardedAt: true,
      },
    });

    const porEmpresa = new Map<string, (typeof leads)[number]>();
    for (const lead of leads) {
      const id = lead.promotedCompanyId as string;
      const atual = porEmpresa.get(id);
      if (!atual || (atual.status === 'descartado' && lead.status !== 'descartado')) {
        porEmpresa.set(id, lead);
      }
    }

    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return [...porEmpresa.entries()].map(([companyId, lead]) => ({
      companyId,
      etapa: lead.etapa,
      status: lead.status,
      entradaAt: lead.createdAt.toISOString(),
      andamentoAt: iso(lead.andamentoAt),
      reuniaoAt: iso(lead.reuniaoAt),
      qualifiedAt: iso(lead.qualifiedAt),
      convertedAt: iso(lead.convertedAt),
      discardedAt: iso(lead.discardedAt),
    }));
  }
}
