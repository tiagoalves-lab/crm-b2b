import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipService } from './membership.service';
import { SupabaseUserService } from './supabase-user.service';

@Controller('memberships')
export class MembershipController {
  constructor(
    private readonly memberships: MembershipService,
    private readonly tenantContext: TenantContextService,
    private readonly supabaseUser: SupabaseUserService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateMembershipDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.memberships.create(tx, membership, dto),
    );
  }

  // Enriquecimento com nome/login roda FORA da transação do Postgres
  // (tenantContext.run já fechou) — é uma chamada HTTP pro Supabase Auth
  // Admin API, não uma query, e segurar a transação aberta esperando ela
  // não vale o risco (ver comentário em SupabaseUserService#getIdentities).
  @Get()
  async findAll(@CurrentMembership() membership: MembershipContext) {
    const rows = await this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.memberships.findAll(tx, membership),
    );
    const identities = await this.supabaseUser.getIdentities(
      rows.map((row) => row.userId),
    );
    return rows.map((row) => ({
      ...row,
      ...(identities.get(row.userId) ?? { login: null, name: null }),
    }));
  }

  // dto.name não é coluna de Membership — atualizado à parte, fora da
  // transação, mesmo motivo do findAll acima (chamada HTTP, não query).
  @Patch(':id')
  async update(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    const updated = await this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.memberships.update(tx, membership, id, dto),
    );
    if (dto.name !== undefined) {
      await this.supabaseUser.updateUserName(updated.userId, dto.name);
    }
    if (dto.password) {
      await this.supabaseUser.updateUserPassword(updated.userId, dto.password);
    }
    return updated;
  }

  @Delete(':id')
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.memberships.remove(tx, membership, id),
    );
  }
}
