import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../tenancy/tenant-context.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { DeletionLogController } from './deletion-log.controller';
import { registrarExclusao, resumo } from './registrar-exclusao';

const WORKSPACE_ID = '00000000-0000-0000-0000-00000000000a';
const USER_ID = '00000000-0000-0000-0000-00000000000b';

function membro(role: MembershipContext['role']): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role,
    status: 'active',
  };
}

describe('registrarExclusao', () => {
  it('grava quem excluiu, o quê e a cópia do registro em JSON', async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { deletionLog: { create } } as unknown as TenantTx;

    await registrarExclusao(tx, membro('sales_rep'), {
      entidade: 'tarefa',
      registroId: 'task-1',
      titulo: '  Ligar para o cliente  ',
      contexto: 'Empresa X',
      snapshot: { dueAt: new Date('2026-09-20T00:00:00.000Z'), title: 'Ligar' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_ID,
        entidade: 'tarefa',
        registroId: 'task-1',
        titulo: 'Ligar para o cliente',
        contexto: 'Empresa X',
        // Date vira texto ISO — é o que a coluna jsonb guarda.
        snapshot: { dueAt: '2026-09-20T00:00:00.000Z', title: 'Ligar' },
      },
    });
  });

  it('título vazio vira "(sem título)" e título enorme é cortado', async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { deletionLog: { create } } as unknown as TenantTx;

    await registrarExclusao(tx, membro('admin'), {
      entidade: 'contato',
      registroId: 'c-1',
      titulo: '   ',
      snapshot: {},
    });
    await registrarExclusao(tx, membro('admin'), {
      entidade: 'contato',
      registroId: 'c-2',
      titulo: 'x'.repeat(500),
      snapshot: {},
    });

    expect(create.mock.calls[0][0].data.titulo).toBe('(sem título)');
    expect(create.mock.calls[1][0].data.titulo).toHaveLength(301);
  });

  it('resumo corta comentário longo numa linha só', () => {
    expect(resumo('linha 1\n\nlinha 2', 120)).toBe('linha 1 linha 2');
    expect(resumo('a'.repeat(200), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('DeletionLogController — só owner/admin leem', () => {
  function controller() {
    const run = jest.fn().mockResolvedValue([0, []]);
    const tenantContext = { run } as unknown as TenantContextService;
    return { ctrl: new DeletionLogController(tenantContext), run };
  }

  it.each(['sales_rep', 'manager'] as const)(
    '%s recebe 403 e o banco nem é consultado',
    async (role) => {
      const { ctrl, run } = controller();
      await expect(ctrl.listar(membro(role), {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin'] as const)('%s lê o registro', async (role) => {
    const { ctrl, run } = controller();
    const res = await ctrl.listar(membro(role), { pageSize: 10 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ total: 0, page: 1, pageSize: 10, items: [] });
  });
});
