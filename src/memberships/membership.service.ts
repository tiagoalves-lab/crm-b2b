import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateMembershipDto } from './dto/create-membership.dto';
import type { UpdateMembershipDto } from './dto/update-membership.dto';
import { SupabaseUserService } from './supabase-user.service';

// Mesmo critério do PipelineService: gestão de membros é config de
// workspace, só owner/admin mexem.
const WRITE_ROLES = new Set(['owner', 'admin']);

@Injectable()
export class MembershipService {
  constructor(private readonly supabaseUser: SupabaseUserService) {}

  // Cria o login (Supabase Auth) e o Membership do workspace atual numa
  // única chamada — não existe fluxo de convite por e-mail (adiado no
  // roadmap), então o admin já entra com e-mail/senha prontos.
  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateMembershipDto,
  ): Promise<Membership> {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new ForbiddenException('Só owner/admin podem gerenciar membros.');
    }

    if (dto.managerId) {
      const manager = await tx.membership.findFirst({
        where: {
          id: dto.managerId,
          workspaceId: membership.workspaceId,
          status: 'active',
        },
      });
      if (!manager) {
        throw new BadRequestException(
          'Gerente informado não é um membro ativo deste workspace.',
        );
      }
    }

    const { id: userId } = await this.supabaseUser.createUser(
      dto.login,
      dto.password,
      dto.name,
    );

    return tx.membership.create({
      data: {
        workspaceId: membership.workspaceId,
        userId,
        role: dto.role ?? 'sales_rep',
        managerId: dto.managerId,
        status: 'active',
        joinedAt: new Date(),
      },
    });
  }

  findAll(tx: TenantTx, membership: MembershipContext): Promise<Membership[]> {
    // Leitura aberta a qualquer Membership ativo — todo mundo precisa ver
    // quem é seu gerente/subordinado, não só admin.
    return tx.membership.findMany({
      where: { workspaceId: membership.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateMembershipDto,
  ): Promise<Membership> {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new ForbiddenException('Só owner/admin podem gerenciar membros.');
    }

    const existing = await tx.membership.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!existing) {
      throw new NotFoundException('Membro não encontrado.');
    }

    if (dto.managerId) {
      if (dto.managerId === id) {
        throw new BadRequestException(
          'Um membro não pode ser gerente de si mesmo.',
        );
      }
      const manager = await tx.membership.findFirst({
        where: {
          id: dto.managerId,
          workspaceId: membership.workspaceId,
          status: 'active',
        },
      });
      if (!manager) {
        throw new BadRequestException(
          'Gerente informado não é um membro ativo deste workspace.',
        );
      }
    }

    const losingOwnership =
      existing.role === 'owner' &&
      existing.status !== 'suspended' &&
      ((dto.role !== undefined && dto.role !== 'owner') ||
        dto.status === 'suspended');
    if (losingOwnership) {
      const activeOwners = await tx.membership.count({
        where: {
          workspaceId: membership.workspaceId,
          role: 'owner',
          status: 'active',
        },
      });
      if (activeOwners <= 1) {
        throw new BadRequestException(
          'Não é possível rebaixar/suspender o último owner ativo do workspace.',
        );
      }
    }

    return tx.membership.update({
      where: { id: existing.id },
      data: {
        role: dto.role,
        status: dto.status,
        managerId: dto.managerId,
      },
    });
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Membership> {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new ForbiddenException('Só owner/admin podem gerenciar membros.');
    }

    const existing = await tx.membership.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!existing) {
      throw new NotFoundException('Membro não encontrado.');
    }

    if (existing.role === 'owner' && existing.status === 'active') {
      const activeOwners = await tx.membership.count({
        where: {
          workspaceId: membership.workspaceId,
          role: 'owner',
          status: 'active',
        },
      });
      if (activeOwners <= 1) {
        throw new BadRequestException(
          'Não é possível remover o último owner ativo do workspace.',
        );
      }
    }

    // manager_id tem ON DELETE SET NULL (ver migration) — quem reportava
    // pra esse membro fica sem gerente automaticamente, sem violar FK.
    return tx.membership.delete({ where: { id: existing.id } });
  }
}
