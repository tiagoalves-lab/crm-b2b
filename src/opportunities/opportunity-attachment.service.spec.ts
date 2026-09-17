import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import { comRegistroDeExclusao } from '../deletion-log/registro-exclusao.fake';
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

type FakeAttachment = {
  id: string;
  opportunityId: string;
  storagePath: string;
  fileName: string;
  uploadedBy: string;
  sizeBytes: bigint | null;
  // Estado de publicação (2026-09-15): o fake assume PUBLICADO quando o
  // teste não diz nada, que é o estado normal de um anexo; os testes de
  // reserva passam `publishedAt: null` explícito.
  publishedAt?: Date | null;
};

type FakeWhere = { id?: string; publishedAt?: { not: null } };

function fakeTx(attachment?: FakeAttachment): TenantTx {
  const row = attachment
    ? { publishedAt: new Date('2026-09-01T12:00:00Z'), ...attachment }
    : undefined;
  // Só o filtro de publicação vira lógica de verdade aqui — é a regra
  // nova que os testes precisam exercitar de fato.
  const visivel = (where: FakeWhere | undefined) =>
    row !== undefined &&
    (where?.publishedAt === undefined || row.publishedAt !== null);

  return comRegistroDeExclusao({
    opportunityAttachment: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: { sizeBytes?: number } }) =>
          Promise.resolve({
            id: 'attachment-1',
            createdAt: new Date(),
            publishedAt: null,
            ...data,
            sizeBytes:
              data.sizeBytes === undefined ? null : BigInt(data.sizeBytes),
          }),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: FakeWhere }) =>
          Promise.resolve(
            row && where.id === row.id && visivel(where) ? row : null,
          ),
        ),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where?: FakeWhere }) =>
          Promise.resolve(visivel(where) ? [row] : []),
        ),
      update: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: { publishedAt: Date } }) =>
            Promise.resolve({ ...row, ...data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx);
}

describe('OpportunityAttachmentService', () => {
  const policy = new PolicyService();

  it('createUploadUrl checa visibilidade de leitura, cria o metadado e devolve a signed URL', async () => {
    const opportunities = fakeOpportunityService();
    const storage = fakeStorage();
    const service = new OpportunityAttachmentService(
      opportunities,
      storage,
      policy,
    );
    const tx = fakeTx();

    const result = await service.createUploadUrl(
      tx,
      membership(),
      OPPORTUNITY_ID,
      {
        fileName: 'proposta.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
    );

    expect(opportunities.mustBeVisible).toHaveBeenCalledWith(
      tx,
      membership(),
      OPPORTUNITY_ID,
      'read',
    );
    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      expect.stringContaining(
        `${WORKSPACE_ID}/opportunities/${OPPORTUNITY_ID}/`,
      ),
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
      policy,
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
      policy,
    );
    const tx = fakeTx();
    await expect(
      service.createDownloadUrl(
        tx,
        membership(),
        OPPORTUNITY_ID,
        'attachment-x',
      ),
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
      policy,
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

  // role 'manager' de propósito nos dois testes abaixo — verificam o
  // critério de autoria, não a restrição de papel (teste dedicado logo
  // após).
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
      policy,
    );
    const tx = fakeTx(attachment);
    await expect(
      service.remove(
        tx,
        membership({ role: 'manager', userId: 'user-1' }),
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
      policy,
    );
    const tx = fakeTx(attachment);

    await service.remove(
      tx,
      membership({ role: 'manager', userId: 'user-1' }),
      OPPORTUNITY_ID,
      'attachment-1',
    );
    expect(storage.remove).toHaveBeenCalledWith(attachment.storagePath);
  });

  // ── Publicação do anexo (2026-09-15) ────────────────────────────────
  it('anexo enviado por admin nasce reservado; por representante, já publicado', async () => {
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
      policy,
    );

    const doAdmin = await service.createUploadUrl(
      fakeTx(),
      membership({ role: 'admin' }),
      OPPORTUNITY_ID,
      { fileName: 'proposta.pdf' },
    );
    expect(doAdmin.attachment.publishedAt).toBeNull();

    const doRep = await service.createUploadUrl(
      fakeTx(),
      membership({ role: 'sales_rep' }),
      OPPORTUNITY_ID,
      { fileName: 'pedido.pdf' },
    );
    expect(doRep.attachment.publishedAt).toBeInstanceOf(Date);
  });

  it('CRÍTICO: anexo reservado não aparece na lista de gerente/representante', async () => {
    const reservado: FakeAttachment = {
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: 'ws/opportunities/opp/arquivo.pdf',
      fileName: 'a.pdf',
      uploadedBy: 'user-admin',
      sizeBytes: null,
      publishedAt: null,
    };
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
      policy,
    );

    await expect(
      service.findAll(
        fakeTx(reservado),
        membership({ role: 'manager' }),
        OPPORTUNITY_ID,
      ),
    ).resolves.toEqual([]);
    await expect(
      service.findAll(
        fakeTx(reservado),
        membership({ role: 'sales_rep' }),
        OPPORTUNITY_ID,
      ),
    ).resolves.toEqual([]);
    await expect(
      service.findAll(
        fakeTx(reservado),
        membership({ role: 'admin' }),
        OPPORTUNITY_ID,
      ),
    ).resolves.toHaveLength(1);
  });

  it('CRÍTICO: download de anexo reservado responde 404 pra representante', async () => {
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
      policy,
    );
    const tx = fakeTx({
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: 'ws/opportunities/opp/arquivo.pdf',
      fileName: 'a.pdf',
      uploadedBy: 'user-admin',
      sizeBytes: null,
      publishedAt: null,
    });
    await expect(
      service.createDownloadUrl(
        tx,
        membership({ role: 'sales_rep' }),
        OPPORTUNITY_ID,
        'attachment-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('publish carimba a data e não muda nada se já estava publicado', async () => {
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
      policy,
    );
    const base: FakeAttachment = {
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: 'ws/opportunities/opp/arquivo.pdf',
      fileName: 'a.pdf',
      uploadedBy: 'user-admin',
      sizeBytes: null,
    };

    const txReservado = fakeTx({ ...base, publishedAt: null });
    const publicado = await service.publish(
      txReservado,
      membership({ role: 'owner' }),
      OPPORTUNITY_ID,
      'attachment-1',
    );
    expect(publicado.publishedAt).toBeInstanceOf(Date);

    const txJaPublicado = fakeTx(base);
    await service.publish(
      txJaPublicado,
      membership({ role: 'owner' }),
      OPPORTUNITY_ID,
      'attachment-1',
    );
    expect(
      (txJaPublicado.opportunityAttachment.update as jest.Mock).mock.calls,
    ).toHaveLength(0);
  });

  it('CRÍTICO: gerente não publica anexo', async () => {
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
      policy,
    );
    const tx = fakeTx({
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: 'ws/opportunities/opp/arquivo.pdf',
      fileName: 'a.pdf',
      uploadedBy: 'user-1',
      sizeBytes: null,
    });
    await expect(
      service.publish(
        tx,
        membership({ role: 'manager' }),
        OPPORTUNITY_ID,
        'attachment-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('CRÍTICO: representante (sales_rep) não remove nem o próprio anexo', async () => {
    const attachment = {
      id: 'attachment-1',
      opportunityId: OPPORTUNITY_ID,
      storagePath: 'ws/opportunities/opp/arquivo.pdf',
      fileName: 'a.pdf',
      uploadedBy: 'user-1',
      sizeBytes: null,
    };
    const service = new OpportunityAttachmentService(
      fakeOpportunityService(),
      fakeStorage(),
      policy,
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
});
