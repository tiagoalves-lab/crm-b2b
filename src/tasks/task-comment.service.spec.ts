import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { TaskCommentService } from './task-comment.service';
import type { TaskService } from './task.service';

const WORKSPACE_ID = 'workspace-1';
const TASK_ID = 'task-1';

function membership(overrides: Partial<MembershipContext> = {}): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    role: 'sales_rep',
    status: 'active',
    ...overrides,
  };
}

function fakeTaskService(): TaskService {
  return {
    mustBeVisible: jest.fn().mockResolvedValue({ id: TASK_ID }),
  } as unknown as TaskService;
}

function fakeTx(comment?: { id: string; taskId: string; authorUserId: string }): TenantTx {
  return {
    taskComment: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'comment-1', ...data }),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(comment && where.id === comment.id ? comment : null),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('TaskCommentService', () => {
  it('cria comentário verificando visibilidade de leitura (não escrita)', async () => {
    const taskService = fakeTaskService();
    const service = new TaskCommentService(taskService);
    const tx = fakeTx();
    await service.create(tx, membership(), TASK_ID, { body: 'oi' });
    expect(taskService.mustBeVisible).toHaveBeenCalledWith(
      tx,
      membership(),
      TASK_ID,
      'read',
    );
  });

  it('404 ao remover comentário inexistente', async () => {
    const service = new TaskCommentService(fakeTaskService());
    const tx = fakeTx();
    await expect(
      service.remove(tx, membership(), TASK_ID, 'comment-x'),
    ).rejects.toThrow(NotFoundException);
  });

  it('CRÍTICO: só o autor pode remover o próprio comentário', async () => {
    const comment = { id: 'comment-1', taskId: TASK_ID, authorUserId: 'outro-user' };
    const service = new TaskCommentService(fakeTaskService());
    const tx = fakeTx(comment);
    await expect(
      service.remove(tx, membership({ userId: 'user-1' }), TASK_ID, 'comment-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permite ao autor remover o próprio comentário', async () => {
    const comment = { id: 'comment-1', taskId: TASK_ID, authorUserId: 'user-1' };
    const service = new TaskCommentService(fakeTaskService());
    const tx = fakeTx(comment);
    await expect(
      service.remove(tx, membership({ userId: 'user-1' }), TASK_ID, 'comment-1'),
    ).resolves.toBeUndefined();
  });
});
