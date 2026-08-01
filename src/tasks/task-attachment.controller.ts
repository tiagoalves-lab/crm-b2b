import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { TaskAttachmentService } from './task-attachment.service';

@Controller('tasks/:taskId/attachments')
export class TaskAttachmentController {
  constructor(
    private readonly attachments: TaskAttachmentService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.attachments.findAll(tx, membership, taskId),
    );
  }

  @Post()
  createUploadUrl(
    @CurrentMembership() membership: MembershipContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateAttachmentDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.attachments.createUploadUrl(tx, membership, taskId, dto),
    );
  }

  @Get(':attachmentId/download')
  createDownloadUrl(
    @CurrentMembership() membership: MembershipContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) =>
        this.attachments.createDownloadUrl(
          tx,
          membership,
          taskId,
          attachmentId,
        ),
    );
  }

  @Delete(':attachmentId')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.attachments.remove(tx, membership, taskId, attachmentId),
    );
  }
}
