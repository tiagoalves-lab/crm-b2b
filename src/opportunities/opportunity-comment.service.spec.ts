import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { NotificationService } from '../notifications/notification.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import { comRegistroDeExclusao } from '../deletion-log/registro-exclusao.fake';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { OpportunityCommentService } from './opportunity-comment.service';
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

function fakeTx(comment?: {
  id: string;
  opportunityId: string;
  authorUserId: string;
}): TenantTx {
  return comRegistroDeExclusao({
    opportunityComment: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'comment-1', ...data }),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(comment && where.id === comment.id ? comment : null),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
    opportunityCommentEdit: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as TenantTx);
}

function fakeNotifications(): NotificationService {
  return { avisarMencao: jest.fn() } as unknown as NotificationService;
}

describe('OpportunityCommentService', () => {
  const policy = new PolicyService();

  it('cria comentário verificando visibilidade de leitura (não escrita)', async () => {
    const opportunities = fakeOpportunityService();
    const service = new OpportunityCommentService(
      opportunities,
      policy,
      fakeNotifications(),
    );
    const tx = fakeTx();
    await service.create(tx, membership(), OPPORTUNITY_ID, { body: 'oi' });
    expect(opportunities.mustBeVisible).toHaveBeenCalledWith(
      tx,
      membership(),
      OPPORTUNITY_ID,
      'read',
    );
  });

  // role 'manager' de propósito nos testes abaixo (exceto o último) — o
  // que eles verificam é o critério de autoria/existência, não a
  // restrição de papel (essa tem teste dedicado no fim do describe).
  it('404 ao remover comentário inexistente', async () => {
    const service = new OpportunityCommentService(
      fakeOpportunityService(),
      policy,
      fakeNotifications(),
    );
    const tx = fakeTx();
    await expect(
      service.remove(
        tx,
        membership({ role: 'manager' }),
        OPPORTUNITY_ID,
        'comment-x',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('CRÍTICO: só o autor pode remover o próprio comentário', async () => {
    const comment = {
      id: 'comment-1',
      opportunityId: OPPORTUNITY_ID,
      body: 'Comentário de teste',
      authorUserId: 'outro-user',
    };
    const service = new OpportunityCommentService(
      fakeOpportunityService(),
      policy,
      fakeNotifications(),
    );
    const tx = fakeTx(comment);
    await expect(
      service.remove(
        tx,
        membership({ role: 'manager', userId: 'user-1' }),
        OPPORTUNITY_ID,
        'comment-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permite ao autor remover o próprio comentário', async () => {
    const comment = {
      id: 'comment-1',
      opportunityId: OPPORTUNITY_ID,
      body: 'Comentário de teste',
      authorUserId: 'user-1',
    };
    const service = new OpportunityCommentService(
      fakeOpportunityService(),
      policy,
      fakeNotifications(),
    );
    const tx = fakeTx(comment);
    await expect(
      service.remove(
        tx,
        membership({ role: 'manager', userId: 'user-1' }),
        OPPORTUNITY_ID,
        'comment-1',
      ),
    ).resolves.toBeUndefined();
  });

  it('CRÍTICO: representante (sales_rep) não remove nem o próprio comentário', async () => {
    const comment = {
      id: 'comment-1',
      opportunityId: OPPORTUNITY_ID,
      body: 'Comentário de teste',
      authorUserId: 'user-1',
    };
    const service = new OpportunityCommentService(
      fakeOpportunityService(),
      policy,
      fakeNotifications(),
    );
    const tx = fakeTx(comment);
    await expect(
      service.remove(
        tx,
        membership({ userId: 'user-1' }),
        OPPORTUNITY_ID,
        'comment-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // Edição do texto com histórico (2026-10-16).
  describe('editar comentário', () => {
    type Comentario = {
      id: string;
      opportunityId: string;
      body: string;
      authorUserId: string;
      externalRef: string | null;
    };

    function editTx(comment: Comentario | null) {
      return {
        opportunityComment: {
          findFirst: jest.fn().mockResolvedValue(comment),
          update: jest.fn().mockResolvedValue({}),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ ...comment, edits: [] }),
        },
        opportunityCommentEdit: { create: jest.fn().mockResolvedValue({}) },
      } as unknown as TenantTx & {
        opportunityComment: { update: jest.Mock };
        opportunityCommentEdit: { create: jest.Mock };
      };
    }

    function service(opportunities = fakeOpportunityService()) {
      return new OpportunityCommentService(
        opportunities,
        policy,
        fakeNotifications(),
      );
    }

    const meu: Comentario = {
      id: 'comment-1',
      opportunityId: OPPORTUNITY_ID,
      body: 'Orçamneto enviado',
      authorUserId: 'user-1',
      externalRef: null,
    };

    it('autor corrige o texto e a versão anterior vai pro histórico', async () => {
      const opportunities = fakeOpportunityService();
      const tx = editTx(meu);
      await service(opportunities).update(
        tx,
        membership(),
        OPPORTUNITY_ID,
        'comment-1',
        '  Orçamento enviado  ',
      );
      // Mesma permissão de comentar: basta enxergar o card.
      expect(opportunities.mustBeVisible).toHaveBeenCalledWith(
        tx,
        membership(),
        OPPORTUNITY_ID,
        'read',
      );
      expect(tx.opportunityCommentEdit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          commentId: 'comment-1',
          opportunityId: OPPORTUNITY_ID,
          bodyBefore: 'Orçamneto enviado',
          bodyAfter: 'Orçamento enviado',
          editedByUserId: 'user-1',
        }) as unknown,
      });
      expect(tx.opportunityComment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: expect.objectContaining({ body: 'Orçamento enviado' }) as unknown,
      });
    });

    it('texto igual não grava edição', async () => {
      const tx = editTx(meu);
      await service().update(
        tx,
        membership(),
        OPPORTUNITY_ID,
        'comment-1',
        'Orçamneto enviado',
      );
      expect(tx.opportunityCommentEdit.create).not.toHaveBeenCalled();
      expect(tx.opportunityComment.update).not.toHaveBeenCalled();
    });

    it('404 antes de 403: comentário inexistente', async () => {
      await expect(
        service().update(
          editTx(null),
          membership(),
          OPPORTUNITY_ID,
          'comment-x',
          'novo',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('CRÍTICO: ninguém edita o comentário de outra pessoa', async () => {
      const tx = editTx({ ...meu, authorUserId: 'outro-user' });
      await expect(
        service().update(
          tx,
          membership({ role: 'owner' }),
          OPPORTUNITY_ID,
          'comment-1',
          'novo',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.opportunityCommentEdit.create).not.toHaveBeenCalled();
    });

    it('mensagem do Trello não se edita pelo CRM', async () => {
      const tx = editTx({ ...meu, externalRef: 'a'.repeat(24) });
      await expect(
        service().update(tx, membership(), OPPORTUNITY_ID, 'comment-1', 'novo'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('texto vazio é recusado', async () => {
      await expect(
        service().update(
          editTx(meu),
          membership(),
          OPPORTUNITY_ID,
          'comment-1',
          '   ',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // Lido / não lido no histórico de anotações (2026-09-17).
  describe('marcar como lido', () => {
    function readTx(comment: { id: string; readByUserIds: string[] } | null) {
      return {
        opportunityComment: {
          findFirst: jest.fn().mockResolvedValue(comment),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn().mockResolvedValue({}),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
      } as unknown as TenantTx & {
        opportunityComment: { findFirst: jest.Mock; update: jest.Mock };
      };
    }

    function service() {
      return new OpportunityCommentService(
        fakeOpportunityService(),
        policy,
        fakeNotifications(),
      );
    }

    it('CRÍTICO: representante só alcança anotação de card dele (404 fora do escopo)', async () => {
      const tx = readTx(null);
      await expect(
        service().setRead(tx, membership({ userId: 'user-1' }), 'c-1', true),
      ).rejects.toThrow(NotFoundException);
      const { where } = tx.opportunityComment.findFirst.mock.calls[0][0] as {
        where: { opportunity: { ownerUserId: string } };
      };
      expect(where.opportunity.ownerUserId).toBe('user-1');
    });

    it('proprietário enxerga todas as anotações do workspace (sem filtro de dono)', async () => {
      const tx = readTx({ id: 'c-1', readByUserIds: [] });
      await service().setRead(tx, membership({ role: 'owner' }), 'c-1', true);
      const { where } = tx.opportunityComment.findFirst.mock.calls[0][0] as {
        where: { opportunity: Record<string, unknown> };
      };
      expect(where.opportunity).not.toHaveProperty('ownerUserId');
    });

    it('marca e desmarca só a leitura de quem chamou', async () => {
      const tx = readTx({ id: 'c-1', readByUserIds: ['outro'] });
      await service().setRead(tx, membership(), 'c-1', true);
      expect(tx.opportunityComment.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { readByUserIds: ['outro', 'user-1'] },
      });

      const tx2 = readTx({ id: 'c-1', readByUserIds: ['outro', 'user-1'] });
      await service().setRead(tx2, membership(), 'c-1', false);
      expect(tx2.opportunityComment.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { readByUserIds: ['outro'] },
      });
    });

    it('marcar tudo sem pendência não grava nada', async () => {
      const tx = readTx(null);
      await expect(service().markAllRead(tx, membership())).resolves.toEqual({
        marcadas: 0,
      });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    // Selo de não lidas na barra do Pipeline (2026-10-21).
    it('contagem de não lidas: escopo do representante, sem a leitura dele e sem o que ele escreveu', async () => {
      const count = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(5);
      const tx = { opportunityComment: { count } } as unknown as TenantTx;
      await expect(
        service().contagem(tx, membership({ userId: 'user-1' })),
      ).resolves.toEqual({ fixados: 2, naoLidas: 5 });

      const { where } = count.mock.calls[1][0] as {
        where: {
          opportunity: { ownerUserId: string };
          NOT: unknown;
          OR: unknown[];
        };
      };
      expect(where.opportunity.ownerUserId).toBe('user-1');
      expect(where.NOT).toEqual({ readByUserIds: { has: 'user-1' } });
      expect(where.OR).toContainEqual({ authorUserId: { not: 'user-1' } });
    });
  });
});
