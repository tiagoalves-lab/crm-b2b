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
  Query,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskService } from './task.service';

@Controller('tasks')
export class TaskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.tasks.create(tx, membership, dto),
    );
  }

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.tasks.findAll(tx, membership, query),
    );
  }

  @Get(':id')
  findOne(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.tasks.findOne(tx, membership, id),
    );
  }

  @Patch(':id')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.tasks.update(tx, membership, id, dto),
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
      (tx) => this.tasks.remove(tx, membership, id),
    );
  }
}
