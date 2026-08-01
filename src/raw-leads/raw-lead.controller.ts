import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { BulkRawLeadsDto } from './dto/bulk-raw-leads.dto';
import { CreateRawLeadDto } from './dto/create-raw-lead.dto';
import { ListRawLeadsQueryDto } from './dto/list-raw-leads-query.dto';
import { RawLeadService } from './raw-lead.service';

@Controller('raw-leads')
export class RawLeadController {
  constructor(
    private readonly rawLeads: RawLeadService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateRawLeadDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.create(tx, membership, dto),
    );
  }

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListRawLeadsQueryDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.findAll(tx, membership, query),
    );
  }

  @Post('bulk-approve')
  bulkApprove(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: BulkRawLeadsDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.bulkApprove(tx, membership, dto.ids),
    );
  }

  @Post('bulk-discard')
  bulkDiscard(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: BulkRawLeadsDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.bulkDiscard(tx, membership, dto.ids),
    );
  }

  @Post('rescore')
  rescore(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.rescoreAll(tx, membership),
    );
  }

  @Get(':id')
  findOne(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.findOne(tx, membership, id),
    );
  }

  @Post(':id/approve')
  approve(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.approve(tx, membership, id),
    );
  }

  @Post(':id/discard')
  discard(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.discard(tx, membership, id),
    );
  }
}
