import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { OpportunityItemService } from './opportunity-item.service';

// Sem GET próprio: a lista vem embutida em GET /opportunities/:id
// (OpportunityWithDetails.items), igual aos comentários.
@Controller('opportunities/:opportunityId/items')
export class OpportunityItemController {
  constructor(
    private readonly items: OpportunityItemService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.items.create(tx, membership, opportunityId, dto),
    );
  }

  // Editar item (2026-09-04) — na prática, digitar o valor depois de
  // montar a lista. Ownership é checado no service (mustBeVisible com
  // 'write'), 404 antes de 403.
  @Patch(':itemId')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.items.update(tx, membership, opportunityId, itemId, dto),
    );
  }

  @Delete(':itemId')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.items.remove(tx, membership, opportunityId, itemId),
    );
  }
}
