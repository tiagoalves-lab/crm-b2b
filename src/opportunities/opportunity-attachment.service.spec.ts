import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { SupabaseStorageService } from '../storage/supabase-storage.service';
import { OpportunityAttachmentService } from './opportunity-attachment.service';
import type { OpportunityService } from './opportunity.service';

const WORKSPACE_ID = 'workspace-1';
const OPPORTUNITY_ID = 'opp-1';

function membership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    role: 'sales_rep',
    status: 'active',
    ...overrides,
  };
}

function fakeOpportunityService(): OpportunityService {
  return {
    mustBeVisible: jest.fn().mockResolvedValue({ id: OPPORTUNITY_ID }),
  } as unknown as OpportunityService;
}

function fakeStorage(): SupabaseStorageService {
  return {
    createUploadUrl: jest.fn().mockResolvedValue({
      signedUrl: 'https://storage.example/upload',
      token: 'tok-1',
    }),
    createDownloadUrl: jest
      .fn()
      .mockResolvedValue('https://storage.example/download'),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as SupabaseStorageService;
}

function fakeTx(attachment?: {
  id: string;
  opportunityId: string;
  storagePath: string;
  fileName: string;
  uploadedBy: string;
  sizeBytes: bigint | null;
}): TenantTx {
  return {
    opportunityAttachment: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: { sizeBytes?: number } }) =>
          Promise.resolve({
            id: 'attachment-1',
            createdAt: new Date(),
            ...data,
            sizeBytes:
              data.sizeBytes === undefined ? null : BigInt(data.sizeBytes),
          }),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(
            attachment && where.id === attachment.id ? attachment : null,
          ),
        ),
      findMany: jest.fn().mockResolvedValue(attachment ? [attachment] : []),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('OpportunityAttachmentService', () => {
  it('createUploadUrl checa visibilidade de leitura, cria o metadado e devolve a signed URL', async () => {
    const opportunities = fakeOpportunityService();
    const storage = fakeStorage();
    const service = new OpportunityAttachmentService(opportunities, storage);
    const tx = fakeTx();

    const result = await service.createUploadUrl(
      tx,
      membership(),
      OPPORTUNITY_ID,
      { fileName: 'proposta.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
    );

    expect(opportunities.mustBeVisible).toHaveBeenCalledWith(
      tx,
      membership(),
      OPPORTUNITY_ID,
      'read',
    );
    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      expect.stringContaining(`${WORKSPACE_ID}/opportunities/${OPPORTUNITY_ID}/`),
    );
    expect(result.uploadUrl).toBe('https://storage.example/upload');
    expect(result.attachment.sizeBytes).toBe(2048);
    expect(typeof result.attachment.sizeBytes).toBe('number');
  });

  it('sanitiza o nome do arquivo no caminho do storage (sem path traversal)', async () => {
    const storage = fakeStorage();
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      storage,
    );
    const tx = fakeTx();

    await service.createUploadUrl(tx, membership(), OPPORTUNITY_ID, {
      fileName: '../../etc/passwd',
      mimeType: 'text/plain',
    });

    const calledPath = (storage.createUploadUrl as jest.Mock).mock
      .calls[0][0] as string;
    expect(calledPath).not.toContain('..');
    expect(calledPath).not.toContain('/etc/passwd');
  });

  it('createDownloadUrl 404 pra anexo inexistente', async () => {
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
    );
    const tx = fakeTx();
    await expect(
      service.createDownloadUrl(tx, membership(), OPPORTUNITY_ID, 'attachment-x'),
    ).rejects.toThrow(NotFoundException);
  });

  it('createDownloadUrl devolve a signed URL pra anexo existente', async () => {
    const attachment = {
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: `${WORKSPACE_ID}/opportunities/${OPPORTUNITY_ID}/arquivo.pdf`,
      fileName: 'arquivo.pdf',
      uploadedBy: 'user-1',
      sizeBytes: null,
    };
    const storage = fakeStorage();
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      storage,
    );
    const tx = fakeTx(attachment);

    const result = await service.createDownloadUrl(
      tx,
      membership(),
      OPPORTUNITY_ID,
      'attachment-1',
    );
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      attachment.storagePath,
    );
    expect(result.url).toBe('https://storage.example/download');
  });

  it('CRÍTICO: só quem fez upload pode remover o anexo', async () => {
    const attachment = {
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: 'path',
      fileName: 'a.pdf',
      uploadedBy: 'outro-user',
      sizeBytes: null,
    };
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
    );
    const tx = fakeTx(attachment);
    await expect(
      service.remove(
        tx,
        membership({ userId: 'user-1' }),
        OPPORTUNITY_ID,
        'attachment-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permite a quem fez upload remover o próprio anexo (storage + linha)', async () => {
    const attachment = {
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: 'ws/opportunities/opp/arquivo.pdf',
      fileName: 'a.pdf',
      uploadedBy: 'user-1',
      sizeBytes: null,
    };
    const storage = fakeStorage();
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      storage,
    );
    const tx = fakeTx(attachment);

    await service.remove(tx, membership({ userId: 'user-1' }), OPPORTUNITY_ID, 'attachment-1');
    expect(storage.remove).toHaveBeenCalledWith(attachment.storagePath);
  });
});
