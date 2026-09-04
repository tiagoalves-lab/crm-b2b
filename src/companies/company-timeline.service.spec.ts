import { ActivityService } from '../activities/activity.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CompanyService } from './company.service';

// Timeline da empresa só registra ação humana (decisão do usuário,
// 2026-09-04) — ver SemTimeline em company.service.ts. Estes testes
// travam a regra nos dois sentidos: sem a opção continua registrando
// (cadastro manual, edição pela ficha), com a opção não registra (carga
// em massa por planilha, preenchimento automático pelo Cartão CNPJ).

const WORKSPACE_ID = 'workspace-1';
const COMPANY_ID = 'company-1';

function membership(): MembershipContext {
  return {
    id: 'membership-1',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    role: 'owner',
    status: 'active',
  };
}

function fakeTx(): TenantTx {
  return {
    membership: {
      findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
    },
    company: {
      findFirst: jest.fn().mockResolvedValue({
        id: COMPANY_ID,
        workspaceId: WORKSPACE_ID,
        deletedAt: null,
        ownerUserId: 'user-1',
        tags: [],
      }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: COMPANY_ID, ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: COMPANY_ID, ...data }),
        ),
    },
    activity: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as TenantTx;
}

describe('CompanyService — Timeline só de ação humana (2026-09-04)', () => {
  let service: CompanyService;
  // O spy fica em variável (não `expect(activities.emit)`) porque a regra
  // @typescript-eslint/unbound-method reclama de método lido solto do
  // objeto.
  let emit: jest.SpyInstance;

  beforeEach(() => {
    const activities = new ActivityService(new PolicyService());
    emit = jest.spyOn(activities, 'emit');
    service = new CompanyService(new PolicyService(), activities);
  });

  it('cadastro manual registra "cadastro criado" na Timeline', async () => {
    await service.create(fakeTx(), membership(), { razaoSocial: 'ACME LTDA' });
    expect(emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: { action: 'created' } }),
    );
  });

  it('CRÍTICO: carga em massa (semTimeline) não registra criação', async () => {
    await service.create(
      fakeTx(),
      membership(),
      { razaoSocial: 'ACME LTDA' },
      { semTimeline: true },
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('edição pela ficha registra "cadastro atualizado" na Timeline', async () => {
    await service.update(fakeTx(), membership(), COMPANY_ID, {
      fantasia: 'ACME',
    });
    const chamada = emit.mock.calls[0] as unknown[];
    const input = chamada[1] as { payload: { action: string } };
    expect(input.payload.action).toBe('updated');
  });

  it('CRÍTICO: preenchimento automático (semTimeline) não registra atualização', async () => {
    await service.update(
      fakeTx(),
      membership(),
      COMPANY_ID,
      { fantasia: 'ACME' },
      { semTimeline: true },
    );
    expect(emit).not.toHaveBeenCalled();
  });
});
