import type { TenantTx } from '../tenancy/tenant-context.service';
import { herdarSupervisor } from './equipe-de-vendas';

const WS = 'ws-1';
const COMPANY_ID = 'company-1';
const REP = 'user-rep';
const GERENTE = 'user-gerente';

function criarTx(supervisor: {
  id: string | null;
  userId?: string;
  role?: string;
  status?: string;
  workspaceId?: string;
}) {
  const upsert = jest.fn().mockResolvedValue({});
  const findUnique = jest.fn().mockImplementation(({ where }) => {
    if (where.workspaceId_userId) {
      return Promise.resolve({ managerId: supervisor.id });
    }
    return Promise.resolve(
      supervisor.id
        ? {
            userId: supervisor.userId ?? GERENTE,
            role: supervisor.role ?? 'manager',
            status: supervisor.status ?? 'active',
            workspaceId: supervisor.workspaceId ?? WS,
          }
        : null,
    );
  });
  const tx = {
    membership: { findUnique },
    companyAccess: { upsert },
  } as unknown as TenantTx;
  return { tx, upsert };
}

describe('herdarSupervisor', () => {
  it('põe o supervisor do representante na equipe da empresa nova', async () => {
    const { tx, upsert } = criarTx({ id: 'm-gerente' });

    await herdarSupervisor(tx, WS, REP, COMPANY_ID);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toEqual({
      workspaceId: WS,
      companyId: COMPANY_ID,
      userId: GERENTE,
    });
  });

  it('não faz nada quando o representante não tem supervisor', async () => {
    const { tx, upsert } = criarTx({ id: null });

    await herdarSupervisor(tx, WS, REP, COMPANY_ID);

    expect(upsert).not.toHaveBeenCalled();
  });

  it('ignora supervisor admin/dono — já têm acesso automático', async () => {
    const { tx, upsert } = criarTx({ id: 'm-admin', role: 'admin' });

    await herdarSupervisor(tx, WS, REP, COMPANY_ID);

    expect(upsert).not.toHaveBeenCalled();
  });

  it('ignora supervisor suspenso', async () => {
    const { tx, upsert } = criarTx({ id: 'm-gerente', status: 'suspended' });

    await herdarSupervisor(tx, WS, REP, COMPANY_ID);

    expect(upsert).not.toHaveBeenCalled();
  });
});
