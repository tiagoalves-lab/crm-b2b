import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CreateLostReasonDto } from './dto/create-lost-reason.dto';
import { OpportunityLostReasonService } from './opportunity-lost-reason.service';

// Lista do workspace inteiro (RLS isola). Cadastrar: quem edita
// oportunidade. Renomear/excluir: só owner/admin, checado no service
// depois do 404.
@Controller('opportunity-lost-reasons')
export class OpportunityLostReasonController {
  constructor(
    private readonly reasons: OpportunityLostReasonService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private ctx(membership: MembershipContext) {
    return {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }

  @Get()
  findAll(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(this.ctx(membership), (tx) =>
      this.reasons.findAll(tx, membership),
    );
  }

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateLostReasonDto,
  ) {
    return this.tenantContext.run(this.ctx(membership), (tx) =>
      this.reasons.create(tx, membership, dto.nome),
    );
  }

  @Patch(':id')
  rename(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLostReasonDto,
  ) {
    return this.tenantContext.run(this.ctx(membership), (tx) =>
      this.reasons.rename(tx, membership, id, dto.nome),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(this.ctx(membership), (tx) =>
      this.reasons.remove(tx, membership, id),
    );
  }
}
