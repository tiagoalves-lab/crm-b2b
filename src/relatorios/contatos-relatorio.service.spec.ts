import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { PolicyService } from '../policy/policy.service';
import { ContatosRelatorioService } from './contatos-relatorio.service';

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

function criarTx(contatos: unknown[] = []) {
  const findMany = jest.fn().mockResolvedValue(contatos);
  const count = jest.fn().mockResolvedValue(contatos.length);
  const tx = { contact: { findMany, count } } as unknown as TenantTx;
  return { tx, findMany, count };
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
  } as unknown as PolicyService;
}

describe('ContatosRelatorioService', () => {
  it('recusa quem não pode ver contatos', async () => {
    const { tx } = criarTx();
    const service = new ContatosRelatorioService(criarPolicy({ podeVer: false }));

    await expect(service.gerar(tx, membership('sales_rep'), {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa período com uma data só', async () => {
    const { tx } = criarTx();
    const service = new ContatosRelatorioService(criarPolicy());

    await expect(
      service.gerar(tx, membership('owner'), { inicio: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('representante só enxerga os próprios contatos, mesmo filtrando outro dono', async () => {
    const { tx, findMany } = criarTx();
    const service = new ContatosRelatorioService(criarPolicy({ ownerUserId: REP }));

    await service.gerar(tx, membership('sales_rep'), { usuarioId: OUTRO });

    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([{ ownerUserId: REP }, { ownerUserId: OUTRO }]),
    );
    expect(where.company.deletedAt).toBeNull();
  });

  it('sem período não filtra por data de cadastro', async () => {
    const { tx, findMany } = criarTx();
    const service = new ContatosRelatorioService(criarPolicy());

    await service.gerar(tx, membership('owner'), { decisor: 'sim' });

    const where = findMany.mock.calls[0][0].where;
    expect(where.createdAt).toBeUndefined();
    expect(where.decisor).toBe(true);
  });

  it('busca por telefone formatado também casa só com dígitos', async () => {
    const { tx, findMany } = criarTx();
    const service = new ContatosRelatorioService(criarPolicy());

    await service.gerar(tx, membership('owner'), { contato: '(11) 9999' });

    const busca = findMany.mock.calls[0][0].where.AND[0].OR;
    expect(busca).toEqual(expect.arrayContaining([{ telefone: { contains: '119999' } }]));
  });
});
