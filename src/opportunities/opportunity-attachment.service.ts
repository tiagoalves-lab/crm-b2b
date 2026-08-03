import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OpportunityAttachment } from '@prisma/client';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';
import { OpportunityService } from './opportunity.service';

// Mirror de src/tasks/task-attachment.service.ts — mesma razão pra cada
// escolha (sizeBytes serializado à parte porque BigInt não vira JSON
// nativamente, path sanitizado contra path traversal).
export type SerializedAttachment = Omit<OpportunityAttachment, 'sizeBytes'> & {
  sizeBytes: number | null;
};

function serialize(attachment: OpportunityAttachment): SerializedAttachment {
  return {
    ...attachment,
    sizeBytes:
      attachment.sizeBytes === null ? null : Number(attachment.sizeBytes),
  };
}

// Reaproveita o bucket privado task-attachments (não precisa de bucket
// novo — a fronteira de segurança é o backend, não uma policy de
// storage.objects por bucket, ver SupabaseStorageService) com um prefixo
// de path próprio pra não colidir com os anexos de Task.
function buildStoragePath(
  workspaceId: string,
  opportunityId: string,
  fileName: string,
): string {
  const safeName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .slice(-150);
  return `${workspaceId}/opportunities/${opportunityId}/${randomUUID()}-${safeName}`;
}

@Injectable()
export class OpportunityAttachmentService {
  constructor(
    private readonly opportunities: OpportunityService,
    private readonly storage: SupabaseStorageService,
  ) {}

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
  ): Promise<SerializedAttachment[]> {
    await this.opportunities.mustBeVisible(tx, membership, opportunityId, 'read');
    const attachments = await tx.opportunityAttachment.findMany({
      where: { opportunityId },
      orderBy: { createdAt: 'desc' },
    });
    return attachments.map(serialize);
  }

  async createUploadUrl(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    dto: CreateAttachmentDto,
  ): Promise<{
    attachment: SerializedAttachment;
    uploadUrl: string;
    token: string;
  }> {
    await this.opportunities.mustBeVisible(tx, membership, opportunityId, 'read');

    const storagePath = buildStoragePath(
      membership.workspaceId,
      opportunityId,
      dto.fileName,
    );
    const { signedUrl, token } =
      await this.storage.createUploadUrl(storagePath);

    const attachment = await tx.opportunityAttachment.create({
      data: {
        opportunityId,
        storagePath,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        uploadedBy: membership.userId,
      },
    });

    return { attachment: serialize(attachment), uploadUrl: signedUrl, token };
  }

  async createDownloadUrl(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    attachmentId: string,
  ): Promise<{ url: string; fileName: string }> {
    const attachment = await this.mustExist(
      tx,
      membership,
      opportunityId,
      attachmentId,
    );
    const url = await this.storage.createDownloadUrl(attachment.storagePath);
    return { url, fileName: attachment.fileName };
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    attachmentId: string,
  ): Promise<void> {
    const attachment = await this.mustExist(
      tx,
      membership,
      opportunityId,
      attachmentId,
    );
    if (attachment.uploadedBy !== membership.userId) {
      throw new ForbiddenException('Só quem enviou o anexo pode removê-lo.');
    }
    await this.storage.remove(attachment.storagePath);
    await tx.opportunityAttachment.delete({ where: { id: attachment.id } });
  }

  private async mustExist(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    attachmentId: string,
    action: 'read' | 'write' = 'read',
  ): Promise<OpportunityAttachment> {
    await this.opportunities.mustBeVisible(tx, membership, opportunityId, action);
    const attachment = await tx.opportunityAttachment.findFirst({
      where: { id: attachmentId, opportunityId },
    });
    if (!attachment) {
      throw new NotFoundException('Anexo não encontrado.');
    }
    return attachment;
  }
}
