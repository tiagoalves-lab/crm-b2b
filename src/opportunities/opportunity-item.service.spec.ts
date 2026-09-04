import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { OpportunityItemService } from './opportunity-item.service';
import { mustTagsBeItems, uniqueItemNames } from './opportunity-tags';
import type { OpportunityService } from './opportunity.service';

const WORKSPACE_ID = 'workspace-1';
const OPPORTUNITY_ID = 'opp-1';

function membership(): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    role: 'sales_rep',
    status: 'active',
  };
}

function fakeOpportunityService(): OpportunityService {
  return {
    mustBeVisible: jest.fn().mockResolvedValue({ id: OPPORTUNITY_ID }),
  } as unknown as OpportunityService;
}

interface FakeItem {
  id: string;
  opportunityId: string;
  name: string;
  position: number;
  // Valor do item (2026-09-04) — nulo/ausente = item sem preço.
  amount?: number | null;
}

function fakeTx(items: FakeItem[] = []): TenantTx {
  return {
    opportunityItem: {
      findMany: jest.fn().mockResolvedValue(items),
      findFirst: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where: {
            id?: string;
            name?: { equals: string; mode: string };
          };
        }) =>
          Promise.resolve(
            items.find((item) =>
              where.id
                ? item.id === where.id
                : where.name
                  ? item.name.toLowerCase() === where.name.equals.toLowerCase()
                  : false,
            ) ?? null,
          ),
      ),
      count: jest.fn().mockResolvedValue(items.length),
      // Serve às duas chamadas do service: _max.position (fim da lista)
      // e _sum.amount (soma que vira o valor da oportunidade). Sem
      // nenhum item com valor, o Prisma devolve _sum.amount = null.
      aggregate: jest.fn().mockResolvedValue({
        _max: { position: items.length ? items.length : null },
        _sum: {
          amount: items.some((item) => item.amount !== null && item.amount !== undefined)
            ? items.reduce((total, item) => total + (item.amount ?? 0), 0)
            : null,
        },
      }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'item-new', ...data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
      update: jest
        .fn()
        .mockImplementation(({ where, data }: { where: { id: string }; data: object }) =>
          Promise.resolve({ id: where.id, ...data }),
        ),
    },
    opportunity: {
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('OpportunityItemService', () => {
  it('adicionar item exige visibilidade de ESCRITA na oportunidade', async () => {
    const opportunities = fakeOpportunityService();
    const service = new OpportunityItemService(opportunities);
    const tx = fakeTx();
    await service.create(tx, membership(), OPPORTUNITY_ID, {
      name: ' Bomba  5cv ',
    });
    expect(opportunities.mustBeVisible).toHaveBeenCalledWith(
      tx,
      membership(),
      OPPORTUNITY_ID,
      'write',
    );
  });

  it('normaliza espaços e coloca o item no fim da lista', async () => {
    const service = new OpportunityItemService(fakeOpportunityService());
    const tx = fakeTx([
      { id: 'a', opportunityId: OPPORTUNITY_ID, name: 'Painel', position: 1 },
    ]);
    const created = await service.create(tx, membership(), OPPORTUNITY_ID, {
      name: ' Bomba   5cv ',
    });
    expect(created).toMatchObject({ name: 'Bomba 5cv', position: 2 });
  });

  it('CRÍTICO: rejeita item vazio', async () => {
    const service = new OpportunityItemService(fakeOpportunityService());
    await expect(
      service.create(fakeTx(), membership(), OPPORTUNITY_ID, { name: '   ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRÍTICO: rejeita item repetido (sem diferenciar maiúscula/minúscula)', async () => {
    const service = new OpportunityItemService(fakeOpportunityService());
    const tx = fakeTx([
      { id: 'a', opportunityId: OPPORTUNITY_ID, name: 'Painel', position: 1 },
    ]);
    await expect(
      service.create(tx, membership(), OPPORTUNITY_ID, { name: 'painel' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('404 ao remover item que não pertence à oportunidade', async () => {
    const service = new OpportunityItemService(fakeOpportunityService());
    await expect(
      service.remove(fakeTx(), membership(), OPPORTUNITY_ID, 'nao-existe'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('opportunity-tags', () => {
  it('uniqueItemNames tira vazio e repetido, preservando a primeira grafia', () => {
    expect(
      uniqueItemNames([' Bomba ', 'bomba', '', 'Painel', 'PAINEL ']),
    ).toEqual(['Bomba', 'Painel']);
  });

  it('mustTagsBeItems devolve a grafia da lista, na ordem da lista', async () => {
    const tx = fakeTx([
      { id: 'a', opportunityId: OPPORTUNITY_ID, name: 'Painel', position: 1 },
      {
        id: 'b',
        opportunityId: OPPORTUNITY_ID,
        name: 'Bomba 5cv',
        position: 2,
      },
    ]);
    await expect(
      mustTagsBeItems(tx, OPPORTUNITY_ID, ['bomba 5cv', 'PAINEL', 'painel']),
    ).resolves.toEqual(['Painel', 'Bomba 5cv']);
  });

  it('CRÍTICO: mustTagsBeItems rejeita tag que não é item da oportunidade', async () => {
    const tx = fakeTx([
      { id: 'a', opportunityId: OPPORTUNITY_ID, name: 'Painel', position: 1 },
    ]);
    await expect(
      mustTagsBeItems(tx, OPPORTUNITY_ID, ['Painel', 'Inventada']),
    ).rejects.toThrow(BadRequestException);
  });

  it('mustTagsBeItems sem tags devolve lista vazia sem consultar o banco', async () => {
    const tx = fakeTx();
    await expect(
      mustTagsBeItems(tx, OPPORTUNITY_ID, undefined),
    ).resolves.toEqual([]);
    await expect(mustTagsBeItems(tx, OPPORTUNITY_ID, [])).resolves.toEqual([]);
    expect(tx.opportunityItem.findMany).not.toHaveBeenCalled();
  });

  it('soma dos itens com valor vira o valor da oportunidade', async () => {
    const service = new OpportunityItemService(fakeOpportunityService());
    const tx = fakeTx([
      {
        id: 'a',
        opportunityId: OPPORTUNITY_ID,
        name: 'Painel',
        position: 1,
        amount: 1500,
      },
      {
        id: 'b',
        opportunityId: OPPORTUNITY_ID,
        name: 'Bomba',
        position: 2,
        amount: 500.5,
      },
    ]);
    await service.update(tx, membership(), OPPORTUNITY_ID, 'a', {
      amount: 1500,
    });
    expect(tx.opportunity.update).toHaveBeenCalledWith({
      where: { id: OPPORTUNITY_ID },
      data: { amount: 2000.5 },
    });
  });

  it('CRÍTICO: lista sem nenhum valor não mexe no valor da oportunidade', async () => {
    const service = new OpportunityItemService(fakeOpportunityService());
    const tx = fakeTx([
      { id: 'a', opportunityId: OPPORTUNITY_ID, name: 'Painel', position: 1 },
    ]);
    await service.create(tx, membership(), OPPORTUNITY_ID, {
      name: 'Bomba',
    });
    expect(tx.opportunity.update).not.toHaveBeenCalled();
  });
});
