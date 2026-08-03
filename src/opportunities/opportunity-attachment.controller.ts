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
import { OpportunityAttachmentService } from './opportunity-attachment.service';

@Controller('opportunities/:opportunityId/attachments')
export class OpportunityAttachmentController {
  constructor(
    private readonly attachments: OpportunityAttachmentService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.attachments.findAll(tx, membership, opportunityId),
    );
  }

  @Post()
  createUploadUrl(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: CreateAttachmentDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.attachments.createUploadUrl(tx, membership, opportunityId, dto),
    );
  }

  @Get(':attachmentId/download')
  createDownloadUrl(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) =>
        this.attachments.createDownloadUrl(
          tx,
          membership,
          opportunityId,
          attachmentId,
        ),
    );
  }

  @Delete(':attachmentId')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.attachments.remove(tx, membership, opportunityId, attachmentId),
    );
  }
}
