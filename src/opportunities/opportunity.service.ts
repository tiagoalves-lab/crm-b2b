import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Opportunity,
  OpportunityComment,
  OpportunityStatus,
  Prisma,
  Stage,
} from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import { assertActiveMembership } from '../common/assert-active-membership';
import { OptimisticConcurrencyException } from '../common/exceptions/optimistic-concurrency.exception';
import type { PaginatedResult } from '../companies/company.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateOpportunityDto } from './dto/create-opportunity.dto';
import type { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';
import type { UpdateOpportunityDto } from './dto/update-opportunity.dto';

// open -> won/lost (fechamento); won/lost -> open (reabertura explícita,
// limpa lostReason/closedAt). Bloqueia won<->lost direto — precisa reabrir
// primeiro. Interpretação minha de "estados terminais exigem reabertura
// explícita" (docs/arquitetura-dados.md fala de mudança de STAGE nesse
// contexto, não de status diretamente) — sinalizado aqui por ser uma
// extensão, não algo literal do doc.
const ALLOWED_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  open: ['won', 'lost'],
  won: ['open'],
  lost: ['open'],
};

// Comentários do card (feature nova, ver OpportunityCommentService) —
// embutidos em findOne, mesmo padrão de TaskWithDetails. Anexos ficam de
// fora (endpoint próprio), igual Task.
export type OpportunityWithDetails = Opportunity & {
  comments: OpportunityComment[];
};

@Injectable()
export class OpportunityService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateOpportunityDto,
  ): Promise<Opportunity> {
    if (!this.policy.canModule(membership, 'oportunidades', 'criar')) {
      throw new ForbiddenException(
        'Sem permissão para cadastrar oportunidades.',
      );
    }

    const ownerUserId = dto.ownerUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, ownerUserId);
    await this.mustCompanyExist(tx, membership.workspaceId, dto.companyId);
    await this.mustStageBelongToPipeline(
      tx,
      membership.workspaceId,
      dto.pipelineId,
      dto.stageId,
    );

    const opportunity = await tx.opportunity.create({
      data: {
        workspaceId: membership.workspaceId,
        companyId: dto.companyId,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        ownerUserId,
        amount: dto.amount,
        currency: dto.currency,
        expectedCloseDate: dto.expectedCloseDate
          ? new Date(dto.expectedCloseDate)
          : undefined,
        status: 'open',
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'created' },
      opportunityId: opportunity.id,
    });

    return opportunity;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListOpportunitiesQueryDto,
  ): Promise<PaginatedResult<Opportunity>> {
    // Mesmo critério de TaskService#findAll: filtrado por empresa (aba
    // "Oportunidades" da ficha) usa empresas_oportunidades, separado da
    // tela geral (Pipeline) — só 'ver' tem efeito próprio, ver comentário
    // lá.
    const viewModule = query.companyId
      ? 'empresas_oportunidades'
      : 'oportunidades';
    if (!this.policy.canModule(membership, viewModule, 'ver')) {
      throw new ForbiddenException('Sem permissão para ver oportunidades.');
    }
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OpportunityWhereInput = {
      workspaceId: membership.workspaceId,
      ...ownerFilter,
      deletedAt: query.includeDeleted ? undefined : null,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    if (query.staleDays) {
      where.id = {
        in: await this.findStaleOpportunityIds(
          tx,
          membership.workspaceId,
          query.staleDays,
        ),
      };
    }

    const [items, total] = await Promise.all([
      tx.opportunity.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      tx.opportunity.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // "Deal parado" (Fase 4, docs/roadmap.md): open, sem stage_change (ou
  // criação, se nunca mudou de stage) há pelo menos staleDays. IDs
  // resolvidos via SQL raw (parametrizado via tagged template — nunca
  // interpolação de string) e depois aplicados como filtro comum do
  // Prisma, pra reusar scopeFilter/paginação/deletedAt sem duplicar essa
  // lógica em SQL.
  private async findStaleOpportunityIds(
    tx: TenantTx,
    workspaceId: string,
    staleDays: number,
  ): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM "opportunities" o
      WHERE o."workspace_id" = ${workspaceId}::uuid
        AND o."status" = 'open'
        AND o."deleted_at" IS NULL
        AND COALESCE(
          (SELECT MAX(a."occurred_at") FROM "activities" a
           WHERE a."opportunity_id" = o."id" AND a."type" = 'stage_change'),
          o."created_at"
        ) < NOW() - (${staleDays} || ' days')::interval
    `;
    return rows.map((r) => r.id);
  }

  async findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<OpportunityWithDetails> {
    await this.mustBeVisible(tx, membership, id);
    return tx.opportunity.findUniqueOrThrow({
      where: { id },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateOpportunityDto,
  ): Promise<Opportunity> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    if (dto.version !== existing.version) {
      throw new OptimisticConcurrencyException(existing.version);
    }

    if (
      dto.pipelineId &&
      dto.pipelineId !== existing.pipelineId &&
      !dto.stageId
    ) {
      throw new BadRequestException(
        'Ao mudar pipelineId, stageId também precisa ser informado (evita ambiguidade sobre qual pipeline o stage pertence).',
      );
    }

    const nextPipelineId = dto.pipelineId ?? existing.pipelineId;
    const nextStageId = dto.stageId ?? existing.stageId;

    let fromStage: Stage | null = null;
    let toStage: Stage | null = null;
    const stageChanged = nextStageId !== existing.stageId;
    if (stageChanged) {
      toStage = await this.mustStageBelongToPipeline(
        tx,
        membership.workspaceId,
        nextPipelineId,
        nextStageId,
      );
      fromStage = await tx.stage.findUnique({
        where: { id: existing.stageId },
      });
    }

    const nextStatus = dto.status ?? existing.status;
    this.assertValidTransition(existing.status, nextStatus);

    const nextLostReason =
      nextStatus === 'lost' ? (dto.lostReason ?? existing.lostReason) : null;
    if (nextStatus === 'lost' && !nextLostReason) {
      throw new BadRequestException(
        'status "lost" exige lostReason preenchido.',
      );
    }

    if (dto.ownerUserId) {
      await assertActiveMembership(tx, membership.workspaceId, dto.ownerUserId);
    }
    if (dto.companyId) {
      await this.mustCompanyExist(tx, membership.workspaceId, dto.companyId);
    }

    const closing = existing.status === 'open' && nextStatus !== 'open';
    const reopening = existing.status !== 'open' && nextStatus === 'open';
    const closedAt = closing
      ? new Date()
      : reopening
        ? null
        : existing.closedAt;

    const result = await tx.opportunity.updateMany({
      where: { id: existing.id, version: existing.version },
      data: {
        companyId: dto.companyId,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        ownerUserId: dto.ownerUserId,
        amount: dto.amount,
        currency: dto.currency,
        expectedCloseDate: dto.expectedCloseDate
          ? new Date(dto.expectedCloseDate)
          : undefined,
        status: nextStatus,
        lostReason: nextLostReason,
        closedAt,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      // Corrida entre o findFirst acima e este updateMany — outra escrita
      // venceu no meio do caminho. A checagem de dto.version no início é
      // só atalho de UX; esta é a proteção real (compare-and-swap).
      const latest = await tx.opportunity.findUniqueOrThrow({
        where: { id: existing.id },
      });
      throw new OptimisticConcurrencyException(latest.version);
    }

    const updated = await tx.opportunity.findUniqueOrThrow({
      where: { id: existing.id },
    });

    // Um emit por mudança semântica, não um blob só — mantém stage_change
    // "limpo" pra relatórios futuros de funil/velocity (Fase 5).
    if (stageChanged && fromStage && toStage) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'stage_change',
        payload: {
          fromStageId: fromStage.id,
          toStageId: toStage.id,
          backward: toStage.order < fromStage.order,
        },
        opportunityId: updated.id,
      });
    }
    if (dto.status && dto.status !== existing.status) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: {
          action: 'status_changed',
          from: existing.status,
          to: nextStatus,
          lostReason: nextLostReason,
        },
        opportunityId: updated.id,
      });
    }
    const otherFieldsChanged = [
      dto.companyId,
      dto.ownerUserId,
      dto.amount,
      dto.currency,
      dto.expectedCloseDate,
    ].some((value) => value !== undefined);
    if (otherFieldsChanged) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: {
          action: 'updated',
          fields: Object.keys(dto).filter((key) => key !== 'version'),
        },
        opportunityId: updated.id,
      });
    }

    return updated;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Opportunity> {
    const existing = await this.mustBeVisible(tx, membership, id, 'delete');

    const deleted = await tx.opportunity.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'deleted' },
      opportunityId: deleted.id,
    });

    return deleted;
  }

  async restore(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Opportunity> {
    const existing = await tx.opportunity.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (
      !existing ||
      !(await this.policy.can(
        tx,
        membership,
        'write',
        existing,
        'oportunidades',
      ))
    ) {
      throw new NotFoundException('Oportunidade não encontrada.');
    }
    if (!existing.deletedAt) {
      throw new BadRequestException('Oportunidade não está excluída.');
    }

    const restored = await tx.opportunity.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'restored' },
      opportunityId: restored.id,
    });

    return restored;
  }

  private assertValidTransition(
    from: OpportunityStatus,
    to: OpportunityStatus,
  ): void {
    if (from === to) return;
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `Transição de status "${from}" para "${to}" não é permitida — reabra a oportunidade (status "open") primeiro.`,
      );
    }
  }

  private async mustCompanyExist(
    tx: TenantTx,
    workspaceId: string,
    companyId: string,
  ): Promise<void> {
    const company = await tx.company.findFirst({
      where: { id: companyId, workspaceId },
    });
    if (!company || company.deletedAt) {
      throw new BadRequestException(`Empresa "${companyId}" não encontrada.`);
    }
  }

  private async mustStageBelongToPipeline(
    tx: TenantTx,
    workspaceId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<Stage> {
    const pipeline = await tx.pipeline.findFirst({
      where: { id: pipelineId, workspaceId },
    });
    if (!pipeline) {
      throw new BadRequestException(`Pipeline "${pipelineId}" não encontrado.`);
    }
    const stage = await tx.stage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) {
      throw new BadRequestException(
        `Stage "${stageId}" não pertence ao pipeline "${pipelineId}".`,
      );
    }
    return stage;
  }

  // Público — OpportunityAttachmentService/OpportunityCommentService
  // chamam isto pra confirmar posse antes de assinar URL/gravar
  // comentário, mesmo padrão de TaskService.mustBeVisible.
  async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' | 'delete' = 'read',
  ): Promise<Opportunity> {
    const opportunity = await tx.opportunity.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!opportunity || opportunity.deletedAt) {
      throw new NotFoundException('Oportunidade não encontrada.');
    }
    if (
      !(await this.policy.can(
        tx,
        membership,
        action,
        opportunity,
        'oportunidades',
      ))
    ) {
      throw new NotFoundException('Oportunidade não encontrada.');
    }
    return opportunity;
  }
}
