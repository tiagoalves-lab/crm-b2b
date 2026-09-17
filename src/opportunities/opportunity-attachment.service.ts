import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OpportunityAttachment } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';
import { OpportunityService } from './opportunity.service';
import { nomeDaEmpresa, registrarExclusao } from '../deletion-log/registrar-exclusao';

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
// Publicação do anexo (pedido do usuário, 2026-09-15). Arquivo enviado
// por owner/admin nasce RESERVADO (publishedAt = null) e só aparece pra
// gerente e representante depois que alguém de owner/admin publica;
// arquivo enviado por gerente ou representante já nasce publicado. A
// regra é por PAPEL, não pela matriz de permissões granulares: o que
// está em jogo é nível hierárquico ("quem pode ver antes da hora"), não
// capacidade de ação num módulo — mesma razão pela qual o escopo de
// visibilidade continua vindo do papel em PolicyService.
function podePublicar(membership: MembershipContext): boolean {
  return membership.role === 'owner' || membership.role === 'admin';
}

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
    private readonly policy: PolicyService,
  ) {}

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
  ): Promise<SerializedAttachment[]> {
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'read',
    );
    const attachments = await tx.opportunityAttachment.findMany({
      where: {
        opportunityId,
        // Quem não publica também não enxerga o que ainda não foi
        // publicado — o filtro é aqui, no backend, nunca na tela.
        ...(podePublicar(membership) ? {} : { publishedAt: { not: null } }),
      },
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
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'read',
    );

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
        // Owner/admin publica depois, num segundo ato; gerente e
        // representante não têm o que reservar de quem já vê tudo o que
        // eles veem, então o arquivo deles já entra publicado.
        publishedAt: podePublicar(membership) ? null : new Date(),
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

  // Libera o anexo pra gerente e representante. Não tem volta (pedido do
  // usuário): despublicar seria dar a entender que o arquivo "sumiu",
  // quando quem já baixou continua com ele — pra tirar da vista, exclui e
  // envia outro.
  async publish(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    attachmentId: string,
  ): Promise<SerializedAttachment> {
    const attachment = await this.mustExist(
      tx,
      membership,
      opportunityId,
      attachmentId,
      'write',
    );
    if (!podePublicar(membership)) {
      throw new ForbiddenException(
        'Só administrador ou proprietário pode publicar anexo.',
      );
    }
    if (attachment.publishedAt !== null) {
      return serialize(attachment);
    }
    const published = await tx.opportunityAttachment.update({
      where: { id: attachment.id },
      data: { publishedAt: new Date() },
    });
    return serialize(published);
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    attachmentId: string,
  ): Promise<void> {
    this.policy.assertCanDelete(membership, 'oportunidades');
    const attachment = await this.mustExist(
      tx,
      membership,
      opportunityId,
      attachmentId,
    );
    if (attachment.uploadedBy !== membership.userId) {
      throw new ForbiddenException('Só quem enviou o anexo pode removê-lo.');
    }
    const opportunity = await tx.opportunity.findFirst({
      where: { id: opportunityId },
      select: { companyId: true },
    });
    // Registro antes de apagar o arquivo: se a gravação falhar, nada sai.
    await registrarExclusao(tx, membership, {
      entidade: 'oportunidade_anexo',
      registroId: attachment.id,
      titulo: attachment.fileName,
      contexto: await nomeDaEmpresa(tx, opportunity?.companyId),
      snapshot: attachment,
    });
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
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      action,
    );
    const attachment = await tx.opportunityAttachment.findFirst({
      where: {
        id: attachmentId,
        opportunityId,
        // Anexo reservado nem existe pra quem não publica: download e
        // exclusão respondem 404, não 403 (docs/seguranca.md, 4.2).
        ...(podePublicar(membership) ? {} : { publishedAt: { not: null } }),
      },
    });
    if (!attachment) {
      throw new NotFoundException('Anexo não encontrado.');
    }
    return attachment;
  }
}
