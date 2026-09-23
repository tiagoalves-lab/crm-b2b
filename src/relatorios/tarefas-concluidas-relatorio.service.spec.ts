import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { PolicyService } from '../policy/policy.service';
import { TarefasConcluidasRelatorioService } from './tarefas-concluidas-relatorio.service';

const REP = '33333333-3333-4333-8333-333333333333';
const OUTRO = '44444444-4444-4444-8444-444444444444';
const PERIODO = { inicio: '2026-09-01', fim: '2026-09-30' };

function membership(role: string, userId = REP): MembershipContext {
  return {
    id: 'm-1',
    userId,
    workspaceId: 'ws-1',
    role,
    status: 'active',
  } as MembershipContext;
}

function criarTx(conclusoes: unknown[], tarefas: unknown[]) {
  const activityFindMany = jest.fn().mockResolvedValue(conclusoes);
  const taskFindMany = jest.fn().mockResolvedValue(tarefas);
  const tx = {
    activity: { findMany: activityFindMany },
    task: { findMany: taskFindMany },
  } as unknown as TenantTx;
  return { tx, activityFindMany, taskFindMany };
}

function criarPolicy(
  opts: { podeVer?: boolean; ownerUserId?: unknown } = {},
): PolicyService {
  return {
    canModule: jest.fn().mockReturnValue(opts.podeVer ?? true),
    scopeFilter: jest
      .fn()
      .mockResolvedValue(
        opts.ownerUserId === undefined ? {} : { ownerUserId: opts.ownerUserId },
      ),
  } as unknown as PolicyService;
}

function conclusao(taskId: string, quando: string) {
  return { occurredAt: new Date(quando), payload: { action: 'completed', taskId } };
}

function tarefa(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Tarefa ${id}`,
    description: null,
    tipo: 'ligacao',
    dueAt: null,
    assigneeUserId: REP,
    company: null,
    opportunity: null,
    ...over,
  };
}

describe('TarefasConcluidasRelatorioService', () => {
  it('recusa quem não pode ver tarefas', async () => {
    const { tx } = criarTx([], []);
    const service = new TarefasConcluidasRelatorioService(
      criarPolicy({ podeVer: false }),
    );

    await expect(
      service.gerar(tx, membership('sales_rep'), PERIODO),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ordena da última concluída para a mais antiga', async () => {
    const { tx } = criarTx(
      [
        conclusao('t-2', '2026-09-20T13:00:00.000Z'),
        conclusao('t-1', '2026-09-05T13:00:00.000Z'),
      ],
      [tarefa('t-1'), tarefa('t-2')],
    );
    const service = new TarefasConcluidasRelatorioService(criarPolicy());

    const { rows } = await service.gerar(tx, membership('owner'), PERIODO);

    expect(rows.map((r) => r.id)).toEqual(['t-2', 't-1']);
  });

  it('usa a conclusão mais recente quando a tarefa foi concluída duas vezes', async () => {
    const { tx } = criarTx(
      [
        conclusao('t-1', '2026-09-20T13:00:00.000Z'),
        conclusao('t-1', '2026-09-05T13:00:00.000Z'),
      ],
      [tarefa('t-1')],
    );
    const service = new TarefasConcluidasRelatorioService(criarPolicy());

    const { rows } = await service.gerar(tx, membership('owner'), PERIODO);

    expect(rows[0].concluidaEm).toBe('2026-09-20T13:00:00.000Z');
  });

  it('só traz tarefa que continua concluída hoje', async () => {
    const { tx, taskFindMany } = criarTx(
      [conclusao('t-1', '2026-09-20T13:00:00.000Z')],
      [],
    );
    const service = new TarefasConcluidasRelatorioService(criarPolicy());

    await service.gerar(tx, membership('owner'), PERIODO);

    expect(taskFindMany.mock.calls[0][0].where.status).toBe('done');
  });

  it('filtrar por responsável não amplia o escopo do papel', async () => {
    const { tx, taskFindMany } = criarTx(
      [conclusao('t-1', '2026-09-20T13:00:00.000Z')],
      [],
    );
    const service = new TarefasConcluidasRelatorioService(
      criarPolicy({ ownerUserId: REP }),
    );

    await service.gerar(tx, membership('sales_rep'), {
      ...PERIODO,
      usuarioId: OUTRO,
    });

    expect(taskFindMany.mock.calls[0][0].where.AND).toEqual(
      expect.arrayContaining([
        { assigneeUserId: REP },
        { assigneeUserId: OUTRO },
      ]),
    );
  });

  it('não vai ao banco de tarefas quando ninguém concluiu nada no período', async () => {
    const { tx, taskFindMany } = criarTx([], []);
    const service = new TarefasConcluidasRelatorioService(criarPolicy());

    const resultado = await service.gerar(tx, membership('owner'), PERIODO);

    expect(resultado).toEqual({ rows: [], total: 0, truncado: false });
    expect(taskFindMany).not.toHaveBeenCalled();
  });
});
