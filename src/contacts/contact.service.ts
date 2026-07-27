import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Contact } from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import { assertActiveMembership } from '../common/assert-active-membership';
import type { ListQueryDto } from '../common/dto/list-query.dto';
import type { PaginatedResult } from '../companies/company.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateContactDto } from './dto/create-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateContactDto,
  ): Promise<Contact> {
    const ownerUserId = dto.ownerUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, ownerUserId);

    if (dto.companyId) {
      await this.mustCompanyExist(tx, membership.workspaceId, dto.companyId);
    }
    if (dto.email) {
      await this.assertEmailFree(tx, membership.workspaceId, dto.email);
    }

    const contact = await tx.contact.create({
      data: {
        workspaceId: membership.workspaceId,
        name: dto.name,
        companyId: dto.companyId,
        email: dto.email,
        phone: dto.phone,
        title: dto.title,
        ownerUserId,
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'created' },
      contactId: contact.id,
    });

    return contact;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListQueryDto,
  ): Promise<PaginatedResult<Contact>> {
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      workspaceId: membership.workspaceId,
      ...ownerFilter,
      deletedAt: query.includeDeleted ? undefined : null,
    };

    const [items, total] = await Promise.all([
      tx.contact.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      tx.contact.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Contact> {
    return this.mustBeVisible(tx, membership, id);
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateContactDto,
  ): Promise<Contact> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    if (dto.ownerUserId) {
      await assertActiveMembership(tx, membership.workspaceId, dto.ownerUserId);
    }
    if (dto.companyId) {
      await this.mustCompanyExist(tx, membership.workspaceId, dto.companyId);
    }
    if (dto.email && dto.email !== existing.email) {
      await this.assertEmailFree(tx, membership.workspaceId, dto.email);
    }

    const updated = await tx.contact.update({
      where: { id: existing.id },
      data: {
        name: dto.name,
        companyId: dto.companyId,
        email: dto.email,
        phone: dto.phone,
        title: dto.title,
        ownerUserId: dto.ownerUserId,
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'updated', fields: Object.keys(dto) },
      contactId: updated.id,
    });

    return updated;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Contact> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    const deleted = await tx.contact.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'deleted' },
      contactId: deleted.id,
    });

    return deleted;
  }

  async restore(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Contact> {
    const existing = await tx.contact.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (
      !existing ||
      !(await this.policy.can(tx, membership, 'write', existing))
    ) {
      throw new NotFoundException('Contato não encontrado.');
    }
    if (!existing.deletedAt) {
      throw new BadRequestException('Contato não está excluído.');
    }

    const restored = await tx.contact.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'restored' },
      contactId: restored.id,
    });

    return restored;
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

  private async assertEmailFree(
    tx: TenantTx,
    workspaceId: string,
    email: string,
  ): Promise<void> {
    const existing = await tx.contact.findFirst({
      where: { workspaceId, email },
    });
    if (existing) {
      throw new ConflictException(
        `Já existe um contato com o e-mail "${email}" neste workspace.`,
      );
    }
  }

  private async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' = 'read',
  ): Promise<Contact> {
    const contact = await tx.contact.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!contact || contact.deletedAt) {
      throw new NotFoundException('Contato não encontrado.');
    }
    if (!(await this.policy.can(tx, membership, action, contact))) {
      throw new NotFoundException('Contato não encontrado.');
    }
    return contact;
  }
}
