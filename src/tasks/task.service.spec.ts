import { BadRequestException } from '@nestjs/common';
import { ActivityService } from '../activities/activity.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { TaskListService } from './task-list.service';
import { TaskService } from './task.service';

const WORKSPACE_ID = 'workspace-1';
const USER_ID = 'user-1';
const COMPANY_ID = 'company-1';
const OPPORTUNITY_ID = 'opportunity-1';
const LIST_ID = 'list-1';

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

const DONE_LIST_ID = 'list-done';

function fakeTx(options: { existingTask?: object } = {}): TenantTx {
  return {
    membership: {
      findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: COMPANY_ID, deletedAt: null }),
    },
    opportunity: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: OPPORTUNITY_ID, deletedAt: null }),
    },
    task: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'task-1', ...data }),
        ),
      findFirst: jest.fn().mockResolvedValue(options.existingTask ?? null),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...(options.existingTask ?? {}), ...data }),
        ),
    },
    taskList: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: LIST_ID,
          workspaceId: WORKSPACE_ID,
          name: 'A fazer',
          order: 0,
          isDoneList: false,
          createdAt: new Date(),
        },
      ]),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) => {
          if (where.id === LIST_ID) {
            return Promise.resolve({
              id: LIST_ID,
              workspaceId: WORKSPACE_ID,
              name: 'A fazer',
              order: 0,
              isDoneList: false,
              createdAt: new Date(),
            });
          }
          if (where.id === DONE_LIST_ID) {
            return Promise.resolve({
              id: DONE_LIST_ID,
              workspaceId: WORKSPACE_ID,
              name: 'Concluída',
              order: 2,
              isDoneList: true,
              createdAt: new Date(),
            });
          }
          return Promise.resolve(null);
        }),
    },
    activity: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService(
      new PolicyService(),
      new ActivityService(),
      new TaskListService(),
    );
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

    it('CRÍTICO: rejeita quando nenhum alvo é informado (0 de 2)', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Tarefa sem alvo',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CRÍTICO: rejeita quando mais de um alvo é informado (2 de 2)', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Tarefa ambígua',
          companyId: COMPANY_ID,
          opportunityId: OPPORTUNITY_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update — sincronização status ↔ coluna', () => {
    const existingTask = {
      id: 'task-1',
      workspaceId: WORKSPACE_ID,
      assigneeUserId: USER_ID,
      companyId: COMPANY_ID,
      opportunityId: null,
      listId: LIST_ID,
      status: 'pending',
      title: 'Ligar pro cliente',
    };

    it('mover pra coluna is_done_list marca status=done automaticamente', async () => {
      const tx = fakeTx({ existingTask });
      const updated = await service.update(tx, membership(), 'task-1', {
        listId: DONE_LIST_ID,
      });
      expect(updated.status).toBe('done');
    });

    it('sair de uma coluna is_done_list volta status pra pending', async () => {
      const tx = fakeTx({
        existingTask: { ...existingTask, listId: DONE_LIST_ID, status: 'done' },
      });
      const updated = await service.update(tx, membership(), 'task-1', {
        listId: LIST_ID,
      });
      expect(updated.status).toBe('pending');
    });

    it('status explícito vence o derivado da coluna', async () => {
      const tx = fakeTx({ existingTask });
      const updated = await service.update(tx, membership(), 'task-1', {
        listId: DONE_LIST_ID,
        status: 'pending',
      });
      expect(updated.status).toBe('pending');
    });

    it('rejeita mover pra coluna que não existe no workspace', async () => {
      const tx = fakeTx({ existingTask });
      await expect(
        service.update(tx, membership(), 'task-1', {
          listId: 'list-inexistente',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
