import { BadRequestException } from '@nestjs/common';
import { ActivityService } from '../activities/activity.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { TaskService } from './task.service';

const WORKSPACE_ID = 'workspace-1';
const USER_ID = 'user-1';
const COMPANY_ID = 'company-1';
const CONTACT_ID = 'contact-1';

function membership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: 'owner',
    status: 'active',
    ...overrides,
  };
}

function fakeTx(): TenantTx {
  return {
    membership: {
      findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: COMPANY_ID, deletedAt: null }),
    },
    contact: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: CONTACT_ID, deletedAt: null }),
    },
    opportunity: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    task: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'task-1', ...data }),
        ),
    },
    activity: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService(new PolicyService(), new ActivityService());
  });

  describe('create — relação polimórfica exatamente um', () => {
    it('aceita quando exatamente um alvo é informado', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Ligar pro cliente',
          companyId: COMPANY_ID,
        }),
      ).resolves.toBeDefined();
    });

    it('CRÍTICO: rejeita quando nenhum alvo é informado (0 de 3)', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Tarefa sem alvo',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CRÍTICO: rejeita quando mais de um alvo é informado (2 de 3)', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Tarefa ambígua',
          companyId: COMPANY_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
