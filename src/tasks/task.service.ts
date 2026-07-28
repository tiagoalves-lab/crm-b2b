import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  Task,
  TaskChecklistItem,
  TaskComment,
  TaskList,
} from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import { assertActiveMembership } from '../common/assert-active-membership';
import type { PaginatedResult } from '../companies/company.service';
import { PolicyService } from '../policy/policy.service';
import type { OwnerScopeFilter } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { TaskListService } from './task-list.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';

const NO_MATCH_SENTINEL = '__none__';

export type TaskWithDetails = Task & {
  checklistItems: TaskChecklistItem[];
  comments: TaskComment[];
};

@Injectable()
export class TaskService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
    private readonly taskLists: TaskListService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateTaskDto,
  ): Promise<Task> {
    const assigneeUserId = dto.assigneeUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, assigneeUserId);
    await this.mustTargetExist(tx, membership.workspaceId, dto);

    const listId = dto.listId
      ? (await this.mustListExist(tx, membership.workspaceId, dto.listId)).id
      : (await this.taskLists.ensureDefaultLists(tx, membership.workspaceId))[0]
          .id;
    const position = await this.nextPosition(tx, listId);

    const task = await tx.task.create({
      data: {
        workspaceId: membership.workspaceId,
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        assigneeUserId,
        companyId: dto.companyId,
        contactId: dto.contactId,
        opportunityId: dto.opportunityId,
        listId,
        position,
        createdBy: membership.userId,
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'created', title: task.title },
      companyId: dto.companyId,
      contactId: dto.contactId,
      opportunityId: dto.opportunityId,
    });

    return task;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListTasksQueryDto,
  ): Promise<PaginatedResult<Task>> {
    const scope = await this.policy.scopeFilter(tx, membership);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const assigneeFilter = this.resolveAssigneeFilter(
      scope,
      query.assigneeUserId,
    );

    const where: Prisma.TaskWhereInput = {
      workspaceId: membership.workspaceId,
      ...(assigneeFilter !== undefined
        ? { assigneeUserId: assigneeFilter }
        : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.status ? { status: query.status } : {}),
      // overdue implica status=pending — vence quem passou overdue por
      // último, é o comportamento esperado (não dá pra estar overdue e
      // done ao mesmo tempo).
      ...(query.overdue
        ? { status: 'pending', dueAt: { lt: new Date() } }
        : {}),
    };

    const [items, total] = await Promise.all([
      tx.task.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      tx.task.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<TaskWithDetails> {
    await this.mustBeVisible(tx, membership, id);
    return tx.task.findUniqueOrThrow({
      where: { id },
      include: {
        checklistItems: { orderBy: { position: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    if (dto.assigneeUserId) {
      await assertActiveMembership(
        tx,
        membership.workspaceId,
        dto.assigneeUserId,
      );
    }

    let targetList: TaskList | undefined;
    if (dto.listId && dto.listId !== existing.listId) {
      targetList = await this.mustListExist(
        tx,
        membership.workspaceId,
        dto.listId,
      );
    }

    // Mover pra uma coluna is_done_list marca status=done automaticamente;
    // sair dela pra uma coluna comum volta pra pending. Um status
    // explícito no mesmo request sempre vence (ex.: reabrir uma tarefa
    // concluída sem precisar mover ela de coluna ao mesmo tempo).
    const derivedStatus =
      dto.status ?? (targetList ? (targetList.isDoneList ? 'done' : 'pending') : undefined);

    const updated = await tx.task.update({
      where: { id: existing.id },
      data: {
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        status: derivedStatus,
        assigneeUserId: dto.assigneeUserId,
        listId: dto.listId,
        position: dto.position,
      },
    });

    // Só emite Activity na conclusão — edits triviais de título/data não
    // valem virar entrada no log (poluiria a timeline sem agregar nada).
    if (derivedStatus === 'done' && existing.status !== 'done') {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: { action: 'completed', title: updated.title },
        companyId: existing.companyId ?? undefined,
        contactId: existing.contactId ?? undefined,
        opportunityId: existing.opportunityId ?? undefined,
      });
    }

    return updated;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<void> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');
    // Sem soft delete — Task não tem deletedAt no schema, e
    // docs/arquitetura-dados.md só pede soft delete pra
    // Company/Contact/Opportunity. Assimetria intencional, não descuido.
    await tx.task.delete({ where: { id: existing.id } });
  }

  private async mustTargetExist(
    tx: TenantTx,
    workspaceId: string,
    dto: Pick<CreateTaskDto, 'companyId' | 'contactId' | 'opportunityId'>,
  ): Promise<void> {
    // Defesa em profundidade independente do decorator @ExactlyOneOf do
    // DTO (que já bloqueia isso na borda HTTP) — mesmo princípio aplicado
    // em OpportunityService pra lost/lostReason: o service nunca confia
    // só na validação de entrada.
    const targets = [dto.companyId, dto.contactId, dto.opportunityId].filter(
      (value) => value !== undefined,
    );
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Exatamente um de companyId/contactId/opportunityId deve ser informado.',
      );
    }

    if (dto.companyId) {
      const company = await tx.company.findFirst({
        where: { id: dto.companyId, workspaceId },
      });
      if (!company || company.deletedAt) {
        throw new BadRequestException(
          `Empresa "${dto.companyId}" não encontrada.`,
        );
      }
      return;
    }
    if (dto.contactId) {
      const contact = await tx.contact.findFirst({
        where: { id: dto.contactId, workspaceId },
      });
      if (!contact || contact.deletedAt) {
        throw new BadRequestException(
          `Contato "${dto.contactId}" não encontrado.`,
        );
      }
      return;
    }
    if (dto.opportunityId) {
      const opportunity = await tx.opportunity.findFirst({
        where: { id: dto.opportunityId, workspaceId },
      });
      if (!opportunity || opportunity.deletedAt) {
        throw new BadRequestException(
          `Oportunidade "${dto.opportunityId}" não encontrada.`,
        );
      }
    }
  }

  // PolicyService foi desenhado em torno de "ownerUserId" (Fase 2); Task
  // usa "assigneeUserId" com a mesma semântica de ownership — remapeado
  // aqui na borda em vez de generalizar o PolicyService (que já está
  // testado e usado por Company/Contact/Opportunity com o nome real).
  private resolveAssigneeFilter(
    scope: OwnerScopeFilter,
    requested?: string,
  ): string | { in: string[] } | undefined {
    if (scope.ownerUserId === undefined) {
      return requested;
    }
    if (requested === undefined) {
      return scope.ownerUserId;
    }
    const allowedIds =
      typeof scope.ownerUserId === 'string'
        ? [scope.ownerUserId]
        : scope.ownerUserId.in;
    return allowedIds.includes(requested) ? requested : NO_MATCH_SENTINEL;
  }

  // Público de propósito — TaskChecklistService/TaskCommentService
  // reusam essa checagem em vez de duplicar a regra de visibilidade
  // (ownership via PolicyService, mesmo critério de Task.update).
  async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' = 'read',
  ): Promise<Task> {
    const task = await tx.task.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    if (
      !(await this.policy.can(tx, membership, action, {
        ownerUserId: task.assigneeUserId,
      }))
    ) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    return task;
  }

  private async mustListExist(
    tx: TenantTx,
    workspaceId: string,
    listId: string,
  ): Promise<TaskList> {
    const list = await tx.taskList.findFirst({
      where: { id: listId, workspaceId },
    });
    if (!list) {
      throw new BadRequestException(`Coluna "${listId}" não encontrada.`);
    }
    return list;
  }

  private async nextPosition(tx: TenantTx, listId: string): Promise<number> {
    const last = await tx.task.findFirst({
      where: { listId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }
}
