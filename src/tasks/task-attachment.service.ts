import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TaskAttachment } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';
import { TaskService } from './task.service';

// Anexo serializado pra API — sizeBytes vem como BigInt do Prisma
// (coluna bigint), e o serializador JSON do Nest não sabe lidar com
// BigInt nativamente. É o único campo BigInt do schema inteiro, então
// convertido aqui em vez de um patch global em BigInt.prototype.toJSON.
export type SerializedAttachment = Omit<TaskAttachment, 'sizeBytes'> & {
  sizeBytes: number | null;
};

function serialize(attachment: TaskAttachment): SerializedAttachment {
  return {
    ...attachment,
    sizeBytes:
      attachment.sizeBytes === null ? null : Number(attachment.sizeBytes),
  };
}

// Caminho no bucket privado task-attachments — nunca o nome original cru
// (evita colisão e path traversal), sempre prefixado por workspace/task
// pra facilitar auditoria e limpeza em lote se precisar.
function buildStoragePath(
  workspaceId: string,
  taskId: string,
  fileName: string,
): string {
  // Sequências de ".." sobrevivem à troca de caractere-a-caractere acima
  // (ponto sozinho é permitido, pra manter a extensão) — removidas à
  // parte pra o nome nunca carregar um padrão de path traversal, mesmo
  // que a Storage API do Supabase já trate a key inteira como opaca.
  const safeName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .slice(-150);
  return `${workspaceId}/${taskId}/${randomUUID()}-${safeName}`;
}

@Injectable()
export class TaskAttachmentService {
  constructor(
    private readonly tasks: TaskService,
    private readonly storage: SupabaseStorageService,
    private readonly policy: PolicyService,
  ) {}

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
  ): Promise<SerializedAttachment[]> {
    await this.tasks.mustBeVisible(tx, membership, taskId, 'read');
    const attachments = await tx.taskAttachment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
    return attachments.map(serialize);
  }

  // Cria o registro de metadados e devolve a signed URL pra o Server
  // Action (Next.js) fazer o PUT do binário direto no Storage — o
  // NestJS nunca vê os bytes do arquivo (SPEC-CRM-GAMA.md §3.2: "backend
  // valida que a tarefa pertence ao workspace antes de assinar").
  async createUploadUrl(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    dto: CreateAttachmentDto,
  ): Promise<{
    attachment: SerializedAttachment;
    uploadUrl: string;
    token: string;
  }> {
    await this.tasks.mustBeVisible(tx, membership, taskId, 'read');

    const storagePath = buildStoragePath(
      membership.workspaceId,
      taskId,
      dto.fileName,
    );
    const { signedUrl, token } =
      await this.storage.createUploadUrl(storagePath);

    const attachment = await tx.taskAttachment.create({
      data: {
        taskId,
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
    taskId: string,
    attachmentId: string,
  ): Promise<{ url: string; fileName: string }> {
    const attachment = await this.mustExist(
      tx,
      membership,
      taskId,
      attachmentId,
    );
    const url = await this.storage.createDownloadUrl(attachment.storagePath);
    return { url, fileName: attachment.fileName };
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    attachmentId: string,
  ): Promise<void> {
    // Nega cedo por papel — representante não remove nem o próprio anexo,
    // mais restrito que "só quem enviou remove" abaixo.
    this.policy.assertCanDelete(membership, 'tarefas');
    const attachment = await this.mustExist(
      tx,
      membership,
      taskId,
      attachmentId,
    );
    if (attachment.uploadedBy !== membership.userId) {
      throw new ForbiddenException('Só quem enviou o anexo pode removê-lo.');
    }
    await this.storage.remove(attachment.storagePath);
    await tx.taskAttachment.delete({ where: { id: attachment.id } });
  }

  private async mustExist(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    attachmentId: string,
    action: 'read' | 'write' = 'read',
  ): Promise<TaskAttachment> {
    await this.tasks.mustBeVisible(tx, membership, taskId, action);
    const attachment = await tx.taskAttachment.findFirst({
      where: { id: attachmentId, taskId },
    });
    if (!attachment) {
      throw new NotFoundException('Anexo não encontrado.');
    }
    return attachment;
  }
}
