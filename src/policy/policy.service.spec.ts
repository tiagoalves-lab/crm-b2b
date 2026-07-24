import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
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
    ...overrides,
  };
}

function fakeTx(subordinateUserIds: string[] = []): TenantTx {
  return {
    membership: {
      findMany: jest
        .fn()
        .mockResolvedValue(subordinateUserIds.map((userId) => ({ userId }))),
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
          policy.can(tx, m, 'write', { ownerUserId: 'outra-pessoa' }),
        ).resolves.toBe(true);
      }
    });

    it('sales_rep só pode agir sobre o próprio registro', async () => {
      const tx = fakeTx();
      const m = membership({ role: 'sales_rep', userId: 'user-1' });
      await expect(
        policy.can(tx, m, 'write', { ownerUserId: 'user-1' }),
      ).resolves.toBe(true);
      await expect(
        policy.can(tx, m, 'write', { ownerUserId: 'outra-pessoa' }),
      ).resolves.toBe(false);
    });

    it('readonly só lê o próprio registro, nunca escreve', async () => {
      const tx = fakeTx();
      const m = membership({ role: 'readonly', userId: 'user-1' });
      await expect(
        policy.can(tx, m, 'read', { ownerUserId: 'user-1' }),
      ).resolves.toBe(true);
      await expect(
        policy.can(tx, m, 'write', { ownerUserId: 'user-1' }),
      ).resolves.toBe(false);
      await expect(
        policy.can(tx, m, 'read', { ownerUserId: 'outra-pessoa' }),
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
        policy.can(tx, m, 'write', { ownerUserId: 'user-1' }),
      ).resolves.toBe(true);
      await expect(
        policy.can(tx, m, 'write', { ownerUserId: 'subordinado-1' }),
      ).resolves.toBe(true);
      await expect(
        policy.can(tx, m, 'write', { ownerUserId: 'outra-pessoa' }),
      ).resolves.toBe(false);
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
});
