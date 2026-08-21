import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CompanyAbcService } from './company-abc.service';

function membership(role: string): MembershipContext {
  return {
    id: 'm-1',
    userId: 'u-1',
    workspaceId: 'ws-1',
    role,
    status: 'active',
  } as MembershipContext;
}

function criarTx(dados: {
  empresas: Array<{ id: string; tags?: string[] }>;
  vendas?: Array<{ companyId: string; total: number }>;
  ganhas?: Array<{ companyId: string; total: number }>;
}) {
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = {
    company: {
      findMany: jest.fn().mockResolvedValue(
        dados.empresas.map((e) => ({ id: e.id, tags: e.tags ?? ['cliente'] })),
      ),
      updateMany,
    },
    salesHistory: {
      groupBy: jest.fn().mockResolvedValue(
        (dados.vendas ?? []).map((v) => ({
          companyId: v.companyId,
          _sum: { valorTotal: v.total },
        })),
      ),
    },
    opportunity: {
      groupBy: jest.fn().mockResolvedValue(
        (dados.ganhas ?? []).map((o) => ({
          companyId: o.companyId,
          _sum: { amount: o.total },
        })),
      ),
    },
  } as unknown as TenantTx;
  return { tx, updateMany };
}

// Lê as chamadas de updateMany e devolve { id: classe } — é o efeito que
// interessa, não a ordem em que as três classes foram gravadas.
function classesGravadas(updateMany: jest.Mock): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [args] of updateMany.mock.calls) {
    for (const id of args.where.id.in) out[id] = args.data.curvaAbc;
  }
  return out;
}

describe('CompanyAbcService', () => {
  it('representante não recalcula a carteira inteira', async () => {
    const { tx } = criarTx({ empresas: [] });

    await expect(
      new CompanyAbcService().calcular(tx, membership('sales_rep')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('classifica pelo acumulado: A até 80%, B até 95%, C o resto', async () => {
    // 5 clientes de 100 → 20% cada. O acumulado ANTES de cada um é
    // 0, 20, 40, 60, 80 — os quatro primeiros ainda estão abaixo da linha
    // dos 80% (A) e o quinto entra logo depois dela (B).
    const { tx, updateMany } = criarTx({
      empresas: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }],
      vendas: [
        { companyId: 'c1', total: 100 },
        { companyId: 'c2', total: 100 },
        { companyId: 'c3', total: 100 },
        { companyId: 'c4', total: 100 },
        { companyId: 'c5', total: 100 },
      ],
    });

    const resumo = await new CompanyAbcService().calcular(tx, membership('owner'));

    const classes = classesGravadas(updateMany);
    expect(classes).toEqual({ c1: 'A', c2: 'A', c3: 'A', c4: 'A', c5: 'B' });
    expect(resumo).toEqual(
      expect.objectContaining({ classificadas: 5, a: 4, b: 1, c: 0, semCompra: 0 }),
    );
  });

  it('o maior cliente sozinho pode ser a classe A inteira', async () => {
    const { tx, updateMany } = criarTx({
      empresas: [{ id: 'gigante' }, { id: 'medio' }, { id: 'pequeno' }],
      vendas: [
        { companyId: 'gigante', total: 900 },
        { companyId: 'medio', total: 80 },
        { companyId: 'pequeno', total: 20 },
      ],
    });

    await new CompanyAbcService().calcular(tx, membership('admin'));

    // gigante entra com acumulado 0 (A) e sozinho já leva a 90%; medio
    // começa em 90 (B) e leva a 98%; pequeno começa em 98 (C).
    expect(classesGravadas(updateMany)).toEqual({
      gigante: 'A',
      medio: 'B',
      pequeno: 'C',
    });
  });

  it('soma venda do eGestor com oportunidade ganha — mesma base do LTV da tela', async () => {
    const { tx, updateMany } = criarTx({
      empresas: [{ id: 'c1' }, { id: 'c2' }],
      vendas: [{ companyId: 'c1', total: 100 }],
      ganhas: [
        { companyId: 'c1', total: 900 },
        { companyId: 'c2', total: 50 },
      ],
    });

    await new CompanyAbcService().calcular(tx, membership('owner'));

    // c1 = 100 de venda + 900 de oportunidade ganha = 1000 (95,2% do
    // total) e entra com acumulado 0, então é A; c2 começa em 95,2 → C.
    const classes = classesGravadas(updateMany);
    expect(classes.c1).toBe('A');
    expect(classes.c2).toBe('C');
  });

  it('empresa sem compra fica SEM classe — não é empurrada pra C', async () => {
    const { tx, updateMany } = criarTx({
      empresas: [{ id: 'comprou' }, { id: 'nunca' }],
      vendas: [{ companyId: 'comprou', total: 500 }],
    });

    const resumo = await new CompanyAbcService().calcular(tx, membership('owner'));

    expect(classesGravadas(updateMany)).toEqual({ comprou: 'A', nunca: null });
    expect(resumo.semCompra).toBe(1);
    expect(resumo.classificadas).toBe(1);
  });

  it('empresa ainda em triagem não entra na curva', async () => {
    const { tx, updateMany } = criarTx({
      empresas: [{ id: 'cliente' }, { id: 'triagem', tags: ['lead-triagem'] }],
      vendas: [
        { companyId: 'cliente', total: 500 },
        { companyId: 'triagem', total: 9999 },
      ],
    });

    const resumo = await new CompanyAbcService().calcular(tx, membership('owner'));

    expect(classesGravadas(updateMany)).toEqual({ cliente: 'A' });
    expect(resumo.faturamentoTotal).toBe('500.00');
  });

  it('rodada sem nenhuma empresa não escreve nada', async () => {
    const { tx, updateMany } = criarTx({ empresas: [] });

    const resumo = await new CompanyAbcService().calcular(tx, membership('owner'));

    expect(updateMany).not.toHaveBeenCalled();
    expect(resumo.classificadas).toBe(0);
  });
});
