import type { Opportunity, Stage } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { ActivityService } from '../activities/activity.service';
import { OptimisticConcurrencyException } from '../common/exceptions/optimistic-concurrency.exception';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { OpportunityService } from './opportunity.service';

const WORKSPACE_ID = 'workspace-1';
const OWNER_USER_ID = 'user-owner';
const OPPORTUNITY_ID = 'opp-1';
const COMPANY_ID = 'company-1';
const PIPELINE_ID = 'pipeline-1';
const STAGE_ID = 'stage-1';
const OTHER_STAGE_ID = 'stage-2';
const OTHER_PIPELINE_ID = 'pipeline-2';

function membership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: OWNER_USER_ID,
    role: 'owner',
    status: 'active',
    ...overrides,
  };
}

function baseOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPPORTUNITY_ID,
    workspaceId: WORKSPACE_ID,
    companyId: COMPANY_ID,
    pipelineId: PIPELINE_ID,
    stageId: STAGE_ID,
    ownerUserId: OWNER_USER_ID,
    amount: 1000 as unknown as Opportunity['amount'],
    currency: 'BRL',
    expectedCloseDate: null,
    status: 'open',
    lostReason: null,
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    closedAt: null,
    ...overrides,
  };
}

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: STAGE_ID,
    pipelineId: PIPELINE_ID,
    name: 'Stage',
    order: 1,
    probability: 50,
    isWon: false,
    isLost: false,
    ...overrides,
  };
}

interface FakeTxOptions {
  opportunity?: Opportunity;
  updateManyCount?: number;
  stagesById?: Record<string, Stage | null>;
}

function fakeTx(options: FakeTxOptions = {}): TenantTx {
  const opp = options.opportunity ?? baseOpportunity();
  const stagesById = options.stagesById ?? { [STAGE_ID]: stage() };

  return {
    membership: {
      findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: COMPANY_ID, deletedAt: null }),
    },
    pipeline: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === PIPELINE_ID || where.id === OTHER_PIPELINE_ID
              ? { id: where.id, workspaceId: WORKSPACE_ID }
              : null,
          ),
        ),
    },
    stage: {
      findFirst: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { id: string; pipelineId: string } }) => {
            const found = stagesById[where.id];
            if (!found || found.pipelineId !== where.pipelineId)
              return Promise.resolve(null);
            return Promise.resolve(found);
          },
        ),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(stagesById[where.id] ?? null),
        ),
    },
    opportunity: {
      findFirst: jest.fn().mockResolvedValue(opp),
      findUniqueOrThrow: jest.fn().mockResolvedValue(opp),
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: options.updateManyCount ?? 1 }),
      create: jest.fn().mockResolvedValue(opp),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    activity: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('OpportunityService', () => {
  let service: OpportunityService;
  let policy: PolicyService;
  let activities: ActivityService;

  beforeEach(() => {
    policy = new PolicyService();
    activities = new ActivityService(policy);
    service = new OpportunityService(policy, activities);
  });

  // 2026-08-12: listar filtrado por companyId (aba "Oportunidades" da
  // ficha da empresa) usa empresas_oportunidades.ver, separada da tela
  // geral (Pipeline). Mesmo cuidado de TaskService — trava aqui pra não
  // regredir se o ternário de findAll() for invertido.
  describe('findAll — empresas_oportunidades vs. oportunidades (2026-08-12)', () => {
    it('sem companyId, usa a permissão global "oportunidades"', async () => {
      const tx = fakeTx();
      const m = membership({
        role: 'sales_rep',
        permissions: {
          oportunidades: { ver: false },
          empresas_oportunidades: { ver: true },
        },
      });
      await expect(service.findAll(tx, m, {})).rejects.toThrow(
        'Sem permissão para ver oportunidades.',
      );
    });

    it('com companyId, usa "empresas_oportunidades", não a global', async () => {
      const tx = fakeTx();
      const m = membership({
        role: 'sales_rep',
        permissions: {
          oportunidades: { ver: true },
          empresas_oportunidades: { ver: false },
        },
      });
      await expect(
        service.findAll(tx, m, { companyId: COMPANY_ID }),
      ).rejects.toThrow('Sem permissão para ver oportunidades.');
    });
  });

  describe('update — regras de negócio', () => {
    it('rejeita stage que não pertence ao pipeline informado', async () => {
      const tx = fakeTx({
        stagesById: {
          [OTHER_STAGE_ID]: stage({
            id: OTHER_STAGE_ID,
            pipelineId: OTHER_PIPELINE_ID,
          }),
        },
      });
      await expect(
        service.update(tx, membership(), OPPORTUNITY_ID, {
          version: 1,
          stageId: OTHER_STAGE_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita status "lost" sem lostReason', async () => {
      const tx = fakeTx();
      await expect(
        service.update(tx, membership(), OPPORTUNITY_ID, {
          version: 1,
          status: 'lost',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita status "lost" com lostReason', async () => {
      const tx = fakeTx();
      await expect(
        service.update(tx, membership(), OPPORTUNITY_ID, {
          version: 1,
          status: 'lost',
          lostReason: 'Perdeu pro concorrente',
        }),
      ).resolves.toBeDefined();
    });

    it('bloqueia transição direta won -> lost (exige reabrir primeiro)', async () => {
      const tx = fakeTx({
        opportunity: baseOpportunity({ status: 'won', closedAt: new Date() }),
      });
      await expect(
        service.update(tx, membership(), OPPORTUNITY_ID, {
          version: 1,
          status: 'lost',
          lostReason: 'Motivo',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('permite reabrir (won -> open)', async () => {
      const tx = fakeTx({
        opportunity: baseOpportunity({ status: 'won', closedAt: new Date() }),
      });
      await expect(
        service.update(tx, membership(), OPPORTUNITY_ID, {
          version: 1,
          status: 'open',
        }),
      ).resolves.toBeDefined();
    });

    it('CRÍTICO: version diferente da atual rejeita com OptimisticConcurrencyException (atalho de UX)', async () => {
      const tx = fakeTx({ opportunity: baseOpportunity({ version: 5 }) });
      await expect(
        service.update(tx, membership(), OPPORTUNITY_ID, {
          version: 1,
          amount: 2000,
        }),
      ).rejects.toThrow(OptimisticConcurrencyException);
    });

    it('CRÍTICO: corrida detectada no updateMany (count=0) também rejeita com OptimisticConcurrencyException', async () => {
      const tx = fakeTx({ updateManyCount: 0 });
      await expect(
        service.update(tx, membership(), OPPORTUNITY_ID, {
          version: 1,
          amount: 2000,
        }),
      ).rejects.toThrow(OptimisticConcurrencyException);
    });

    it('mudança de stage emite Activity type stage_change com backward calculado', async () => {
      const tx = fakeTx({
        stagesById: {
          [STAGE_ID]: stage({ id: STAGE_ID, order: 3 }),
          [OTHER_STAGE_ID]: stage({ id: OTHER_STAGE_ID, order: 1 }),
        },
      });
      await service.update(tx, membership(), OPPORTUNITY_ID, {
        version: 1,
        stageId: OTHER_STAGE_ID,
      });

      interface ActivityCreateArgs {
        data: { type: string; payload: { backward: boolean } };
      }
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() não usa `this`
      const createMock = tx.activity.create as unknown as jest.Mock<
        unknown,
        [ActivityCreateArgs]
      >;
      const stageChangeCall = createMock.mock.calls.find(
        ([args]) => args.data.type === 'stage_change',
      );
      expect(stageChangeCall).toBeDefined();
      expect(stageChangeCall?.[0].data.payload.backward).toBe(true);
    });
  });
});
