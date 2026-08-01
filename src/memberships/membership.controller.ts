import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipService } from './membership.service';

@Controller('memberships')
export class MembershipController {
  constructor(
    private readonly memberships: MembershipService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  findAll(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.memberships.findAll(tx, membership),
    );
  }

  @Patch(':id')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.memberships.update(tx, membership, id, dto),
    );
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
