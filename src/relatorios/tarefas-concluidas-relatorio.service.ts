import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { COMPANY_REF_SELECT, OPPORTUNITY_REF_SELECT } from '../companies/company-ref';
import type { CompanyRef } from '../companies/company-ref';
import type { TarefasConcluidasQueryDto } from './dto/tarefas-concluidas-query.dto';
import { periodoBrasilia } from './periodo-brasilia';

const LIMITE = 2000;

export interface TarefaConcluidaRow {
  id: string;
  concluidaEm: string;
  titulo: string;
  descricao: string | null;
  tipo: string | null;
  dueAt: string | null;
  assigneeUserId: string;
  company: CompanyRef | null;
}

export interface TarefasConcluidasRelatorio {
  rows: TarefaConcluidaRow[];
  total: number;
  truncado: boolean;
}

// Relatório "Tarefas concluídas" (pedido do usuário, 2026-09-23), da mais
// recente para a mais antiga.
//
// A data de conclusão NÃO é coluna de `tasks` — quando alguém conclui uma
// tarefa, o CRM grava um registro no log de atividades (desde a Fase 3,
// `field_update` com action `completed` e o id da tarefa). O relatório lê
// de lá: vale retroativamente para tudo que já foi concluído e dispensa
// uma coluna nova no banco. Tarefa concluída, reaberta e concluída de
// novo conta pela conclusão mais recente.
//
// Visibilidade: a mesma da tela de Tarefas (TaskService#findAll) —
// escopo por responsável, com o filtro do formulário estreitando, nunca
// ampliando.
@Injectable()
export class TarefasConcluidasRelatorioService {
  constructor(private readonly policy: PolicyService) {}

  async gerar(
    tx: TenantTx,
    membership: MembershipContext,
    query: TarefasConcluidasQueryDto,
  ): Promise<TarefasConcluidasRelatorio> {
    if (!this.policy.canModule(membership, 'tarefas', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver tarefas.');
    }

    const { de, ate } = periodoBrasilia(query.inicio, query.fim);

    const conclusoes = await tx.activity.findMany({
      where: {
        workspaceId: membership.workspaceId,
        type: 'field_update',
        occurredAt: { gte: de, lte: ate },
        AND: [
          { payload: { path: ['action'], equals: 'completed' } },
          { payload: { path: ['taskId'], string_starts_with: '' } },
        ],
      },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true, payload: true },
    });

    // Uma data por tarefa — a mais recente, que é a primeira da lista.
    const concluidaEm = new Map<string, Date>();
    for (const registro of conclusoes) {
      const taskId = (registro.payload as { taskId?: string })?.taskId;
      if (taskId && !concluidaEm.has(taskId)) {
        concluidaEm.set(taskId, registro.occurredAt);
      }
    }
    if (concluidaEm.size === 0) {
      return { rows: [], total: 0, truncado: false };
    }

    const scope = await this.policy.scopeFilter(tx, membership);
    const where: Prisma.TaskWhereInput = {
      workspaceId: membership.workspaceId,
      id: { in: [...concluidaEm.keys()] },
      // A tarefa tem que estar concluída HOJE: se foi reaberta depois, ela
      // não é uma tarefa concluída, por mais que o log guarde a conclusão
      // antiga.
      status: 'done',
      AND: [
        // Membro da tarefa (2026-09-29) também a enxerga, igual à tela
        // de Tarefas.
        ...(scope.ownerUserId !== undefined
          ? [
              {
                OR: [
                  { assigneeUserId: scope.ownerUserId },
                  {
                    memberUserIds: {
                      hasSome:
                        typeof scope.ownerUserId === 'string'
                          ? [scope.ownerUserId]
                          : scope.ownerUserId.in,
                    },
                  },
                ],
              },
            ]
          : []),
        ...(query.usuarioId ? [{ assigneeUserId: query.usuarioId }] : []),
      ],
      ...(query.tipo ? { tipo: query.tipo } : {}),
    };

    const tarefas = await tx.task.findMany({
      where,
      include: {
        company: { select: COMPANY_REF_SELECT },
        opportunity: { select: OPPORTUNITY_REF_SELECT },
      },
    });

    const empresaFiltro = query.empresa?.trim().toLowerCase();

    const rows = tarefas
      .map((t) => ({
        id: t.id,
        concluidaEm: (concluidaEm.get(t.id) as Date).toISOString(),
        titulo: t.title,
        descricao: t.description,
        tipo: t.tipo,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        assigneeUserId: t.assigneeUserId,
        company: t.company ?? t.opportunity?.company ?? null,
      }))
      .filter((r) =>
        empresaFiltro
          ? [r.company?.razaoSocial, r.company?.fantasia, r.company?.nomeParaContato]
              .filter((n): n is string => !!n)
              .some((n) => n.toLowerCase().includes(empresaFiltro))
          : true,
      )
      // "Ordenada pelas últimas tarefas" (pedido do usuário): a última
      // concluída em cima.
      .sort((a, b) => b.concluidaEm.localeCompare(a.concluidaEm));

    return {
      rows: rows.slice(0, LIMITE),
      total: rows.length,
      truncado: rows.length > LIMITE,
    };
  }
}
