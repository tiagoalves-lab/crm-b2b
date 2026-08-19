import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { ContactService } from './contact.service';

const WORKSPACE_ID = 'workspace-1';
const COMPANY_ID = 'company-1';

function membership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    role: 'sales_rep',
    status: 'active',
    ...overrides,
  };
}

function fakeTx(
  options: {
    company?: { id: string; deletedAt?: Date | null } | null;
    contact?: { id: string; companyId: string };
  } = {},
): TenantTx {
  const company =
    options.company === undefined
      ? { id: COMPANY_ID, deletedAt: null }
      : options.company;
  const contact = options.contact;

  return {
    company: {
      findFirst: jest.fn().mockResolvedValue(company),
    },
    contact: {
      findMany: jest.fn().mockResolvedValue(contact ? [contact] : []),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'contact-1', ...data }),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(contact && where.id === contact.id ? contact : null),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'contact-1', companyId: COMPANY_ID, ...data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('ContactService', () => {
  it('404 ao listar contatos de empresa que não existe/não é visível (RLS já filtrou)', async () => {
    const service = new ContactService(new PolicyService());
    const tx = fakeTx({ company: null });
    await expect(service.list(tx, membership(), COMPANY_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404 ao listar contatos de empresa soft-deletada', async () => {
    const service = new ContactService(new PolicyService());
    const tx = fakeTx({ company: { id: COMPANY_ID, deletedAt: new Date() } });
    await expect(service.list(tx, membership(), COMPANY_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cria contato vinculado à empresa e ao workspace do membership (sales_rep pode inserir)', async () => {
    const service = new ContactService(new PolicyService());
    const tx = fakeTx();
    const created = await service.create(
      tx,
      membership({ role: 'sales_rep' }),
      COMPANY_ID,
      {
        nome: 'Jonas Becker',
        cargo: 'Comprador',
      },
    );
    expect(created).toMatchObject({
      workspaceId: WORKSPACE_ID,
      companyId: COMPANY_ID,
      nome: 'Jonas Becker',
      cargo: 'Comprador',
      decisor: false,
      // Dono do contato (2026-08-06) — sempre quem criou.
      ownerUserId: 'user-1',
    });
  });

  // Empresa compartilhada entre dois representantes (2026-08-06) — cada um
  // só vê os PRÓPRIOS contatos, não os do outro (mesmo escopo já aplicado
  // a Activity/Task/Opportunity).
  describe('list — escopo por dono (empresa compartilhada, 2026-08-06)', () => {
    it('sales_rep: filtra contatos pelo próprio ownerUserId', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx();
      await service.list(
        tx,
        membership({ role: 'sales_rep', userId: 'user-1' }),
        COMPANY_ID,
      );
      expect(
        (tx.contact.findMany as jest.Mock).mock.calls[0][0].where,
      ).toMatchObject({
        companyId: COMPANY_ID,
        ownerUserId: 'user-1',
      });
    });

    it('owner/admin: sem filtro de dono (vê contatos de todo mundo)', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx();
      await service.list(tx, membership({ role: 'admin' }), COMPANY_ID);
      expect((tx.contact.findMany as jest.Mock).mock.calls[0][0].where).toEqual(
        {
          companyId: COMPANY_ID,
        },
      );
    });
  });

  // Prévia em lote (2026-08-07) — coluna "Contatos" da Prospecção.
  describe('listByCompanyIds', () => {
    it('devolve [] sem consultar o banco quando a lista de empresas vem vazia', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx();
      await expect(
        service.listByCompanyIds(tx, membership({ role: 'admin' }), []),
      ).resolves.toEqual([]);
      expect(tx.contact.findMany).not.toHaveBeenCalled();
    });

    it('sales_rep: filtra por companyId IN (...) e pelo próprio ownerUserId', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx();
      await service.listByCompanyIds(
        tx,
        membership({ role: 'sales_rep', userId: 'user-1' }),
        ['company-1', 'company-2'],
      );
      expect(
        (tx.contact.findMany as jest.Mock).mock.calls[0][0].where,
      ).toMatchObject({
        workspaceId: WORKSPACE_ID,
        companyId: { in: ['company-1', 'company-2'] },
        ownerUserId: 'user-1',
      });
    });

    it('admin: sem filtro de dono (vê contatos de todo mundo nas empresas pedidas)', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx();
      await service.listByCompanyIds(tx, membership({ role: 'admin' }), [
        'company-1',
      ]);
      expect((tx.contact.findMany as jest.Mock).mock.calls[0][0].where).toEqual(
        {
          workspaceId: WORKSPACE_ID,
          companyId: { in: ['company-1'] },
        },
      );
    });
  });

  it('cria contato marcado como tomador de decisão', async () => {
    const service = new ContactService(new PolicyService());
    const tx = fakeTx();
    const created = await service.create(
      tx,
      membership({ role: 'sales_rep' }),
      COMPANY_ID,
      {
        nome: 'Ricardo Menezes',
        decisor: true,
      },
    );
    expect(created).toMatchObject({ decisor: true });
  });

  describe('update — só owner/admin (2026-08-03: sales_rep só vê/insere)', () => {
    it('CRÍTICO: sales_rep não pode editar contato', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({
        contact: { id: 'contact-1', companyId: COMPANY_ID },
      });
      await expect(
        service.update(
          tx,
          membership({ role: 'sales_rep' }),
          COMPANY_ID,
          'contact-1',
          {
            nome: 'Novo nome',
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('CRÍTICO: manager não pode editar contato (só owner/admin, não o mesmo bypass de RLS)', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({
        contact: { id: 'contact-1', companyId: COMPANY_ID },
      });
      await expect(
        service.update(
          tx,
          membership({ role: 'manager' }),
          COMPANY_ID,
          'contact-1',
          {
            nome: 'Novo nome',
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin pode editar contato', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({
        contact: { id: 'contact-1', companyId: COMPANY_ID },
      });
      const updated = await service.update(
        tx,
        membership({ role: 'admin' }),
        COMPANY_ID,
        'contact-1',
        { nome: 'Novo nome' },
      );
      expect(updated).toMatchObject({ nome: 'Novo nome' });
    });

    it('owner pode editar contato', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({
        contact: { id: 'contact-1', companyId: COMPANY_ID },
      });
      const updated = await service.update(
        tx,
        membership({ role: 'owner' }),
        COMPANY_ID,
        'contact-1',
        { cargo: 'Diretor' },
      );
      expect(updated).toMatchObject({ cargo: 'Diretor' });
    });

    it('404 ao editar contato inexistente (mesmo sendo admin)', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx();
      await expect(
        service.update(
          tx,
          membership({ role: 'admin' }),
          COMPANY_ID,
          'contact-x',
          {
            nome: 'X',
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('404 (empresa) tem prioridade sobre 403 (papel) — não revela existência do contato', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({ company: null });
      await expect(
        service.update(
          tx,
          membership({ role: 'sales_rep' }),
          COMPANY_ID,
          'contact-1',
          {
            nome: 'X',
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove — só owner/admin (2026-08-03: sales_rep só vê/insere)', () => {
    it('404 ao remover contato inexistente', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx();
      await expect(
        service.remove(
          tx,
          membership({ role: 'admin' }),
          COMPANY_ID,
          'contact-x',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('CRÍTICO: sales_rep não pode remover contato', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({
        contact: { id: 'contact-1', companyId: COMPANY_ID },
      });
      await expect(
        service.remove(
          tx,
          membership({ role: 'sales_rep' }),
          COMPANY_ID,
          'contact-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin remove contato existente', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({
        contact: { id: 'contact-1', companyId: COMPANY_ID },
      });
      await expect(
        service.remove(
          tx,
          membership({ role: 'admin' }),
          COMPANY_ID,
          'contact-1',
        ),
      ).resolves.toBeUndefined();
    });

    it('owner remove contato existente', async () => {
      const service = new ContactService(new PolicyService());
      const tx = fakeTx({
        contact: { id: 'contact-1', companyId: COMPANY_ID },
      });
      await expect(
        service.remove(
          tx,
          membership({ role: 'owner' }),
          COMPANY_ID,
          'contact-1',
        ),
      ).resolves.toBeUndefined();
    });
  });
});
