import type { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CartaoCnpjService } from './cartao-cnpj.service';
import type { CompanyService } from './company.service';

const CTX = { userId: 'u-1', workspaceId: 'ws-1', role: 'sales_rep' as const };
const MEMBERSHIP = {
  id: 'u-1',
  userId: 'u-1',
  workspaceId: 'ws-1',
  role: 'sales_rep',
  status: 'active',
} as MembershipContext;

// Company-lead como a Prospecção cria: CNPJ e razão social, sem cartão.
function companyDoLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-1',
    cpfCnpj: '11111111000100',
    razaoSocial: 'EMPRESA DO LEAD LTDA',
    fantasia: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cep: null,
    cidade: 'CIDADE',
    uf: 'RS',
    emRecuperacaoJudicial: false,
    tipo: 'PJ',
    emails: [],
    fones: [],
    customFields: {},
    ...overrides,
  };
}

function criarService(
  company: Record<string, unknown> | null,
  lookup?: jest.Mock,
) {
  const tx = { company: { findFirst: jest.fn().mockResolvedValue(company) } };
  const tenantContext = {
    run: jest.fn((_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as TenantContextService;
  const lookupCnpj =
    lookup ??
    jest.fn().mockResolvedValue({
      razaoSocial: 'EMPRESA DA RECEITA LTDA',
      emRecuperacaoJudicial: false,
      cpfCnpj: '11111111000100',
      tipo: 'PJ',
      emails: [],
      fones: [],
      situacaoCadastral: 'ATIVA',
      porte: 'MICRO EMPRESA',
      cnaePrincipal: '2532201 - Produção de artefatos estampados de metal',
    });
  const update = jest.fn().mockResolvedValue(undefined);
  const companies = { lookupCnpj, update } as unknown as CompanyService;
  return {
    service: new CartaoCnpjService(tenantContext, companies),
    lookupCnpj,
    update,
  };
}

describe('CartaoCnpjService', () => {
  it('preenche o cartão da empresa que nasceu pela Prospecção', async () => {
    const { service, update } = criarService(companyDoLead());

    const status = await service.preencher(CTX, MEMBERSHIP, 'company-1', {
      forcar: false,
    });

    expect(status).toBe('preenchido');
    const [, membership, , dto, options] = update.mock.calls[0] as unknown[];
    expect(membership).toBe(MEMBERSHIP);
    expect(dto).toMatchObject({
      customFields: { cnpj_lookup: { situacaoCadastral: 'ATIVA' } },
    });
    expect(options).toEqual({ semTimeline: true });
  });

  it('sem forçar, não reconsulta quem já tem cartão', async () => {
    const { service, lookupCnpj } = criarService(
      companyDoLead({ customFields: { cnpj_lookup: { porte: 'DEMAIS' } } }),
    );

    await expect(
      service.preencher(CTX, MEMBERSHIP, 'company-1', { forcar: false }),
    ).resolves.toBe('ja_tinha');
    expect(lookupCnpj).not.toHaveBeenCalled();
  });

  it('forçando (botão da ficha do lead), reconsulta mesmo com cartão', async () => {
    const { service, lookupCnpj } = criarService(
      companyDoLead({ customFields: { cnpj_lookup: { porte: 'DEMAIS' } } }),
    );

    await expect(
      service.preencher(CTX, MEMBERSHIP, 'company-1', { forcar: true }),
    ).resolves.toBe('preenchido');
    expect(lookupCnpj).toHaveBeenCalledWith('11111111000100');
  });

  it('Receita fora do ar não estoura pra quem chamou', async () => {
    const { service, update } = criarService(
      companyDoLead(),
      jest.fn().mockRejectedValue(new Error('timeout')),
    );

    await expect(
      service.preencher(CTX, MEMBERSHIP, 'company-1', { forcar: true }),
    ).resolves.toBe('erro');
    expect(update).not.toHaveBeenCalled();
  });

  it('empresa sem CNPJ completo não consulta', async () => {
    const { service, lookupCnpj } = criarService(
      companyDoLead({ cpfCnpj: null }),
    );

    await expect(
      service.preencher(CTX, MEMBERSHIP, 'company-1', { forcar: true }),
    ).resolves.toBe('sem_cnpj');
    expect(lookupCnpj).not.toHaveBeenCalled();
  });
});
