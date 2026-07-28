import { NotFoundException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { TaskChecklistService } from './task-checklist.service';
import type { TaskService } from './task.service';

const WORKSPACE_ID = 'workspace-1';
const TASK_ID = 'task-1';

function membership(): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    role: 'sales_rep',
    status: 'active',
  };
}

function fakeTaskService(): TaskService {
  return {
    mustBeVisible: jest.fn().mockResolvedValue({ id: TASK_ID }),
  } as unknown as TaskService;
}

function fakeTx(item?: { id: string; taskId: string }): TenantTx {
  return {
    taskChecklistItem: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(item && where.id === item.id ? item : null),
        ),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'item-1', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'item-1', ...data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('TaskChecklistService', () => {
  it('cria item verificando visibilidade de escrita da task', async () => {
    const taskService = fakeTaskService();
    const service = new TaskChecklistService(taskService);
    const tx = fakeTx();
    await service.create(tx, membership(), TASK_ID, { text: 'Ligar' });
    expect(taskService.mustBeVisible).toHaveBeenCalledWith(
      tx,
      membership(),
      TASK_ID,
      'write',
    );
  });

  it('404 ao atualizar item que não pertence à task', async () => {
    const service = new TaskChecklistService(fakeTaskService());
    const tx = fakeTx();
    await expect(
      service.update(tx, membership(), TASK_ID, 'item-inexistente', {
        done: true,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('remove item existente', async () => {
    const item = { id: 'item-1', taskId: TASK_ID };
    const service = new TaskChecklistService(fakeTaskService());
    const tx = fakeTx(item);
    await expect(
      service.remove(tx, membership(), TASK_ID, 'item-1'),
    ).resolves.toBeUndefined();
  });
});
