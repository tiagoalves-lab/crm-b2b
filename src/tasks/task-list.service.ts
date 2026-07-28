import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TaskList } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateTaskListDto } from './dto/create-task-list.dto';
import type { UpdateTaskListDto } from './dto/update-task-list.dto';

// Mesmo critério do PipelineService pra Stage: colunas do Kanban são
// configuração de workspace, não dado transacional — leitura aberta,
// escrita (criar/editar/remover coluna) só owner/admin. Mover uma Task
// entre colunas existentes não passa por aqui — é só um update de Task.
const WRITE_ROLES = new Set(['owner', 'admin']);

const DEFAULT_LISTS: Array<{ name: string; order: number; isDoneList: boolean }> = [
  { name: 'A fazer', order: 0, isDoneList: false },
  { name: 'Em andamento', order: 1, isDoneList: false },
  { name: 'Concluída', order: 2, isDoneList: true },
];

@Injectable()
export class TaskListService {
  private assertCanWrite(membership: MembershipContext): void {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem alterar as colunas do quadro de tarefas.',
      );
    }
  }

  async findAll(tx: TenantTx, membership: MembershipContext): Promise<TaskList[]> {
    return this.ensureDefaultLists(tx, membership.workspaceId);
  }

  // Bootstrap preguiçoso, mesmo padrão do TenantMembershipGuard pro
  // primeiro Membership — sem isso, todo workspace novo precisaria de um
  // owner/admin criar as 3 colunas manualmente antes do quadro funcionar.
  async ensureDefaultLists(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<TaskList[]> {
    const existing = await tx.taskList.findMany({
      where: { workspaceId },
      orderBy: { order: 'asc' },
    });
    if (existing.length > 0) {
      return existing;
    }

    await tx.taskList.createMany({
      data: DEFAULT_LISTS.map((list) => ({ workspaceId, ...list })),
    });
    return tx.taskList.findMany({
      where: { workspaceId },
      orderBy: { order: 'asc' },
    });
  }

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateTaskListDto,
  ): Promise<TaskList> {
    this.assertCanWrite(membership);
    return tx.taskList.create({
      data: {
        workspaceId: membership.workspaceId,
        name: dto.name,
        order: dto.order,
        isDoneList: dto.isDoneList ?? false,
      },
    });
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateTaskListDto,
  ): Promise<TaskList> {
    this.assertCanWrite(membership);
    await this.mustExist(tx, membership.workspaceId, id);

    return tx.taskList.update({
      where: { id },
      data: {
        name: dto.name,
        order: dto.order,
        isDoneList: dto.isDoneList,
      },
    });
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<void> {
    this.assertCanWrite(membership);
    await this.mustExist(tx, membership.workspaceId, id);

    const remaining = await tx.taskList.count({
      where: { workspaceId: membership.workspaceId },
    });
    if (remaining <= 1) {
      throw new ConflictException(
        'O quadro precisa de pelo menos uma coluna — não é possível remover a última.',
      );
    }

    const inUse = await tx.task.count({ where: { listId: id } });
    if (inUse > 0) {
      throw new ConflictException(
        'Esta coluna ainda tem tarefas — mova-as antes de remover a coluna.',
      );
    }

    await tx.taskList.delete({ where: { id } });
  }

  private async mustExist(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<TaskList> {
    const list = await tx.taskList.findFirst({ where: { id, workspaceId } });
    if (!list) {
      throw new NotFoundException('Coluna não encontrada.');
    }
    return list;
  }
}
