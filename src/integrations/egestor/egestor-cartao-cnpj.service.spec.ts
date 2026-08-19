import type { CompanyService } from '../../companies/company.service';
import type { TenantContextService } from '../../tenancy/tenant-context.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import { EgestorCartaoCnpjService } from './egestor-cartao-cnpj.service';

const CTX = { userId: 'u-1', workspaceId: 'ws-1', role: 'owner' as const };
const MEMBERSHIP = {
  id: 'u-1',
  userId: 'u-1',
  workspaceId: 'ws-1',
  role: 'owner',
  status: 'active',
} as MembershipContext;

// Empresa como o eGestor a cria: cadastro do ERP preenchido, `customFields`
// vazio (nenhuma consulta à Receita ainda).
function companyDoEgestor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-1',
    cpfCnpj: '11111111000100',
    razaoSocial: 'EMPRESA DO ERP LTDA',
    fantasia: null,
    logradouro: 'RUA X',
    numero: '10',
    complemento: null,
    bairro: 'CENTRO',
    cep: '01000000',
    cidade: 'SÃO PAULO',
    uf: 'SP',
    emRecuperacaoJudicial: false,
    tipo: 'PJ',
    emails: [],
    fones: [],
    customFields: {},
    ...overrides,
  };
}

function lookupDaReceita(overrides: Record<string, unknown> = {}) {
  return {
    razaoSocial: 'EMPRESA DA RECEITA LTDA',
    emRecuperacaoJudicial: false,
    cpfCnpj: '11111111000100',
    tipo: 'PJ' as const,
    emails: [],
    fones: [],
    situacaoCadastral: 'ATIVA',
    cnaePrincipal: '46.49-4-99 - Comércio atacadista',
    porte: 'DEMAIS',
    naturezaJuridica: '206-2 - Sociedade Empresária Limitada',
    ...overrides,
  };
}

function criarService(overrides: {
  company?: Record<string, unknown> | null;
  lookup?: jest.Mock;
  update?: jest.Mock;
}) {
  const company =
    overrides.company === undefined ? companyDoEgestor() : overrides.company;

  const tx = {
    company: { findFirst: jest.fn().mockResolvedValue(company) },
  };
  const tenantContext = {
    run: jest.fn((_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as TenantContextService;

  const lookupCnpj =
    overrides.lookup ?? jest.fn().mockResolvedValue(lookupDaReceita());
  const update = overrides.update ?? jest.fn().mockResolvedValue(undefined);
  const companies = { lookupCnpj, update } as unknown as CompanyService;

  return {
    service: new EgestorCartaoCnpjService(tenantContext, companies),
    lookupCnpj,
    update,
  };
}

describe('EgestorCartaoCnpjService', () => {
  it('preenche a ficha da Receita na empresa que entrou pelo eGestor sem ela', async () => {
    const { service, lookupCnpj, update } = criarService({});

    const resultado = await service.preencherSeFaltando(
      CTX,
      MEMBERSHIP,
      'company-1',
    );

    expect(lookupCnpj).toHaveBeenCalledWith('11111111000100');
    expect(resultado.status).toBe('preenchido');

    const dto = (update.mock.calls[0] as unknown[])[3] as {
      customFields: { cnpj_lookup: Record<string, unknown> };
      razaoSocial?: string;
    };
    expect(dto.customFields.cnpj_lookup).toMatchObject({
      situacaoCadastral: 'ATIVA',
      porte: 'DEMAIS',
      fonteFederal: 'Receita Federal · BrasilAPI',
    });
    // Dado oficial da Receita corrige o que veio do ERP.
    expect(dto.razaoSocial).toBe('EMPRESA DA RECEITA LTDA');
  });

  it('não reconsulta a Receita quando a empresa já tem a ficha', async () => {
    const { service, lookupCnpj, update } = criarService({
      company: companyDoEgestor({
        customFields: { cnpj_lookup: { situacaoCadastral: 'ATIVA' } },
      }),
    });

    const resultado = await service.preencherSeFaltando(
      CTX,
      MEMBERSHIP,
      'company-1',
    );

    expect(resultado.status).toBe('ja_tinha');
    expect(lookupCnpj).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('ignora pessoa física — BrasilAPI cnpj/v1 só serve CNPJ', async () => {
    const { service, lookupCnpj } = criarService({
      company: companyDoEgestor({ cpfCnpj: '12345678901' }),
    });

    const resultado = await service.preencherSeFaltando(
      CTX,
      MEMBERSHIP,
      'company-1',
    );

    expect(resultado.status).toBe('sem_cnpj');
    expect(lookupCnpj).not.toHaveBeenCalled();
  });

  // O cadastro do eGestor já entrou; enriquecer é acessório. Erro vira
  // status (que o chamador loga no histórico), nunca exceção — senão o
  // webhook devolveria 500 e o eGestor reenviaria o evento.
  it('devolve status de erro em vez de propagar quando a Receita falha', async () => {
    const { service, update } = criarService({
      lookup: jest.fn().mockRejectedValue(new Error('BrasilAPI fora do ar')),
    });

    const resultado = await service.preencherSeFaltando(
      CTX,
      MEMBERSHIP,
      'company-1',
    );

    expect(resultado).toEqual({
      status: 'erro',
      motivo: 'BrasilAPI fora do ar',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('não faz nada quando a Company sumiu (soft-delete entre o evento e agora)', async () => {
    const { service, lookupCnpj } = criarService({ company: null });

    const resultado = await service.preencherSeFaltando(
      CTX,
      MEMBERSHIP,
      'company-1',
    );

    expect(resultado.status).toBe('sem_company');
    expect(lookupCnpj).not.toHaveBeenCalled();
  });

  // Regra de merge herdada do script de sanitização (2026-08-13): a Receita
  // completa, nunca apaga contato que a equipe/o ERP já tinham.
  it('preserva e-mail que o CRM tem e a Receita não conhece', async () => {
    const { service, update } = criarService({
      company: companyDoEgestor({ emails: ['comercial@exemplo.com.br'] }),
      lookup: jest
        .fn()
        .mockResolvedValue(
          lookupDaReceita({ emails: ['outro@exemplo.com.br'] }),
        ),
    });

    const resultado = await service.preencherSeFaltando(
      CTX,
      MEMBERSHIP,
      'company-1',
    );

    expect(resultado).toMatchObject({ emailsFonesConflito: true });
    const dto = (update.mock.calls[0] as unknown[])[3] as {
      emails?: string[];
    };
    expect(dto.emails).toBeUndefined();
  });
});
