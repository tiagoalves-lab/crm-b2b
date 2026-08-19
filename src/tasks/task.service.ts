import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  Task,
  TaskChecklistItem,
  TaskComment,
} from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import { assertActiveMembership } from '../common/assert-active-membership';
import type { PaginatedResult } from '../companies/company.service';
import { PolicyService } from '../policy/policy.service';
import type { OwnerScopeFilter } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import { CONTACT_REQUIRED_TASK_TYPES } from './task-type.constants';

const NO_MATCH_SENTINEL = '__none__';

export type TaskWithDetails = Task & {
  checklistItems: TaskChecklistItem[];
  comments: TaskComment[];
};

// Contagens pra tela de lista (SPEC-CRM-GAMA.md §4.3: "ícones de
// contagem de anexos/comentários") — sem trazer os itens inteiros, só o
// total, bem mais barato que TaskWithDetails pra uma listagem paginada.
export type TaskWithCounts = Task & {
  _count: { checklistItems: number; comments: number; attachments: number };
};

@Injectable()
export class TaskService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateTaskDto,
  ): Promise<Task> {
    if (!this.policy.canModule(membership, 'tarefas', 'criar')) {
      throw new ForbiddenException('Sem permissão para criar tarefas.');
    }

    const assigneeUserId = dto.assigneeUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, assigneeUserId);
    await this.mustTargetExist(tx, membership.workspaceId, dto);

    if (
      dto.tipo &&
      CONTACT_REQUIRED_TASK_TYPES.includes(dto.tipo) &&
      !dto.contactId
    ) {
      throw new BadRequestException(
        'Contato é obrigatório para tarefas do tipo ligação, reunião, visita ou e-mail.',
      );
    }
    if (dto.contactId) {
      const companyId = await this.resolveCompanyId(
        tx,
        membership.workspaceId,
        dto.companyId,
        dto.opportunityId,
      );
      await this.mustContactBelongToCompany(
        tx,
        membership.workspaceId,
        dto.contactId,
        companyId,
      );
    }

    const task = await tx.task.create({
      data: {
        workspaceId: membership.workspaceId,
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        tipo: dto.tipo,
        contactId: dto.contactId,
        assigneeUserId,
        companyId: dto.companyId,
        opportunityId: dto.opportunityId,
        createdBy: membership.userId,
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'created', title: task.title, taskId: task.id },
      companyId: dto.companyId,
      opportunityId: dto.opportunityId,
    });

    return task;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListTasksQueryDto,
  ): Promise<PaginatedResult<TaskWithCounts>> {
    // Filtrado por empresa (aba "Tarefas" da ficha) usa a permissão
    // própria empresas_tarefas — separada da tela geral de Tarefas
    // (2026-08-12, pedido do usuário). Só o 'ver' tem efeito próprio aqui:
    // criar/editar/excluir uma tarefa específica sempre passam pelo módulo
    // global 'tarefas' (ver mustBeVisible), não importa de onde a lista
    // foi aberta — não dá pra saber com segurança "veio da ficha" num
    // GET/PATCH/DELETE por id.
    const viewModule = query.companyId ? 'empresas_tarefas' : 'tarefas';
    if (!this.policy.canModule(membership, viewModule, 'ver')) {
      throw new ForbiddenException('Sem permissão para ver tarefas.');
    }
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
        include: {
          _count: {
            select: { checklistItems: true, comments: true, attachments: true },
          },
        },
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

    const effectiveTipo = dto.tipo !== undefined ? dto.tipo : existing.tipo;
    const effectiveContactId =
      dto.contactId !== undefined ? dto.contactId : existing.contactId;
    if (
      effectiveTipo &&
      CONTACT_REQUIRED_TASK_TYPES.includes(effectiveTipo) &&
      !effectiveContactId
    ) {
      throw new BadRequestException(
        'Contato é obrigatório para tarefas do tipo ligação, reunião, visita ou e-mail.',
      );
    }
    if (dto.contactId) {
      const companyId = await this.resolveCompanyId(
        tx,
        membership.workspaceId,
        existing.companyId ?? undefined,
        existing.opportunityId ?? undefined,
      );
      await this.mustContactBelongToCompany(
        tx,
        membership.workspaceId,
        dto.contactId,
        companyId,
      );
    }

    const updated = await tx.task.update({
      where: { id: existing.id },
      data: {
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        tipo: dto.tipo,
        contactId: dto.contactId,
        status: dto.status,
        assigneeUserId: dto.assigneeUserId,
      },
    });

    // Só emite Activity na conclusão — edits triviais de título/data não
    // valem virar entrada no log (poluiria a timeline sem agregar nada).
    if (dto.status === 'done' && existing.status !== 'done') {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: {
          action: 'completed',
          title: updated.title,
          taskId: updated.id,
        },
        companyId: existing.companyId ?? undefined,
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
    const existing = await this.mustBeVisible(tx, membership, id, 'delete');
    // Sem soft delete — Task não tem deletedAt no schema, e
    // docs/arquitetura-dados.md só pede soft delete pra
    // Company/Opportunity. Assimetria intencional, não descuido.
    await tx.task.delete({ where: { id: existing.id } });
  }

  private async mustTargetExist(
    tx: TenantTx,
    workspaceId: string,
    dto: Pick<CreateTaskDto, 'companyId' | 'opportunityId'>,
  ): Promise<void> {
    // Defesa em profundidade independente do decorator @ExactlyOneOf do
    // DTO (que já bloqueia isso na borda HTTP) — mesmo princípio aplicado
    // em OpportunityService pra lost/lostReason: o service nunca confia
    // só na validação de entrada.
    const targets = [dto.companyId, dto.opportunityId].filter(
      (value) => value !== undefined,
    );
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Exatamente um de companyId/opportunityId deve ser informado.',
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
  // testado e usado por Company/Opportunity com o nome real).
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
    action: 'read' | 'write' | 'delete' = 'read',
  ): Promise<Task> {
    const task = await tx.task.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    if (
      !(await this.policy.can(
        tx,
        membership,
        action,
        { ownerUserId: task.assigneeUserId },
        'tarefas',
      ))
    ) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    return task;
  }

  // Contact é escopado por company (companyId obrigatório na tabela
  // contacts) — uma tarefa vinculada via opportunity precisa resolver a
  // company por trás pra saber de qual agenda de contatos o contactId
  // enviado deveria vir.
  private async resolveCompanyId(
    tx: TenantTx,
    workspaceId: string,
    companyId?: string,
    opportunityId?: string,
  ): Promise<string | undefined> {
    if (companyId) return companyId;
    if (!opportunityId) return undefined;
    const opportunity = await tx.opportunity.findFirst({
      where: { id: opportunityId, workspaceId },
      select: { companyId: true },
    });
    return opportunity?.companyId;
  }

  private async mustContactBelongToCompany(
    tx: TenantTx,
    workspaceId: string,
    contactId: string,
    companyId: string | undefined,
  ): Promise<void> {
    const contact = companyId
      ? await tx.contact.findFirst({
          where: { id: contactId, workspaceId, companyId },
        })
      : null;
    if (!contact) {
      throw new BadRequestException(
        `Contato "${contactId}" não encontrado para a empresa desta tarefa.`,
      );
    }
  }
}
