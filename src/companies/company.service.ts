import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Company, Prisma } from '@prisma/client';
import { assertActiveMembership } from '../common/assert-active-membership';
import type { ListQueryDto } from '../common/dto/list-query.dto';
import { ActivityService } from '../activities/activity.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateCompanyDto } from './dto/create-company.dto';
import type { UpdateCompanyDto } from './dto/update-company.dto';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateCompanyDto,
  ): Promise<Company> {
    const ownerUserId = dto.ownerUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, ownerUserId);

    if (dto.parentCompanyId) {
      await this.mustExist(tx, membership.workspaceId, dto.parentCompanyId);
    }

    const company = await tx.company.create({
      data: {
        workspaceId: membership.workspaceId,
        name: dto.name,
        domain: dto.domain,
        industry: dto.industry,
        size: dto.size,
        ownerUserId,
        parentCompanyId: dto.parentCompanyId,
        customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'created' },
      companyId: company.id,
    });

    return company;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListQueryDto,
  ): Promise<PaginatedResult<Company>> {
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      workspaceId: membership.workspaceId,
      ...ownerFilter,
      deletedAt: query.includeDeleted ? undefined : null,
    };

    const [items, total] = await Promise.all([
      tx.company.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      tx.company.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    return this.mustBeVisible(tx, membership, id);
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateCompanyDto,
  ): Promise<Company> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    if (dto.ownerUserId) {
      await assertActiveMembership(tx, membership.workspaceId, dto.ownerUserId);
    }
    if (dto.parentCompanyId) {
      if (dto.parentCompanyId === id) {
        throw new BadRequestException(
          'Uma empresa não pode ser sua própria matriz.',
        );
      }
      await this.mustExist(tx, membership.workspaceId, dto.parentCompanyId);
    }

    const updated = await tx.company.update({
      where: { id: existing.id },
      data: {
        name: dto.name,
        domain: dto.domain,
        industry: dto.industry,
        size: dto.size,
        ownerUserId: dto.ownerUserId,
        parentCompanyId: dto.parentCompanyId,
        customFields: dto.customFields as Prisma.InputJsonValue | undefined,
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'updated', fields: Object.keys(dto) },
      companyId: updated.id,
    });

    return updated;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    const deleted = await tx.company.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'deleted' },
      companyId: deleted.id,
    });

    return deleted;
  }

  async restore(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    const existing = await tx.company.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!existing) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    if (!(await this.policy.can(tx, membership, 'write', existing))) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    if (!existing.deletedAt) {
      throw new BadRequestException('Empresa não está excluída.');
    }

    const restored = await tx.company.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'restored' },
      companyId: restored.id,
    });

    return restored;
  }

  private async mustExist(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<Company> {
    const company = await tx.company.findFirst({
      where: { id, workspaceId },
    });
    if (!company || company.deletedAt) {
      throw new BadRequestException(`Empresa "${id}" não encontrada.`);
    }
    return company;
  }

  // 404 (não 403) quando a policy nega — não confirma pra quem não tem
  // acesso que o registro existe no workspace, mesmo escopo de
  // PolicyService.scopeFilter (que simplesmente omite o registro da lista).
  private async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' = 'read',
  ): Promise<Company> {
    const company = await tx.company.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    if (!(await this.policy.can(tx, membership, action, company))) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }
}
