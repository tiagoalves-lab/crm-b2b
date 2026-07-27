import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pipeline, Stage } from '@prisma/client';
import type { PaginatedResult } from '../companies/company.service';
import type { ListQueryDto } from '../common/dto/list-query.dto';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreatePipelineDto } from './dto/create-pipeline.dto';
import type { UpdatePipelineDto } from './dto/update-pipeline.dto';
import type { CreateStageDto } from './dto/create-stage.dto';
import type { UpdateStageDto } from './dto/update-stage.dto';

type PipelineWithStages = Pipeline & { stages: Stage[] };

// Pipeline/Stage são configuração de workspace, não dado transacional
// (docs/arquitetura-dados.md) — não têm ownerUserId, então o modelo de
// PolicyService (ownership) não se aplica aqui. Interpretação adotada
// (não especificada no doc): leitura aberta a qualquer Membership ativo
// do workspace (todo mundo precisa ver o processo de vendas pra criar
// Opportunity), escrita restrita a owner/admin.
const WRITE_ROLES = new Set(['owner', 'admin']);

@Injectable()
export class PipelineService {
  private assertCanWrite(membership: MembershipContext): void {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem alterar pipelines e stages.',
      );
    }
  }

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreatePipelineDto,
  ): Promise<Pipeline> {
    this.assertCanWrite(membership);

    if (dto.isDefault) {
      await tx.pipeline.updateMany({
        where: { workspaceId: membership.workspaceId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.pipeline.create({
      data: {
        workspaceId: membership.workspaceId,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        appliesTo: dto.appliesTo,
      },
    });
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListQueryDto,
  ): Promise<PaginatedResult<PipelineWithStages>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { workspaceId: membership.workspaceId };

    const [items, total] = await Promise.all([
      tx.pipeline.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'asc' },
        include: { stages: { orderBy: { order: 'asc' } } },
      }),
      tx.pipeline.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<PipelineWithStages> {
    return this.mustExist(tx, membership.workspaceId, id);
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdatePipelineDto,
  ): Promise<PipelineWithStages> {
    this.assertCanWrite(membership);
    await this.mustExist(tx, membership.workspaceId, id);

    if (dto.isDefault) {
      await tx.pipeline.updateMany({
        where: {
          workspaceId: membership.workspaceId,
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      });
    }

    await tx.pipeline.update({
      where: { id },
      data: {
        name: dto.name,
        isDefault: dto.isDefault,
        appliesTo: dto.appliesTo,
      },
    });

    return this.mustExist(tx, membership.workspaceId, id);
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<void> {
    this.assertCanWrite(membership);
    await this.mustExist(tx, membership.workspaceId, id);

    const inUse = await tx.opportunity.count({ where: { pipelineId: id } });
    if (inUse > 0) {
      throw new ConflictException(
        'Este pipeline ainda tem oportunidades associadas — não pode ser removido.',
      );
    }

    await tx.stage.deleteMany({ where: { pipelineId: id } });
    await tx.pipeline.delete({ where: { id } });
  }

  async createStage(
    tx: TenantTx,
    membership: MembershipContext,
    pipelineId: string,
    dto: CreateStageDto,
  ): Promise<Stage> {
    this.assertCanWrite(membership);
    await this.mustExist(tx, membership.workspaceId, pipelineId);

    return tx.stage.create({
      data: {
        pipelineId,
        name: dto.name,
        order: dto.order,
        probability: dto.probability,
        isWon: dto.isWon ?? false,
        isLost: dto.isLost ?? false,
      },
    });
  }

  async updateStage(
    tx: TenantTx,
    membership: MembershipContext,
    pipelineId: string,
    stageId: string,
    dto: UpdateStageDto,
  ): Promise<Stage> {
    this.assertCanWrite(membership);
    await this.mustExist(tx, membership.workspaceId, pipelineId);
    await this.mustStageExist(tx, pipelineId, stageId);

    return tx.stage.update({
      where: { id: stageId },
      data: {
        name: dto.name,
        order: dto.order,
        probability: dto.probability,
        isWon: dto.isWon,
        isLost: dto.isLost,
      },
    });
  }

  async removeStage(
    tx: TenantTx,
    membership: MembershipContext,
    pipelineId: string,
    stageId: string,
  ): Promise<void> {
    this.assertCanWrite(membership);
    await this.mustExist(tx, membership.workspaceId, pipelineId);
    await this.mustStageExist(tx, pipelineId, stageId);

    const inUse = await tx.opportunity.count({ where: { stageId } });
    if (inUse > 0) {
      throw new ConflictException(
        'Este stage ainda tem oportunidades associadas — não pode ser removido.',
      );
    }

    await tx.stage.delete({ where: { id: stageId } });
  }

  private async mustExist(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<PipelineWithStages> {
    const pipeline = await tx.pipeline.findFirst({
      where: { id, workspaceId },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!pipeline) {
      throw new NotFoundException('Pipeline não encontrado.');
    }
    return pipeline;
  }

  private async mustStageExist(
    tx: TenantTx,
    pipelineId: string,
    stageId: string,
  ): Promise<Stage> {
    const stage = await tx.stage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) {
      throw new NotFoundException('Stage não encontrado.');
    }
    return stage;
  }
}
