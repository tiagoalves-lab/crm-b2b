import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { PolicyService } from '../policy/policy.service';
import { CompanyTeamService } from './company-team.service';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const REP_A = '33333333-3333-4333-8333-333333333333';
const REP_B = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '55555555-5555-4555-8555-555555555555';

function membership(role: string, userId = 'u-gerente'): MembershipContext {
  return {
    id: 'm-1',
    userId,
    workspaceId: 'ws-1',
    role,
    status: 'active',
  } as MembershipContext;
}

function criarTx(grants: string[], ownerUserId: string | null = OWNER_ID) {
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const upsert = jest.fn().mockResolvedValue({});
  const tx = {
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: COMPANY_ID, ownerUserId }),
    },
    companyAccess: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(grants.map((userId) => ({ userId }))),
        ),
      deleteMany,
      upsert,
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
      // Admin/dono do workspace — nunca entram na equipe (regra 3).
      findMany: jest.fn().mockResolvedValue([{ userId: ADMIN_ID }]),
    },
  } as unknown as TenantTx;
  return { tx, deleteMany, upsert };
}

function criarPolicy(podeLer = true): PolicyService {
  return {
    canReadCompany: jest.fn().mockResolvedValue(podeLer),
  } as unknown as PolicyService;
}

describe('CompanyTeamService', () => {
  it('não devolve o responsável nem admin/dono dentro da lista', async () => {
    const { tx } = criarTx([OWNER_ID, ADMIN_ID, REP_A]);
    const service = new CompanyTeamService(criarPolicy());

    const team = await service.find(tx, membership('manager'), COMPANY_ID);

    expect(team.ownerUserId).toBe(OWNER_ID);
    expect(team.userIds).toEqual([REP_A]);
  });

  it('esconde a empresa que o membro não enxerga (404, não 403)', async () => {
    const { tx } = criarTx([]);
    const service = new CompanyTeamService(criarPolicy(false));

    await expect(
      service.find(tx, membership('sales_rep'), COMPANY_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('representante enxerga a equipe mas não pode editar', async () => {
    const { tx } = criarTx([REP_A]);
    const service = new CompanyTeamService(criarPolicy());

    const team = await service.find(tx, membership('sales_rep'), COMPANY_ID);
    expect(team.podeEditar).toBe(false);

    await expect(
      service.set(tx, membership('sales_rep'), COMPANY_ID, [REP_A, REP_B]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grava a lista inteira e ignora o responsável se vier marcado', async () => {
    const { tx, deleteMany, upsert } = criarTx([REP_A]);
    const service = new CompanyTeamService(criarPolicy());

    await service.set(tx, membership('manager'), COMPANY_ID, [
      REP_B,
      OWNER_ID,
      REP_B,
    ]);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.userId).toBe(REP_B);
    expect(deleteMany.mock.calls[0][0].where.userId).toEqual({
      notIn: [REP_B, ADMIN_ID, OWNER_ID],
    });
  });

  it('lista vazia apaga todos os acessos da empresa', async () => {
    const { tx, deleteMany, upsert } = criarTx([REP_A, REP_B]);
    const service = new CompanyTeamService(criarPolicy());

    await service.set(tx, membership('owner'), COMPANY_ID, []);

    expect(upsert).not.toHaveBeenCalled();
    // Admin e responsável continuam preservados — a tela não mostra
    // essas linhas, então também não as apaga.
    expect(deleteMany.mock.calls[0][0].where.userId).toEqual({
      notIn: [ADMIN_ID, OWNER_ID],
    });
    expect(deleteMany.mock.calls[0][0].where.companyId).toBe(COMPANY_ID);
  });

  it('empresa sem responsável não pode ficar com a equipe vazia', async () => {
    const { tx, deleteMany } = criarTx([REP_A], null);
    const service = new CompanyTeamService(criarPolicy());

    await expect(
      service.set(tx, membership('manager'), COMPANY_ID, []),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
