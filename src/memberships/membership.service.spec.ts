import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Membership } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { MembershipService } from './membership.service';

const WORKSPACE_ID = 'workspace-1';

function callerMembership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-owner',
    workspaceId: WORKSPACE_ID,
    userId: 'user-owner',
    role: 'owner',
    status: 'active',
    ...overrides,
  };
}

function targetRow(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'membership-target',
    workspaceId: WORKSPACE_ID,
    userId: 'user-target',
    role: 'owner',
    status: 'active',
    managerId: null,
    invitedBy: null,
    joinedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeTx(
  options: { target?: Membership; activeOwnerCount?: number } = {},
): TenantTx {
  const target = options.target ?? targetRow();
  return {
    membership: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) => {
          if (where.id === target.id) return Promise.resolve(target);
          return Promise.resolve(null);
        }),
      count: jest.fn().mockResolvedValue(options.activeOwnerCount ?? 1),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...target, ...data }),
        ),
    },
  } as unknown as TenantTx;
}

describe('MembershipService', () => {
  let service: MembershipService;

  beforeEach(() => {
    service = new MembershipService();
  });

  it('rejeita quem não é owner/admin', async () => {
    const tx = fakeTx();
    await expect(
      service.update(
        tx,
        callerMembership({ role: 'sales_rep' }),
        'membership-target',
        {
          role: 'manager',
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejeita gerente que é o próprio membro', async () => {
    const tx = fakeTx();
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        managerId: 'membership-target',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRÍTICO: bloqueia rebaixar o último owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 1 });
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        role: 'sales_rep',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRÍTICO: bloqueia suspender o último owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 1 });
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        status: 'suspended',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('permite rebaixar owner quando existe outro owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 2 });
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        role: 'manager',
      }),
    ).resolves.toBeDefined();
  });

  it('permite promover sales_rep pra manager e setar managerId', async () => {
    const tx = fakeTx({
      target: targetRow({ role: 'sales_rep' }),
      activeOwnerCount: 1,
    });
    (tx.membership.findFirst as jest.Mock).mockImplementation(
      ({ where }: { where: { id?: string; status?: string } }) => {
        if (where.id === 'membership-target') {
          return Promise.resolve(targetRow({ role: 'sales_rep' }));
        }
        if (where.id === 'membership-owner') {
          return Promise.resolve(targetRow({ id: 'membership-owner' }));
        }
        return Promise.resolve(null);
      },
    );
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        role: 'manager',
        managerId: 'membership-owner',
      }),
    ).resolves.toBeDefined();
  });
});
