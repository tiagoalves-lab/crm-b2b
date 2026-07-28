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
import { CreateTaskListDto } from './dto/create-task-list.dto';
import { UpdateTaskListDto } from './dto/update-task-list.dto';
import { TaskListService } from './task-list.service';

@Controller('task-lists')
export class TaskListController {
  constructor(
    private readonly taskLists: TaskListService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  findAll(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.taskLists.findAll(tx, membership),
    );
  }

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateTaskListDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.taskLists.create(tx, membership, dto),
    );
  }

  @Patch(':id')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskListDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.taskLists.update(tx, membership, id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.taskLists.remove(tx, membership, id),
    );
  }
}
