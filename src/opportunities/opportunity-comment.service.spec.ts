import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { OpportunityCommentService } from './opportunity-comment.service';
import type { OpportunityService } from './opportunity.service';

const WORKSPACE_ID = 'workspace-1';
const OPPORTUNITY_ID = 'opp-1';

function membership(overrides: Partial<MembershipContext> = {}): MembershipContext {
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

function fakeTx(comment?: { id: string; opportunityId: string; authorUserId: string }): TenantTx {
  return {
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
  } as unknown as TenantTx;
}

describe('OpportunityCommentService', () => {
  it('cria comentário verificando visibilidade de leitura (não escrita)', async () => {
    const opportunities = fakeOpportunityService();
    const service = new OpportunityCommentService(opportunities);
    const tx = fakeTx();
    await service.create(tx, membership(), OPPORTUNITY_ID, { body: 'oi' });
    expect(opportunities.mustBeVisible).toHaveBeenCalledWith(
      tx,
      membership(),
      OPPORTUNITY_ID,
      'read',
    );
  });

  it('404 ao remover comentário inexistente', async () => {
    const service = new OpportunityCommentService(fakeOpportunityService());
    const tx = fakeTx();
    await expect(
      service.remove(tx, membership(), OPPORTUNITY_ID, 'comment-x'),
    ).rejects.toThrow(NotFoundException);
  });

  it('CRÍTICO: só o autor pode remover o próprio comentário', async () => {
    const comment = { id: 'comment-1', opportunityId: OPPORTUNITY_ID, authorUserId: 'outro-user' };
    const service = new OpportunityCommentService(fakeOpportunityService());
    const tx = fakeTx(comment);
    await expect(
      service.remove(tx, membership({ userId: 'user-1' }), OPPORTUNITY_ID, 'comment-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('permite ao autor remover o próprio comentário', async () => {
    const comment = { id: 'comment-1', opportunityId: OPPORTUNITY_ID, authorUserId: 'user-1' };
    const service = new OpportunityCommentService(fakeOpportunityService());
    const tx = fakeTx(comment);
    await expect(
      service.remove(tx, membership({ userId: 'user-1' }), OPPORTUNITY_ID, 'comment-1'),
    ).resolves.toBeUndefined();
  });
});
