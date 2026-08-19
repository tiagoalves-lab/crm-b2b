import { BadRequestException } from '@nestjs/common';
import { ActivityService } from '../activities/activity.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { TaskService } from './task.service';

const WORKSPACE_ID = 'workspace-1';
const USER_ID = 'user-1';
const COMPANY_ID = 'company-1';
const OTHER_COMPANY_ID = 'company-2';
const OPPORTUNITY_ID = 'opportunity-1';
const CONTACT_ID = 'contact-1';

function membership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: 'owner',
    status: 'active',
    ...overrides,
  };
}

function fakeTx(options: { existingTask?: object } = {}): TenantTx {
  return {
    membership: {
      findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
    },
    company: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: COMPANY_ID, deletedAt: null }),
    },
    opportunity: {
      findFirst: jest.fn().mockResolvedValue({
        id: OPPORTUNITY_ID,
        deletedAt: null,
        companyId: COMPANY_ID,
      }),
    },
    contact: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { companyId?: string } }) =>
          Promise.resolve(
            where.companyId === COMPANY_ID
              ? {
                  id: CONTACT_ID,
                  workspaceId: WORKSPACE_ID,
                  companyId: COMPANY_ID,
                }
              : null,
          ),
        ),
    },
    task: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'task-1', ...data }),
        ),
      findFirst: jest.fn().mockResolvedValue(options.existingTask ?? null),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...(options.existingTask ?? {}), ...data }),
        ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    activity: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as TenantTx;
}

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService(
      new PolicyService(),
      new ActivityService(new PolicyService()),
    );
  });

  // 2026-08-12: listar filtrado por companyId (aba "Tarefas" da ficha da
  // empresa) usa a permissão empresas_tarefas.ver, separada da tela geral
  // (tarefas.ver) — trava aqui pra não regredir silenciosamente se a
  // condição do ternário em findAll() for invertida por engano.
  describe('findAll — empresas_tarefas vs. tarefas (2026-08-12)', () => {
    it('sem companyId, usa a permissão global "tarefas"', async () => {
      const tx = fakeTx();
      const m = membership({
        role: 'sales_rep',
        permissions: {
          tarefas: { ver: false },
          empresas_tarefas: { ver: true },
        },
      });
      await expect(service.findAll(tx, m, {})).rejects.toThrow(
        'Sem permissão para ver tarefas.',
      );
    });

    it('com companyId, usa a permissão "empresas_tarefas", não a global', async () => {
      const tx = fakeTx();
      const m = membership({
        role: 'sales_rep',
        permissions: {
          tarefas: { ver: true },
          empresas_tarefas: { ver: false },
        },
      });
      await expect(
        service.findAll(tx, m, { companyId: COMPANY_ID }),
      ).rejects.toThrow('Sem permissão para ver tarefas.');
    });

    it('com companyId e empresas_tarefas.ver=true, passa mesmo com tarefas.ver=false', async () => {
      const tx = fakeTx();
      const m = membership({
        role: 'sales_rep',
        permissions: {
          tarefas: { ver: false },
          empresas_tarefas: { ver: true },
        },
      });
      await expect(
        service.findAll(tx, m, { companyId: COMPANY_ID }),
      ).resolves.toBeDefined();
    });
  });

  describe('create — relação polimórfica exatamente um', () => {
    it('aceita quando exatamente um alvo é informado', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Ligar pro cliente',
          companyId: COMPANY_ID,
        }),
      ).resolves.toBeDefined();
    });

    it('CRÍTICO: rejeita quando nenhum alvo é informado (0 de 2)', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Tarefa sem alvo',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CRÍTICO: rejeita quando mais de um alvo é informado (2 de 2)', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Tarefa ambígua',
          companyId: COMPANY_ID,
          opportunityId: OPPORTUNITY_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — contato obrigatório pra ligação/reunião/visita/e-mail', () => {
    it('CRÍTICO: rejeita e-mail sem contactId', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Enviar e-mail de follow-up',
          companyId: COMPANY_ID,
          tipo: 'email',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita e-mail com contactId da mesma empresa', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Enviar e-mail de follow-up',
          companyId: COMPANY_ID,
          tipo: 'email',
          contactId: CONTACT_ID,
        }),
      ).resolves.toBeDefined();
    });

    it('CRÍTICO: rejeita ligação sem contactId', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Ligar pro cliente',
          companyId: COMPANY_ID,
          tipo: 'ligacao',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita ligação com contactId da mesma empresa', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Ligar pro cliente',
          companyId: COMPANY_ID,
          tipo: 'ligacao',
          contactId: CONTACT_ID,
        }),
      ).resolves.toBeDefined();
    });

    it('CRÍTICO: rejeita contactId de outra empresa', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Ligar pro cliente',
          companyId: OTHER_COMPANY_ID,
          tipo: 'ligacao',
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('não exige contato pra tipos que não são ligação/reunião/visita', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Enviar proposta',
          companyId: COMPANY_ID,
          tipo: 'proposta',
        }),
      ).resolves.toBeDefined();
    });

    it('resolve a empresa via opportunity pra validar o contato', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, membership(), {
          title: 'Visitar cliente',
          opportunityId: OPPORTUNITY_ID,
          tipo: 'visita',
          contactId: CONTACT_ID,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('update — status explícito', () => {
    const existingTask = {
      id: 'task-1',
      workspaceId: WORKSPACE_ID,
      assigneeUserId: USER_ID,
      companyId: COMPANY_ID,
      opportunityId: null,
      status: 'pending',
      title: 'Ligar pro cliente',
    };

    it('conclui a tarefa quando status=done é enviado', async () => {
      const tx = fakeTx({ existingTask });
      const updated = await service.update(tx, membership(), 'task-1', {
        status: 'done',
      });
      expect(updated.status).toBe('done');
    });

    it('reabre a tarefa quando status=pending é enviado', async () => {
      const tx = fakeTx({
        existingTask: { ...existingTask, status: 'done' },
      });
      const updated = await service.update(tx, membership(), 'task-1', {
        status: 'pending',
      });
      expect(updated.status).toBe('pending');
    });
  });

  describe('update — contato obrigatório pra ligação/reunião/visita/e-mail', () => {
    const existingTask = {
      id: 'task-1',
      workspaceId: WORKSPACE_ID,
      assigneeUserId: USER_ID,
      companyId: COMPANY_ID,
      opportunityId: null,
      status: 'pending',
      title: 'Ligar pro cliente',
      tipo: null,
      contactId: null,
    };

    it('CRÍTICO: rejeita trocar pra reunião sem informar contactId', async () => {
      const tx = fakeTx({ existingTask });
      await expect(
        service.update(tx, membership(), 'task-1', { tipo: 'reuniao' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita trocar pra reunião informando contactId da mesma empresa', async () => {
      const tx = fakeTx({ existingTask });
      await expect(
        service.update(tx, membership(), 'task-1', {
          tipo: 'reuniao',
          contactId: CONTACT_ID,
        }),
      ).resolves.toBeDefined();
    });

    it('mantém válido quando contactId já estava salvo e só outro campo muda', async () => {
      const tx = fakeTx({
        existingTask: {
          ...existingTask,
          tipo: 'visita',
          contactId: CONTACT_ID,
        },
      });
      await expect(
        service.update(tx, membership(), 'task-1', {
          title: 'Visita remarcada',
        }),
      ).resolves.toBeDefined();
    });
  });
});
