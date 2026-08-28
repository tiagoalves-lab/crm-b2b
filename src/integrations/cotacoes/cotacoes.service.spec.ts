import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CotacoesService } from './cotacoes.service';

const TOKEN = 'token-de-teste-cotacoes';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';

function companyFake(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    workspaceId: WORKSPACE_ID,
    cpfCnpj: '00000000000191',
    razaoSocial: 'EMPRESA EXEMPLO LTDA',
    fantasia: 'EXEMPLO',
    logradouro: 'RUA UM',
    numero: '10',
    complemento: null,
    bairro: 'CENTRO',
    cidade: 'JOINVILLE',
    uf: 'SC',
    cep: '89200000',
    customFields: { indicador_ie: '1', inscricao_estadual: '123456789' },
    tags: [],
    deletedAt: null,
    updatedAt: new Date('2026-08-28T12:00:00Z'),
    ...overrides,
  };
}

interface Deps {
  config: { get: jest.Mock };
  prisma: { workspace: { findUniqueOrThrow: jest.Mock } };
  tenantContext: { run: jest.Mock };
  tx: {
    company: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $queryRaw: jest.Mock;
  };
}

function montar(overrides: { token?: string | undefined } = {}): {
  service: CotacoesService;
  deps: Deps;
} {
  const tx: Deps['tx'] = {
    company: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(companyFake()),
      update: jest.fn().mockResolvedValue(companyFake()),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: null }]),
  };

  const token = 'token' in overrides ? overrides.token : TOKEN;
  const deps: Deps = {
    config: {
      get: jest.fn((chave: string) =>
        chave === 'cotacoesApiToken' ? token : undefined,
      ),
    },
    prisma: {
      workspace: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: WORKSPACE_ID }),
      },
    },
    tenantContext: {
      run: jest.fn((_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    },
    tx,
  };

  const service = new CotacoesService(
    deps.config as never,
    deps.prisma as never,
    deps.tenantContext as never,
  );
  return { service, deps };
}

describe('CotacoesService', () => {
  describe('assertTokenValido', () => {
    it('recusa quando COTACOES_API_TOKEN não está configurado', () => {
      const { service } = montar({ token: undefined });
      expect(() => service.assertTokenValido(`Bearer ${TOKEN}`)).toThrow(
        new UnauthorizedException('COTACOES_API_TOKEN não configurado.'),
      );
    });

    it('recusa Authorization ausente ou sem Bearer', () => {
      const { service } = montar();
      expect(() => service.assertTokenValido(undefined)).toThrow(
        new UnauthorizedException('Authorization ausente ou mal formado.'),
      );
      expect(() => service.assertTokenValido(TOKEN)).toThrow(
        new UnauthorizedException('Authorization ausente ou mal formado.'),
      );
    });

    it('recusa token errado (inclusive de tamanho diferente)', () => {
      const { service } = montar();
      expect(() => service.assertTokenValido('Bearer errado')).toThrow(
        new UnauthorizedException('Token inválido.'),
      );
      expect(() => service.assertTokenValido(`Bearer ${TOKEN}x`)).toThrow(
        new UnauthorizedException('Token inválido.'),
      );
    });

    it('aceita o token correto', () => {
      const { service } = montar();
      expect(() => service.assertTokenValido(`Bearer ${TOKEN}`)).not.toThrow();
    });
  });

  describe('upsertCliente', () => {
    const dtoNovo = {
      cnpj: '00000000000191',
      razao_social: 'EMPRESA EXEMPLO LTDA',
      fantasia: '',
      cidade: 'JOINVILLE',
      uf: 'SC',
    };

    it('cria company sem tags (selo Lead) quando o CNPJ não existe', async () => {
      const { service, deps } = montar();
      const res = await service.upsertCliente(dtoNovo);

      expect(res.ja_existia).toBe(false);
      expect(deps.tx.company.create).toHaveBeenCalledTimes(1);
      const data = (deps.tx.company.create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.data.workspaceId).toBe(WORKSPACE_ID);
      expect(data.data.cpfCnpj).toBe('00000000000191');
      // fantasia vazia vira null; nenhuma tag é gravada (selo Lead é
      // derivado da AUSÊNCIA da tag "cliente" na tela Empresas).
      expect(data.data.fantasia).toBeNull();
      expect(data.data).not.toHaveProperty('tags');
    });

    it('devolve a existente sem sobrescrever quando o CNPJ já existe', async () => {
      const { service, deps } = montar();
      deps.tx.$queryRaw.mockResolvedValue([{ id: COMPANY_ID }]);
      deps.tx.company.findFirst.mockResolvedValue(companyFake());

      const res = await service.upsertCliente(dtoNovo);

      expect(res.ja_existia).toBe(true);
      expect(res.company.id).toBe(COMPANY_ID);
      expect(res.company.indicador_ie).toBe('1');
      expect(deps.tx.company.create).not.toHaveBeenCalled();
      expect(deps.tx.company.update).not.toHaveBeenCalled();
    });

    it('atualiza a company apontada quando vem crm_company_id', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());

      const res = await service.upsertCliente({
        ...dtoNovo,
        crm_company_id: COMPANY_ID,
      });

      expect(res.ja_existia).toBe(true);
      expect(deps.tx.company.update).toHaveBeenCalledTimes(1);
      expect(deps.tx.company.create).not.toHaveBeenCalled();
    });

    it('responde 404 quando o crm_company_id não existe no workspace', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(null);

      await expect(
        service.upsertCliente({
          ...dtoNovo,
          crm_company_id: COMPANY_ID,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listCompanies', () => {
    it('exclui lead-triagem, exige cpf_cnpj e mapeia os campos do espelho', async () => {
      const { service, deps } = montar();
      deps.tx.company.findMany.mockResolvedValue([companyFake()]);

      const res = await service.listCompanies({});

      const args = (
        deps.tx.company.findMany.mock.calls as unknown[][]
      )[0][0] as {
        where: Record<string, unknown>;
        take: number;
      };
      expect(args.where.deletedAt).toBeNull();
      expect(args.where.cpfCnpj).toEqual({ not: null });
      expect(args.where.NOT).toEqual({ tags: { has: 'lead-triagem' } });

      expect(res.proxima_pagina).toBeNull();
      expect(res.itens).toHaveLength(1);
      expect(res.itens[0]).toMatchObject({
        id: COMPANY_ID,
        cnpj: '00000000000191',
        cidade: 'JOINVILLE',
        indicador_ie: '1',
        inscricao_estadual: '123456789',
      });
      // Marca d'água recua no tempo (folga pra varredura paginada) — nunca
      // pode vir do futuro.
      expect(new Date(res.agora).getTime()).toBeLessThan(Date.now());
    });

    it('sinaliza proxima_pagina quando vem uma linha além do tamanho', async () => {
      const { service, deps } = montar();
      deps.tx.company.findMany.mockResolvedValue([
        companyFake(),
        companyFake({ id: '44444444-4444-4444-8444-444444444444' }),
      ]);

      const res = await service.listCompanies({ pagina: 1, tamanho: 1 });

      expect(res.itens).toHaveLength(1);
      expect(res.proxima_pagina).toBe(2);
    });

    it('repassa o filtro desde como updatedAt > desde', async () => {
      const { service, deps } = montar();
      await service.listCompanies({ desde: '2026-08-28T10:00:00.000Z' });

      const args = (
        deps.tx.company.findMany.mock.calls as unknown[][]
      )[0][0] as {
        where: { updatedAt?: { gt: Date } };
      };
      expect(args.where.updatedAt?.gt.toISOString()).toBe(
        '2026-08-28T10:00:00.000Z',
      );
    });
  });
});
