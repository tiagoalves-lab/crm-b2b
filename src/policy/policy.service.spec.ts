import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { PermissionMatrix } from './permission-catalog';
import { PolicyService } from './policy.service';

function membership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    role: 'sales_rep',
    status: 'active',
    permissions: null,
    ...overrides,
  };
}

function fakeTx(
  subordinateUserIds: string[] = [],
  companyVisible = false,
): TenantTx {
  return {
    membership: {
      findMany: jest
        .fn()
        .mockResolvedValue(subordinateUserIds.map((userId) => ({ userId }))),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue(companyVisible ? { id: 'company-1' } : null),
    },
  } as unknown as TenantTx;
}

describe('PolicyService', () => {
  let policy: PolicyService;

  beforeEach(() => {
    policy = new PolicyService();
  });

  describe('can', () => {
    it('owner e admin podem agir sobre qualquer recurso, mesmo sem ser dono', async () => {
      const tx = fakeTx();
      for (const role of ['owner', 'admin'] as const) {
        const m = membership({ role, userId: 'user-1' });
        await expect(
          policy.can(
            tx,
            m,
            'write',
            { ownerUserId: 'outra-pessoa' },
            'empresas_cadastro',
          ),
        ).resolves.toBe(true);
      }
    });

    it('sales_rep só pode agir sobre o próprio registro (dentro do que a matriz permite)', async () => {
      const tx = fakeTx();
      const m = membership({ role: 'sales_rep', userId: 'user-1' });
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'outra-pessoa' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
    });

    it('readonly só lê o próprio registro, nunca escreve', async () => {
      const tx = fakeTx();
      const m = membership({ role: 'readonly', userId: 'user-1' });
      await expect(
        policy.can(
          tx,
          m,
          'read',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
      await expect(
        policy.can(
          tx,
          m,
          'read',
          { ownerUserId: 'outra-pessoa' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
    });

    it('manager vê o próprio registro e o dos subordinados, não de terceiros', async () => {
      const tx = fakeTx(['subordinado-1']);
      const m = membership({
        role: 'manager',
        id: 'membership-manager',
        userId: 'user-1',
      });
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'subordinado-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'outra-pessoa' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
    });

    it('CRÍTICO: sales_rep nunca exclui por padrão, nem o próprio registro (2026-08-06)', async () => {
      const tx = fakeTx();
      const m = membership({ role: 'sales_rep', userId: 'user-1' });
      // 'write' continua liberado pro próprio registro (editar não é apagar).
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
      await expect(
        policy.can(
          tx,
          m,
          'delete',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
    });

    it('owner/admin/manager continuam podendo excluir', async () => {
      const tx = fakeTx(['subordinado-1']);
      for (const role of ['owner', 'admin'] as const) {
        const m = membership({ role, userId: 'user-1' });
        await expect(
          policy.can(
            tx,
            m,
            'delete',
            { ownerUserId: 'outra-pessoa' },
            'empresas_cadastro',
          ),
        ).resolves.toBe(true);
      }
      const manager = membership({
        role: 'manager',
        id: 'membership-manager',
        userId: 'user-1',
      });
      await expect(
        policy.can(
          tx,
          manager,
          'delete',
          { ownerUserId: 'subordinado-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
    });

    it('matriz customizada (Membership.permissions) sobrepõe o preset do papel', async () => {
      const tx = fakeTx();
      const matrix: PermissionMatrix = {
        empresas_cadastro: {
          ver: true,
          criar: true,
          editar: true,
          excluir: true,
        },
      };
      // sales_rep normalmente nunca exclui — com override explícito, pode.
      const m = membership({
        role: 'sales_rep',
        userId: 'user-1',
        permissions: matrix,
      });
      await expect(
        policy.can(
          tx,
          m,
          'delete',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
    });

    it('matriz customizada também pode restringir abaixo do preset do papel', async () => {
      const tx = fakeTx();
      const matrix: PermissionMatrix = {
        empresas_cadastro: {
          ver: true,
          criar: false,
          editar: false,
          excluir: false,
        },
      };
      const m = membership({
        role: 'sales_rep',
        userId: 'user-1',
        permissions: matrix,
      });
      // Preset de sales_rep permite 'write' no próprio — override desliga.
      await expect(
        policy.can(
          tx,
          m,
          'write',
          { ownerUserId: 'user-1' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
    });

    it('owner/admin ignoram a matriz — bypass mesmo com tudo desligado', async () => {
      const tx = fakeTx();
      const matrix: PermissionMatrix = {
        empresas_cadastro: {
          ver: false,
          criar: false,
          editar: false,
          excluir: false,
        },
      };
      const m = membership({
        role: 'admin',
        userId: 'user-1',
        permissions: matrix,
      });
      await expect(
        policy.can(
          tx,
          m,
          'delete',
          { ownerUserId: 'outra-pessoa' },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
    });
  });

  describe('canModule', () => {
    it('owner/admin sempre true, mesmo sem matriz', () => {
      for (const role of ['owner', 'admin'] as const) {
        const m = membership({ role, permissions: null });
        expect(policy.canModule(m, 'membros', 'excluir')).toBe(true);
      }
    });

    it('cai pro preset do papel quando permissions é null', () => {
      const manager = membership({ role: 'manager', permissions: null });
      expect(policy.canModule(manager, 'membros', 'criar')).toBe(true);
      const salesRep = membership({ role: 'sales_rep', permissions: null });
      expect(policy.canModule(salesRep, 'membros', 'criar')).toBe(false);
    });

    it('valor explícito na matriz sempre vence o preset, mesmo com false', () => {
      const m = membership({
        role: 'manager',
        permissions: { membros: { criar: false } },
      });
      expect(policy.canModule(m, 'membros', 'criar')).toBe(false);
    });
  });

  describe('assertCanDelete', () => {
    it('lança ForbiddenException pra sales_rep (preset sem excluir)', () => {
      expect(() =>
        policy.assertCanDelete(membership({ role: 'sales_rep' }), 'tarefas'),
      ).toThrow('Sem permissão para excluir neste módulo.');
    });

    it('lança também pra readonly (preset só de leitura)', () => {
      expect(() =>
        policy.assertCanDelete(membership({ role: 'readonly' }), 'tarefas'),
      ).toThrow();
    });

    it('não lança pra owner/admin/manager (bypass ou preset com excluir)', () => {
      for (const role of ['owner', 'admin', 'manager'] as const) {
        expect(() =>
          policy.assertCanDelete(membership({ role }), 'tarefas'),
        ).not.toThrow();
      }
    });

    it('matriz customizada pode liberar excluir pra sales_rep', () => {
      expect(() =>
        policy.assertCanDelete(
          membership({
            role: 'sales_rep',
            permissions: { tarefas: { excluir: true } },
          }),
          'tarefas',
        ),
      ).not.toThrow();
    });
  });

  describe('scopeFilter', () => {
    it('owner e admin não têm filtro (veem tudo do workspace)', async () => {
      const tx = fakeTx();
      await expect(
        policy.scopeFilter(tx, membership({ role: 'owner' })),
      ).resolves.toEqual({});
      await expect(
        policy.scopeFilter(tx, membership({ role: 'admin' })),
      ).resolves.toEqual({});
    });

    it('sales_rep e readonly são filtrados pelo próprio userId', async () => {
      const tx = fakeTx();
      await expect(
        policy.scopeFilter(
          tx,
          membership({ role: 'sales_rep', userId: 'user-1' }),
        ),
      ).resolves.toEqual({ ownerUserId: 'user-1' });
      await expect(
        policy.scopeFilter(
          tx,
          membership({ role: 'readonly', userId: 'user-1' }),
        ),
      ).resolves.toEqual({ ownerUserId: 'user-1' });
    });

    it('manager é filtrado por si mais os subordinados', async () => {
      const tx = fakeTx(['subordinado-1', 'subordinado-2']);
      const m = membership({
        role: 'manager',
        id: 'membership-manager',
        userId: 'user-1',
      });
      await expect(policy.scopeFilter(tx, m)).resolves.toEqual({
        ownerUserId: { in: ['user-1', 'subordinado-1', 'subordinado-2'] },
      });
    });
  });

  // Bug de 2026-09-02: manager via a empresa na lista, mas a Timeline da
  // ficha ainda usava can() e devolvia 404 pra empresa sem dono (as
  // vindas do eGestor) — a ficha inteira caía. canReadCompany() é a regra
  // única de leitura de Company, a mesma da lista.
  describe('canReadCompany', () => {
    it('manager enxerga qualquer empresa do workspace, sem consultar o banco', async () => {
      const tx = fakeTx();
      const m = membership({ role: 'manager', userId: 'user-1' });
      await expect(policy.canReadCompany(tx, m, 'company-1')).resolves.toBe(
        true,
      );
      expect(tx.company.findFirst).not.toHaveBeenCalled();
    });

    it('owner e admin enxergam qualquer empresa', async () => {
      for (const role of ['owner', 'admin'] as const) {
        await expect(
          policy.canReadCompany(fakeTx(), membership({ role }), 'company-1'),
        ).resolves.toBe(true);
      }
    });

    it('sales_rep depende do filtro: dono, oportunidade própria ou acesso concedido', async () => {
      const m = membership({ role: 'sales_rep', userId: 'user-1' });
      await expect(
        policy.canReadCompany(fakeTx([], true), m, 'company-1'),
      ).resolves.toBe(true);

      const txInvisivel = fakeTx([], false);
      await expect(
        policy.canReadCompany(txInvisivel, m, 'company-1'),
      ).resolves.toBe(false);
      expect(txInvisivel.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'company-1',
            workspaceId: 'workspace-1',
            OR: [
              { ownerUserId: 'user-1' },
              { opportunities: { some: { ownerUserId: 'user-1' } } },
              { accessGrants: { some: { userId: { in: ['user-1'] } } } },
            ],
          },
        }),
      );
    });

    it('sem "ver" em empresas_cadastro ninguém enxerga, nem manager', async () => {
      const m = membership({
        role: 'manager',
        permissions: { empresas_cadastro: { ver: false } },
      });
      await expect(
        policy.canReadCompany(fakeTx([], true), m, 'company-1'),
      ).resolves.toBe(false);
    });
  });
});
