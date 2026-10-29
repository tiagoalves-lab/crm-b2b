import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { PolicyService } from '../policy/policy.service';
import { AnotacoesRelatorioService } from './anotacoes-relatorio.service';

const REP = '33333333-3333-4333-8333-333333333333';
const OUTRO = '44444444-4444-4444-8444-444444444444';

function membership(role: string, userId = REP): MembershipContext {
  return {
    id: 'm-1',
    userId,
    workspaceId: 'ws-1',
    role,
    status: 'active',
  } as MembershipContext;
}

function criarTx(atividades: unknown[] = [], leads: unknown[] = []) {
  const findMany = jest.fn().mockResolvedValue(atividades);
  const leadFindMany = jest.fn().mockResolvedValue(leads);
  const tx = {
    activity: { findMany },
    rawLead: { findMany: leadFindMany },
  } as unknown as TenantTx;
  return { tx, findMany, leadFindMany };
}

function criarPolicy(
  opts: { podeVer?: boolean; ownerUserId?: unknown } = {},
): PolicyService {
  return {
    canModule: jest.fn().mockReturnValue(opts.podeVer ?? true),
    scopeFilter: jest
      .fn()
      .mockResolvedValue(
        opts.ownerUserId === undefined ? {} : { ownerUserId: opts.ownerUserId },
      ),
    companyReadFilter: jest.fn().mockResolvedValue({}),
  } as unknown as PolicyService;
}

function atividade(over: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    occurredAt: new Date('2026-09-10T14:00:00.000Z'),
    type: 'note',
    actorUserId: REP,
    payload: { texto: 'conversa', subtipo: 'ligacao' },
    company: {
      id: 'c-1',
      razaoSocial: 'EMPRESA UM',
      fantasia: null,
      nomeParaContato: null,
      deletedAt: null,
    },
    opportunity: null,
    ...over,
  };
}

const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };

describe('AnotacoesRelatorioService', () => {
  it('recusa quem não pode ver a Timeline', async () => {
    const { tx } = criarTx();
    const service = new AnotacoesRelatorioService(criarPolicy({ podeVer: false }));

    await expect(
      service.gerar(tx, membership('sales_rep'), PERIODO),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lê o período como dia civil de Brasília, não como UTC', async () => {
    const { tx, findMany } = criarTx();
    const service = new AnotacoesRelatorioService(criarPolicy());

    await service.gerar(tx, membership('owner'), PERIODO);

    const where = findMany.mock.calls[0][0].where;
    // 01/09 00:00 em Brasília = 03:00 UTC; 30/09 23:59:59.999 = 02:59 do dia 1º.
    expect(where.occurredAt.gte.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(where.occurredAt.lte.toISOString()).toBe('2026-10-01T02:59:59.999Z');
  });

  it('filtrar por usuário não amplia o escopo do papel', async () => {
    const { tx, findMany } = criarTx();
    const service = new AnotacoesRelatorioService(
      criarPolicy({ ownerUserId: REP }),
    );

    await service.gerar(tx, membership('sales_rep'), {
      ...PERIODO,
      usuarioId: OUTRO,
    });

    // As duas condições precisam conviver num AND — se o filtro do
    // formulário substituísse o escopo, o representante leria a Timeline
    // de qualquer colega escolhendo o nome dele no select.
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { actorUserId: REP },
        { actorUserId: OUTRO },
      ]),
    );
  });

  it('usa o tipo do banco quando o registro antigo não tem subtipo', async () => {
    const { tx } = criarTx([
      atividade({ id: 'a-2', type: 'email', payload: { texto: 'oi' } }),
    ]);
    const service = new AnotacoesRelatorioService(criarPolicy());

    const { rows } = await service.gerar(tx, membership('owner'), PERIODO);

    expect(rows[0].subtipo).toBe('email');
  });

  it('filtra por tipo e por nome de empresa', async () => {
    const { tx } = criarTx([
      atividade(),
      atividade({ id: 'a-3', payload: { texto: 'visita', subtipo: 'visita' } }),
      atividade({
        id: 'a-4',
        company: {
          id: 'c-2',
          razaoSocial: 'OUTRA EMPRESA',
          fantasia: null,
          nomeParaContato: null,
          deletedAt: null,
        },
      }),
    ]);
    const service = new AnotacoesRelatorioService(criarPolicy());

    const porTipo = await service.gerar(tx, membership('owner'), {
      ...PERIODO,
      subtipo: 'visita',
    });
    expect(porTipo.rows.map((r) => r.id)).toEqual(['a-3']);

    const porEmpresa = await service.gerar(tx, membership('owner'), {
      ...PERIODO,
      empresa: 'outra',
    });
    expect(porEmpresa.rows.map((r) => r.id)).toEqual(['a-4']);
  });

  it('recusa período invertido', async () => {
    const { tx } = criarTx();
    const service = new AnotacoesRelatorioService(criarPolicy());

    await expect(
      service.gerar(tx, membership('owner'), {
        inicio: '2026-09-30',
        fim: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('traz a etapa do funil e as datas de passagem, preferindo o lead em andamento', async () => {
    const { tx, leadFindMany } = criarTx(
      [atividade()],
      [
        {
          promotedCompanyId: 'c-1',
          etapa: 'entrada',
          status: 'descartado',
          createdAt: new Date('2026-10-01T12:00:00.000Z'),
          andamentoAt: null,
          reuniaoAt: null,
          qualifiedAt: null,
          convertedAt: null,
          discardedAt: new Date('2026-10-02T12:00:00.000Z'),
        },
        {
          promotedCompanyId: 'c-1',
          etapa: 'reuniao',
          status: 'novo',
          createdAt: new Date('2026-09-01T12:00:00.000Z'),
          andamentoAt: new Date('2026-09-05T12:00:00.000Z'),
          reuniaoAt: new Date('2026-09-10T12:00:00.000Z'),
          qualifiedAt: null,
          convertedAt: null,
          discardedAt: null,
        },
      ],
    );
    const service = new AnotacoesRelatorioService(criarPolicy());

    const r = await service.gerar(tx, membership('owner'), PERIODO);

    expect(leadFindMany.mock.calls[0][0].where.promotedCompanyId).toEqual({ in: ['c-1'] });
    expect(r.funis).toEqual([
      expect.objectContaining({
        companyId: 'c-1',
        etapa: 'reuniao',
        entradaAt: '2026-09-01T12:00:00.000Z',
        andamentoAt: '2026-09-05T12:00:00.000Z',
        reuniaoAt: '2026-09-10T12:00:00.000Z',
      }),
    ]);
  });
});
