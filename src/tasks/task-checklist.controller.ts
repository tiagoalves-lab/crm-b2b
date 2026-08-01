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
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { TaskChecklistService } from './task-checklist.service';

@Controller('tasks/:taskId/checklist-items')
export class TaskChecklistController {
  constructor(
    private readonly checklist: TaskChecklistService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.checklist.create(tx, membership, taskId, dto),
    );
  }

  @Patch(':itemId')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.checklist.update(tx, membership, taskId, itemId, dto),
    );
  }

  @Delete(':itemId')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.checklist.remove(tx, membership, taskId, itemId),
    );
  }
}
