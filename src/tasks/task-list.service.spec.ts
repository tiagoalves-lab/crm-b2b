import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { TaskList } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { TaskListService } from './task-list.service';

const WORKSPACE_ID = 'workspace-1';

function membership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    role: 'owner',
    status: 'active',
    ...overrides,
  };
}

function listRow(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    workspaceId: WORKSPACE_ID,
    name: 'A fazer',
    order: 0,
    isDoneList: false,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeTx(
  options: { lists?: TaskList[]; tasksInList?: number } = {},
): TenantTx {
  const lists = options.lists ?? [listRow()];
  return {
    taskList: {
      findMany: jest.fn().mockResolvedValue(lists),
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(lists.find((l) => l.id === where.id) ?? null),
        ),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'new-list', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...lists[0], ...data }),
        ),
      delete: jest.fn().mockResolvedValue(lists[0]),
      count: jest.fn().mockResolvedValue(lists.length),
    },
    task: {
      count: jest.fn().mockResolvedValue(options.tasksInList ?? 0),
    },
  } as unknown as TenantTx;
}

describe('TaskListService', () => {
  let service: TaskListService;

  beforeEach(() => {
    service = new TaskListService();
  });

  it('bootstrap: cria as 3 colunas padrão quando não existe nenhuma', async () => {
    const tx = fakeTx({ lists: [] });
    (tx.taskList.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        listRow({ name: 'A fazer', order: 0 }),
        listRow({ id: 'list-2', name: 'Em andamento', order: 1 }),
        listRow({ id: 'list-3', name: 'Concluída', order: 2, isDoneList: true }),
      ]);
    const result = await service.ensureDefaultLists(tx, WORKSPACE_ID);
    expect(tx.taskList.createMany).toHaveBeenCalled();
    expect(result).toHaveLength(3);
  });

  it('bootstrap: não cria de novo se já existem colunas', async () => {
    const tx = fakeTx();
    const result = await service.ensureDefaultLists(tx, WORKSPACE_ID);
    expect(tx.taskList.createMany).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('rejeita quem não é owner/admin criando coluna', async () => {
    const tx = fakeTx();
    await expect(
      service.create(tx, membership({ role: 'sales_rep' }), {
        name: 'Revisão',
        order: 1,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('CRÍTICO: bloqueia remover a última coluna do workspace', async () => {
    const tx = fakeTx({ lists: [listRow()] });
    await expect(
      service.remove(tx, membership(), 'list-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('bloqueia remover coluna que ainda tem tarefas', async () => {
    const tx = fakeTx({
      lists: [listRow(), listRow({ id: 'list-2' })],
      tasksInList: 2,
    });
    await expect(
      service.remove(tx, membership(), 'list-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('permite remover coluna vazia quando há outra coluna', async () => {
    const tx = fakeTx({
      lists: [listRow(), listRow({ id: 'list-2' })],
      tasksInList: 0,
    });
    await expect(
      service.remove(tx, membership(), 'list-1'),
    ).resolves.toBeUndefined();
  });
});
