import { createHash } from 'crypto';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CotacoesService,
  nomeArquivoProposta,
  nomeArquivoStorage,
} from './cotacoes.service';

const TOKEN = 'token-de-teste-cotacoes';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const OPPORTUNITY_ID = '55555555-5555-4555-8555-555555555555';
const OWNER_USER_ID = '66666666-6666-4666-8666-666666666666';
const MEMBERSHIP_ID = '77777777-7777-4777-8777-777777777777';
const PIPELINE_ID = '88888888-8888-4888-8888-888888888888';
const STAGE_ID = '99999999-9999-4999-8999-999999999999';
const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARD_ID = 'abc0123456789abcdef01234';

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

function membershipFake(overrides: Record<string, unknown> = {}) {
  return {
    id: MEMBERSHIP_ID,
    workspaceId: WORKSPACE_ID,
    userId: OWNER_USER_ID,
    role: 'owner',
    status: 'active',
    permissions: null,
    ...overrides,
  };
}

function lookupFake() {
  return {
    razaoSocial: 'EMPRESA EXEMPLO LTDA',
    cpfCnpj: '00000000000191',
    tipo: 'PJ' as const,
    fantasia: undefined,
    logradouro: 'RUA UM',
    numero: '10',
    complemento: null,
    bairro: 'CENTRO',
    cep: '89200000',
    cidade: 'JOINVILLE',
    uf: 'SC',
    emails: [],
    fones: [],
    situacaoCadastral: 'ATIVA',
    dataAbertura: '2011-10-21',
    porte: 'MICRO EMPRESA',
    naturezaJuridica: 'Sociedade Empresária Limitada',
    cnaePrincipal: '2539001 - Serviços de usinagem',
    cnaeSecundarios: [],
    estabelecimento: 'MATRIZ',
    emRecuperacaoJudicial: false,
  };
}

interface Deps {
  config: { get: jest.Mock };
  prisma: { workspace: { findUniqueOrThrow: jest.Mock } };
  tenantContext: { run: jest.Mock };
  opportunities: { create: jest.Mock; update: jest.Mock };
  supabaseUsers: { getIdentities: jest.Mock };
  tx: {
    company: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    opportunity: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    opportunityItem: { findMany: jest.Mock };
    opportunityComment: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
    };
    opportunityCommentEdit: { create: jest.Mock };
    opportunityAttachment: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    pipeline: { findFirst: jest.Mock };
    stage: { findFirst: jest.Mock };
    membership: { findFirst: jest.Mock; findMany: jest.Mock };
    rawLead: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
    activity: { create: jest.Mock };
    $queryRaw: jest.Mock;
  };
  pdf: { renderPdf: jest.Mock };
  storage: { upload: jest.Mock; remove: jest.Mock };
  companies: { lookupCnpj: jest.Mock; update: jest.Mock };
  opportunityItems: { update: jest.Mock };
}

function montar(
  overrides: { token?: string | undefined; ownerConfigurado?: string } = {},
): {
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
    opportunity: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: OPPORTUNITY_ID }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ amount: null }),
    },
    opportunityItem: { findMany: jest.fn().mockResolvedValue([]) },
    opportunityComment: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown[] }) =>
          Promise.resolve({ count: data.length }),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    opportunityCommentEdit: { create: jest.fn().mockResolvedValue({}) },
    opportunityAttachment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: ATTACHMENT_ID }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pipeline: {
      findFirst: jest.fn().mockResolvedValue({ id: PIPELINE_ID }),
    },
    stage: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: STAGE_ID, name: 'Solicitação de Propostas' }),
    },
    membership: {
      findFirst: jest.fn().mockResolvedValue(membershipFake()),
      findMany: jest.fn().mockResolvedValue([]),
    },
    rawLead: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    activity: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: null }]),
  };

  const token = 'token' in overrides ? overrides.token : TOKEN;
  const deps: Deps = {
    config: {
      get: jest.fn((chave: string) => {
        if (chave === 'cotacoesApiToken') return token;
        if (chave === 'cotacoesDefaultOwnerUserId') {
          return overrides.ownerConfigurado;
        }
        return undefined;
      }),
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
    opportunities: {
      create: jest.fn().mockResolvedValue({ id: OPPORTUNITY_ID }),
      update: jest.fn().mockResolvedValue({ id: OPPORTUNITY_ID }),
    },
    supabaseUsers: {
      getIdentities: jest.fn().mockResolvedValue(new Map()),
    },
    // O Chromium de verdade nunca sobe em teste unitario: o que importa aqui
    // e o que a rota faz ANTES e DEPOIS do render (conferir hash, nao
    // duplicar anexo, gravar com o usuario-sistema).
    pdf: {
      renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
    },
    storage: {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    opportunityItems: { update: jest.fn().mockResolvedValue({}) },
    companies: {
      lookupCnpj: jest.fn().mockResolvedValue(lookupFake()),
      update: jest.fn().mockResolvedValue(companyFake()),
    },
    tx,
  };

  const service = new CotacoesService(
    deps.config as never,
    deps.prisma as never,
    deps.tenantContext as never,
    deps.opportunities as never,
    deps.supabaseUsers as never,
    deps.pdf as never,
    deps.storage as never,
    deps.companies as never,
    deps.opportunityItems as never,
  );
  return { service, deps };
}

// Membros ativos como o Supabase Auth devolve (nome vive em auth.users).
const LAURO_USER_ID = '13131313-1313-4313-8313-131313131313';
const DARLA_USER_ID = '14141414-1414-4414-8414-141414141414';

function identidadesDaGama() {
  return new Map([
    [LAURO_USER_ID, { login: 'lauro', name: 'Lauro', email: null }],
    [DARLA_USER_ID, { login: 'darla', name: 'Darlã', email: null }],
  ]);
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

    it('grava indicador_ie/inscricao_estadual em custom_fields ao criar', async () => {
      const { service, deps } = montar();
      await service.upsertCliente({
        ...dtoNovo,
        indicador_ie: '2',
        inscricao_estadual: ' 554131437111 ',
      });

      const data = (deps.tx.company.create.mock.calls as unknown[][])[0][0] as {
        data: { customFields: Record<string, unknown> };
      };
      // Trim aplicado; chaves iguais às do eGestor.
      expect(data.data.customFields).toEqual({
        indicador_ie: '2',
        inscricao_estadual: '554131437111',
      });
    });

    it('mescla campos fiscais na edição sem perder as demais chaves; vazio remove', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(
        companyFake({
          customFields: {
            indicador_ie: '1',
            inscricao_estadual: '123456789',
            cnpj_lookup: { situacao: 'ATIVA' },
          },
        }),
      );

      await service.upsertCliente({
        ...dtoNovo,
        crm_company_id: COMPANY_ID,
        indicador_ie: '9',
        inscricao_estadual: '',
      });

      const data = (deps.tx.company.update.mock.calls as unknown[][])[0][0] as {
        data: { customFields: Record<string, unknown> };
      };
      expect(data.data.customFields).toEqual({
        indicador_ie: '9',
        cnpj_lookup: { situacao: 'ATIVA' },
      });
    });

    it('não mexe em custom_fields quando os campos fiscais não vêm no payload', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());

      await service.upsertCliente({ ...dtoNovo, crm_company_id: COMPANY_ID });

      const data = (deps.tx.company.update.mock.calls as unknown[][])[0][0] as {
        data: { customFields: Record<string, unknown> };
      };
      expect(data.data.customFields).toEqual({
        indicador_ie: '1',
        inscricao_estadual: '123456789',
      });
    });
  });

  // Cliente cotado no app deixa de ser prospect e ganha a ficha da
  // Receita (2026-10-02).
  describe('upsertCliente — qualificação e Cartão CNPJ', () => {
    const dto = {
      cnpj: '00000000000191',
      razao_social: 'EMPRESA EXEMPLO LTDA',
      crm_company_id: COMPANY_ID,
    };

    it('aprova o lead em triagem e tira a tag lead-triagem', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(
        companyFake({ tags: ['lead-triagem'] }),
      );
      deps.tx.rawLead.findFirst.mockResolvedValue({
        id: 'lead-1',
        status: 'novo',
        convertedAt: null,
      });

      await service.upsertCliente(dto);

      expect(deps.tx.rawLead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: expect.objectContaining({
          status: 'aprovado',
          etapa: 'negociacao',
        }) as unknown,
      });
      const tagsUpdate = (deps.tx.company.update.mock.calls as unknown[][])
        .map((c) => c[0] as { data: { tags?: string[] } })
        .find((a) => a.data.tags !== undefined);
      expect(tagsUpdate?.data.tags).toEqual([]);
      // Conversão registrada na Timeline (2026-10-28), sem pessoa por trás.
      expect(deps.tx.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: null,
          companyId: COMPANY_ID,
          payload: expect.objectContaining({
            action: 'lead_approved',
            origem: 'cotacoes',
          }) as unknown,
        }) as unknown,
      });
    });

    it('não mexe em lead já aprovado', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.tx.rawLead.findFirst.mockResolvedValue({
        id: 'lead-1',
        status: 'aprovado',
        convertedAt: new Date(),
      });

      await service.upsertCliente(dto);

      expect(deps.tx.rawLead.update).not.toHaveBeenCalled();
      expect(deps.tx.rawLead.create).not.toHaveBeenCalled();
      expect(deps.tx.activity.create).not.toHaveBeenCalled();
    });

    it('cria o lead convertido quando a empresa não tem lead nenhum', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.tx.$queryRaw.mockResolvedValue([{ precisa: true }]);

      await service.upsertCliente(dto);

      expect(deps.tx.rawLead.create).toHaveBeenCalledTimes(1);
      const data = (deps.tx.rawLead.create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.data).toMatchObject({
        status: 'aprovado',
        etapa: 'negociacao',
        promotedCompanyId: COMPANY_ID,
        ownerUserId: OWNER_USER_ID,
      });
    });

    it('preenche a ficha da Receita quando ela falta', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());

      const res = await service.upsertCliente(dto);

      expect(res.receita).toBe('preenchido');
      expect(deps.companies.lookupCnpj).toHaveBeenCalledWith('00000000000191');
      const args = (deps.companies.update.mock.calls as unknown[][])[0];
      const dtoUpdate = args[3] as { customFields: Record<string, unknown> };
      // IE do formulário continua; snapshot da Receita entra junto.
      expect(dtoUpdate.customFields).toMatchObject({
        indicador_ie: '1',
        cnpj_lookup: expect.objectContaining({
          situacaoCadastral: 'ATIVA',
        }) as unknown,
      });
      expect(args[4]).toEqual({ semTimeline: true });
    });

    it('não reconsulta quando já tem ficha e o usuário não consultou', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(
        companyFake({ customFields: { cnpj_lookup: { porte: 'ME' } } }),
      );

      const res = await service.upsertCliente(dto);

      expect(res.receita).toBe('ja_tinha');
      expect(deps.companies.lookupCnpj).not.toHaveBeenCalled();
    });

    it('reconsulta quando o usuário consultou a Receita no formulário', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(
        companyFake({ customFields: { cnpj_lookup: { porte: 'ME' } } }),
      );

      const res = await service.upsertCliente({
        ...dto,
        receita_consultada: true,
      });

      expect(res.receita).toBe('preenchido');
      expect(deps.companies.lookupCnpj).toHaveBeenCalledTimes(1);
    });

    it('Receita fora do ar não derruba o salvar', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.companies.lookupCnpj.mockRejectedValue(new Error('timeout'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await service.upsertCliente(dto);

      expect(res.receita).toBe('erro');
      expect(res.company.id).toBe(COMPANY_ID);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Trello → funil (2026-09-04)
  // ─────────────────────────────────────────────────────────────

  describe('trelloStatus', () => {
    it('normaliza os ids, consulta em lote e mapeia o que a tela usa', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findMany.mockResolvedValue([
        {
          id: OPPORTUNITY_ID,
          trelloCardId: CARD_ID,
          status: 'open',
          trelloSyncEm: new Date('2026-09-04T12:00:00Z'),
          stage: { name: 'Solicitação de Propostas' },
          company: { razaoSocial: 'EMPRESA EXEMPLO LTDA', fantasia: 'EXEMPLO' },
          _count: { comments: 3, items: 2 },
          items: [
            { id: 'item-1', name: 'GM3015S 6KW' },
            { id: 'item-2', name: 'Dobradeira 135T' },
          ],
        },
      ]);

      // Maiúscula e id repetido no mesmo pedido: normalizados antes da consulta.
      const res = await service.trelloStatus({
        card_ids: `${CARD_ID.toUpperCase()},${CARD_ID}`,
      });

      const args = (
        deps.tx.opportunity.findMany.mock.calls as unknown[][]
      )[0][0] as { where: { trelloCardId: { in: string[] } } };
      expect(args.where.trelloCardId.in).toEqual([CARD_ID]);

      expect(res.itens).toEqual([
        {
          card_id: CARD_ID,
          opportunity_id: OPPORTUNITY_ID,
          empresa: 'EMPRESA EXEMPLO LTDA',
          estagio: 'Solicitação de Propostas',
          status: 'open',
          itens: 2,
          itens_lista: [
            { id: 'item-1', nome: 'GM3015S 6KW' },
            { id: 'item-2', nome: 'Dobradeira 135T' },
          ],
          comentarios: 3,
          sincronizado_em: '2026-09-04T12:00:00.000Z',
        },
      ]);
    });

    it('não consulta o banco quando a lista fica vazia', async () => {
      const { service, deps } = montar();
      const res = await service.trelloStatus({ card_ids: '' });
      expect(res.itens).toEqual([]);
      expect(deps.tenantContext.run).not.toHaveBeenCalled();
    });
  });

  describe('trelloVincular', () => {
    const dtoBase = { card_id: CARD_ID, crm_company_id: COMPANY_ID };

    it('cria a oportunidade no estágio de entrada, com itens e vínculo do cartão', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());

      const res = await service.trelloVincular({
        ...dtoBase,
        card_url: 'https://trello.com/c/WpCeNWI4',
        itens: ['Máquina de corte a laser GM6025D', 'Compressor'],
      });

      expect(res).toMatchObject({
        opportunity_id: OPPORTUNITY_ID,
        ja_existia: false,
        estagio: 'Solicitação de Propostas',
      });

      // Criada pelo serviço de oportunidades (regra de negócio num lugar só).
      const criacao = (deps.opportunities.create.mock.calls as unknown[][])[0];
      expect(criacao[1]).toMatchObject({
        userId: OWNER_USER_ID,
        role: 'owner',
      });
      expect(criacao[2]).toMatchObject({
        companyId: COMPANY_ID,
        pipelineId: PIPELINE_ID,
        stageId: STAGE_ID,
        amount: 0,
        currency: 'BRL',
        items: ['Máquina de corte a laser GM6025D', 'Compressor'],
      });

      const vinculo = (
        deps.tx.opportunity.update.mock.calls as unknown[][]
      )[0][0] as { data: Record<string, unknown> };
      expect(vinculo.data).toEqual({
        trelloCardId: CARD_ID,
        trelloCardUrl: 'https://trello.com/c/WpCeNWI4',
      });
    });

    it('leva a descrição do cartão pro campo Descrição da oportunidade', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());

      await service.trelloVincular({
        ...dtoBase,
        descricao: 'Orçar:\nMáquina GM6025D - 6KW\n\nIndicação do Gilberto',
      });

      const criacao = (deps.opportunities.create.mock.calls as unknown[][])[0];
      expect(criacao[2]).toMatchObject({
        description: 'Orçar:\nMáquina GM6025D - 6KW\n\nIndicação do Gilberto',
      });
    });

    it('preenche a descrição da oportunidade que já existe só se ela estiver vazia', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({
        id: OPPORTUNITY_ID,
        description: null,
        stage: { name: 'Elaboração de Propostas' },
      });

      await service.trelloVincular({ ...dtoBase, descricao: 'do cartão' });

      const update = (
        deps.tx.opportunity.update.mock.calls as unknown[][]
      )[0][0] as { data: Record<string, unknown> };
      expect(update.data).toEqual({ description: 'do cartão' });
    });

    it('não sobrescreve descrição já escrita no CRM', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({
        id: OPPORTUNITY_ID,
        description: 'texto revisado pelo vendedor',
        stage: { name: 'Elaboração de Propostas' },
      });

      await service.trelloVincular({ ...dtoBase, descricao: 'do cartão' });

      const updates = (deps.tx.opportunity.update.mock.calls as unknown[][])
        .map((call) => call[0] as { data: Record<string, unknown> })
        .filter((arg) => 'description' in arg.data);
      expect(updates).toHaveLength(0);
    });

    it('devolve a existente sem criar de novo quando o cartão já tem card', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({
        id: OPPORTUNITY_ID,
        stage: { name: 'Elaboração de Propostas' },
      });

      const res = await service.trelloVincular(dtoBase);

      expect(res).toMatchObject({
        opportunity_id: OPPORTUNITY_ID,
        ja_existia: true,
        estagio: 'Elaboração de Propostas',
      });
      expect(deps.opportunities.create).not.toHaveBeenCalled();
    });

    it('vira 409 quando outra requisição cadastrou o mesmo cartão no meio', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.tx.opportunity.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'teste',
        }),
      );

      await expect(service.trelloVincular(dtoBase)).rejects.toThrow(
        ConflictException,
      );
    });

    it('recusa quando não vem empresa nenhuma', async () => {
      const { service } = montar();
      await expect(
        service.trelloVincular({ card_id: CARD_ID }),
      ).rejects.toThrow(
        'Informe a empresa da oportunidade (crm_company_id ou cnpj).',
      );
    });

    it('resolve a empresa por CNPJ quando não vem o id', async () => {
      const { service, deps } = montar();
      deps.tx.$queryRaw.mockResolvedValue([{ id: COMPANY_ID }]);
      deps.tx.company.findFirst.mockResolvedValue(companyFake());

      const res = await service.trelloVincular({
        card_id: CARD_ID,
        cnpj: '00000000000191',
      });

      expect(res.ja_existia).toBe(false);
      expect(
        (deps.opportunities.create.mock.calls as unknown[][])[0][2],
      ).toMatchObject({ companyId: COMPANY_ID });
    });

    it('404 quando o CNPJ não existe no CRM', async () => {
      const { service, deps } = montar();
      deps.tx.$queryRaw.mockResolvedValue([{ id: null }]);

      await expect(
        service.trelloVincular({ card_id: CARD_ID, cnpj: '00000000000191' }),
      ).rejects.toThrow(NotFoundException);
    });

    // O quadro do Trello é do representante ("LAURO BRANDÃO - SC"), então
    // é ele que diz de quem é a cotação.
    it('atribui a oportunidade ao representante do quadro do Trello', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.tx.membership.findMany.mockResolvedValue([
        { userId: LAURO_USER_ID },
        { userId: DARLA_USER_ID },
      ]);
      deps.supabaseUsers.getIdentities.mockResolvedValue(identidadesDaGama());
      deps.tx.membership.findFirst.mockResolvedValue(
        membershipFake({ userId: LAURO_USER_ID, role: 'sales_rep' }),
      );

      await service.trelloVincular({
        ...dtoBase,
        representante: 'LAURO BRANDÃO - SC',
      });

      const busca = (
        deps.tx.membership.findFirst.mock.calls as unknown[][]
      )[0][0] as { where: Record<string, unknown> };
      expect(busca.where).toMatchObject({
        userId: LAURO_USER_ID,
        status: 'active',
      });
      expect(
        (deps.opportunities.create.mock.calls as unknown[][])[0][1],
      ).toMatchObject({ userId: LAURO_USER_ID });
    });

    it('cai no dono padrão quando o quadro não é de nenhum membro', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.tx.membership.findMany.mockResolvedValue([
        { userId: LAURO_USER_ID },
        { userId: DARLA_USER_ID },
      ]);
      deps.supabaseUsers.getIdentities.mockResolvedValue(identidadesDaGama());

      await service.trelloVincular({
        ...dtoBase,
        representante: 'GILMAR OLIVEIRA - RS',
      });

      // Nenhuma busca por userId específico: foi direto pro dono padrão.
      const busca = (
        deps.tx.membership.findFirst.mock.calls as unknown[][]
      )[0][0] as { where: Record<string, unknown> };
      expect(busca.where).toMatchObject({ status: 'active', role: 'owner' });
      expect(
        (deps.opportunities.create.mock.calls as unknown[][])[0][1],
      ).toMatchObject({ userId: OWNER_USER_ID });
    });

    it('não chuta representante quando dois membros casam com o quadro', async () => {
      const { service, deps } = montar();
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.tx.membership.findMany.mockResolvedValue([
        { userId: LAURO_USER_ID },
        { userId: DARLA_USER_ID },
      ]);
      // Dois membros com o mesmo primeiro nome: o quadro não decide.
      deps.supabaseUsers.getIdentities.mockResolvedValue(
        new Map([
          [LAURO_USER_ID, { login: 'lauro', name: 'Lauro', email: null }],
          [DARLA_USER_ID, { login: 'lauro.s', name: 'Lauro', email: null }],
        ]),
      );

      await service.trelloVincular({
        ...dtoBase,
        representante: 'LAURO BRANDÃO - SC',
      });

      const busca = (
        deps.tx.membership.findFirst.mock.calls as unknown[][]
      )[0][0] as { where: Record<string, unknown> };
      expect(busca.where).toMatchObject({ status: 'active', role: 'owner' });
    });

    it('usa o dono configurado quando ele é membro ativo', async () => {
      const outroUsuario = '12121212-1212-4212-8212-121212121212';
      const { service, deps } = montar({ ownerConfigurado: outroUsuario });
      deps.tx.company.findFirst.mockResolvedValue(companyFake());
      deps.tx.membership.findFirst.mockResolvedValue(
        membershipFake({ userId: outroUsuario, role: 'admin' }),
      );

      await service.trelloVincular(dtoBase);

      const busca = (
        deps.tx.membership.findFirst.mock.calls as unknown[][]
      )[0][0] as { where: Record<string, unknown> };
      expect(busca.where).toMatchObject({
        userId: outroUsuario,
        status: 'active',
      });
      expect(
        (deps.opportunities.create.mock.calls as unknown[][])[0][1],
      ).toMatchObject({ userId: outroUsuario });
    });
  });

  describe('trelloSincronizarComentarios', () => {
    const comentario = (ref: string, texto: string, em?: string) => ({
      ref,
      autor: 'Lauro Brandão',
      texto,
      em,
    });

    it('404 quando o cartão ainda não virou oportunidade', async () => {
      const { service } = montar();
      await expect(
        service.trelloSincronizarComentarios({
          card_id: CARD_ID,
          comentarios: [comentario('a'.repeat(24), 'oi')],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('grava só o que ainda não foi espelhado, com autor externo e data do Trello', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });
      const jaEspelhado = 'b'.repeat(24);
      const novo = 'c'.repeat(24);
      deps.tx.opportunityComment.findMany.mockResolvedValue([
        {
          id: 'comentario-1',
          externalRef: jaEspelhado,
          body: 'mensagem antiga',
        },
      ]);

      const res = await service.trelloSincronizarComentarios({
        card_id: CARD_ID,
        comentarios: [
          comentario(jaEspelhado, 'mensagem antiga', '2026-09-03T20:10:00Z'),
          comentario(novo, 'mensagem nova', '2026-09-04T13:00:00Z'),
        ],
      });

      expect(res).toEqual({
        opportunity_id: OPPORTUNITY_ID,
        novos: 1,
        editados: 0,
        recebidos: 2,
      });
      // Texto igual ao do Trello: nada de edição registrada.
      expect(deps.tx.opportunityCommentEdit.create).not.toHaveBeenCalled();
      expect(deps.tx.opportunityComment.update).not.toHaveBeenCalled();

      const gravacao = (
        deps.tx.opportunityComment.createMany.mock.calls as unknown[][]
      )[0][0] as {
        data: Array<{
          externalRef: string;
          externalAuthor: string | null;
          authorUserId: string;
          body: string;
          createdAt: Date;
        }>;
        skipDuplicates: boolean;
      };
      expect(gravacao.skipDuplicates).toBe(true);
      expect(gravacao.data).toHaveLength(1);
      expect(gravacao.data[0].externalRef).toBe(novo);
      // Nome de quem escreveu no Trello em coluna própria, texto limpo —
      // e o autor do CRM continua sendo o sentinela de sistema, porque
      // quem comentou lá não é usuário daqui.
      expect(gravacao.data[0].externalAuthor).toBe('Lauro Brandão');
      expect(gravacao.data[0].body).toBe('mensagem nova');
      expect(gravacao.data[0].authorUserId).toBe(
        '00000000-0000-4000-8000-000000000000',
      );
      expect(gravacao.data[0].createdAt.toISOString()).toBe(
        '2026-09-04T13:00:00.000Z',
      );
    });

    it('mensagem corrigida no Trello atualiza o texto e guarda a versão anterior', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });
      const ref = 'b'.repeat(24);
      deps.tx.opportunityComment.findMany.mockResolvedValue([
        { id: 'comentario-1', externalRef: ref, body: 'comprimento 6400' },
      ]);

      const res = await service.trelloSincronizarComentarios({
        card_id: CARD_ID,
        comentarios: [
          comentario(ref, 'comprimento 6000', '2026-10-15T14:59:00Z'),
        ],
      });

      expect(res.novos).toBe(0);
      expect(res.editados).toBe(1);
      expect(deps.tx.opportunityComment.createMany).not.toHaveBeenCalled();
      expect(
        (deps.tx.opportunityCommentEdit.create.mock.calls as unknown[][])[0][0],
      ).toMatchObject({
        data: {
          commentId: 'comentario-1',
          opportunityId: OPPORTUNITY_ID,
          bodyBefore: 'comprimento 6400',
          bodyAfter: 'comprimento 6000',
          editedByUserId: '00000000-0000-4000-8000-000000000000',
        },
      });
      expect(
        (deps.tx.opportunityComment.update.mock.calls as unknown[][])[0][0],
      ).toMatchObject({
        where: { id: 'comentario-1' },
        data: { body: 'comprimento 6000' },
      });
    });

    it('descarta mensagem vazia, repetida no lote, e ordena por data', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });
      const antigo = 'd'.repeat(24);
      const recente = 'e'.repeat(24);

      await service.trelloSincronizarComentarios({
        card_id: CARD_ID,
        comentarios: [
          comentario(recente, 'segunda', '2026-09-04T13:00:00Z'),
          comentario(antigo, 'primeira', '2026-09-03T13:00:00Z'),
          comentario(recente, 'repetida no lote', '2026-09-04T13:00:00Z'),
          comentario('f'.repeat(24), '   ', '2026-09-04T14:00:00Z'),
        ],
      });

      const gravacao = (
        deps.tx.opportunityComment.createMany.mock.calls as unknown[][]
      )[0][0] as { data: Array<{ externalRef: string; body: string }> };
      expect(gravacao.data.map((c) => c.externalRef)).toEqual([
        antigo,
        recente,
      ]);
      expect(gravacao.data[1].body).toContain('segunda');
    });

    it('sincronizar preenche a descrição vazia e nunca a que já tem texto', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({
        id: OPPORTUNITY_ID,
        description: null,
      });

      await service.trelloSincronizarComentarios({
        card_id: CARD_ID,
        comentarios: [],
        descricao: 'do cartão',
      });
      expect(
        (deps.tx.opportunity.update.mock.calls as unknown[][])[0][0],
      ).toMatchObject({ data: { description: 'do cartão' } });

      const outro = montar();
      outro.deps.tx.opportunity.findFirst.mockResolvedValue({
        id: OPPORTUNITY_ID,
        description: 'escrita no CRM',
      });
      await outro.service.trelloSincronizarComentarios({
        card_id: CARD_ID,
        comentarios: [],
        descricao: 'do cartão',
      });
      const tocou = (
        outro.deps.tx.opportunity.update.mock.calls as unknown[][]
      ).some((call) => 'description' in (call[0] as { data: object }).data);
      expect(tocou).toBe(false);
    });

    it('não grava nada quando o cartão não tem comentário', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });

      const res = await service.trelloSincronizarComentarios({
        card_id: CARD_ID,
        comentarios: [],
      });

      expect(res.novos).toBe(0);
      expect(deps.tx.opportunityComment.createMany).not.toHaveBeenCalled();
      // Mesmo sem mensagem nova, o carimbo de "sincronizado agora" é gravado.
      expect(deps.tx.opportunity.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('listCompanies', () => {
    it('inclui cliente e lead aprovado, exige cpf_cnpj e mapeia os campos do espelho', async () => {
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
      // Elegibilidade: fora só quem ficou parado na triagem. Cliente com
      // as duas tags e lead aprovado entram — foi o que fez a empresa
      // recém-convertida sumir da busca do orçamento (2026-09-23).
      expect(args.where.OR).toEqual([
        { NOT: { tags: { has: 'lead-triagem' } } },
        { tags: { has: 'cliente' } },
        {
          originLeads: {
            some: {
              OR: [{ status: 'aprovado' }, { convertedAt: { not: null } }],
            },
          },
        },
      ]);

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

  describe('buscarCompanies', () => {
    it('busca por nome e por CNPJ mantendo o filtro de elegibilidade', async () => {
      const { service, deps } = montar();
      deps.tx.company.findMany.mockResolvedValue([companyFake()]);

      const res = await service.buscarCompanies({ q: '13.704.423' });

      const args = (
        deps.tx.company.findMany.mock.calls as unknown[][]
      )[0][0] as {
        where: { AND: [unknown, { OR: unknown[] }] };
        take: number;
      };
      // Elegibilidade e texto ficam em AND separados: um `OR` solto no
      // mesmo objeto sobrescreveria o outro em silêncio.
      expect(args.where.AND[0]).toHaveProperty('OR');
      expect(args.where.AND[1].OR).toEqual([
        { razaoSocial: { contains: '13.704.423', mode: 'insensitive' } },
        { fantasia: { contains: '13.704.423', mode: 'insensitive' } },
        // O banco guarda só dígitos — o CNPJ digitado com pontuação casa.
        { cpfCnpj: { contains: '13704423' } },
      ]);
      expect(args.take).toBe(20);
      expect(res.itens).toHaveLength(1);
    });

    it('ignora termo curto sem ir ao banco', async () => {
      const { service, deps } = montar();

      const res = await service.buscarCompanies({ q: 'ga' });

      expect(res.itens).toEqual([]);
      expect(deps.tx.company.findMany).not.toHaveBeenCalled();
    });

    it('não procura por CNPJ quando o termo tem poucos dígitos', async () => {
      const { service, deps } = montar();
      deps.tx.company.findMany.mockResolvedValue([]);

      await service.buscarCompanies({ q: 'gar1' });

      const args = (
        deps.tx.company.findMany.mock.calls as unknown[][]
      )[0][0] as { where: { AND: [unknown, { OR: unknown[] }] } };
      expect(args.where.AND[1].OR).toHaveLength(2);
    });

    it('CNPJ completo fora dos clientes devolve a empresa da Prospecção à parte', async () => {
      const { service, deps } = montar();
      deps.tx.company.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          companyFake({
            tags: ['lead-triagem'],
            originLeads: [{ etapa: 'entrada', status: 'novo' }],
          }),
        ]);

      const res = await service.buscarCompanies({ q: '00.000.000/0001-91' });

      expect(res.itens).toEqual([]);
      expect(res.prospeccao).toHaveLength(1);
      expect(res.prospeccao[0]).toMatchObject({
        id: COMPANY_ID,
        cnpj: '00000000000191',
        etapa: 'Prospectar/Entrada',
        descartado: false,
      });
      const args = (
        deps.tx.company.findMany.mock.calls as unknown[][]
      )[1][0] as { where: { NOT: unknown; cpfCnpj: unknown } };
      // Só quem NÃO é elegível — o cliente já veio na primeira consulta.
      expect(args.where.NOT).toHaveProperty('OR');
      expect(args.where.cpfCnpj).toEqual({ contains: '00000000000191' });
    });

    it('não procura na Prospecção quando o CNPJ já é cliente ou está incompleto', async () => {
      const { service, deps } = montar();
      deps.tx.company.findMany.mockResolvedValue([companyFake()]);

      const cheio = await service.buscarCompanies({ q: '00000000000191' });
      const parcial = await service.buscarCompanies({ q: '0000000000' });

      expect(cheio.prospeccao).toEqual([]);
      expect(parcial.prospeccao).toEqual([]);
      // Uma consulta por busca: nenhuma das duas foi à Prospecção.
      expect(deps.tx.company.findMany).toHaveBeenCalledTimes(2);
    });
  });
  // ---------------------------------------------------------------
  // Proposta congelada -> PDF no card (2026-09-28)
  // ---------------------------------------------------------------
  describe('upsertProposta', () => {
    const HTML = '<html><body><h1>Proposta</h1></body></html>';
    const HASH = createHash('sha256').update(HTML, 'utf8').digest('hex');

    function payload(over: Record<string, unknown> = {}) {
      return {
        opportunity_id: OPPORTUNITY_ID,
        orcamento_id: 3011,
        documento_versao: 1,
        codigo_verificacao: 'ABCD1234',
        nome_arquivo: 'Proposta 3011-26 Ver. 1.0 CLIENTE LTDA',
        html: HTML,
        html_sha256: HASH,
        ...over,
      } as never;
    }

    it('gera o PDF e grava o anexo com o usuario-sistema', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });

      const res = await service.upsertProposta(payload());

      expect(deps.pdf.renderPdf).toHaveBeenCalledWith(HTML);
      expect(deps.storage.upload).toHaveBeenCalledTimes(1);
      const [caminho, bytes, tipo] = deps.storage.upload.mock
        .calls[0] as unknown[];
      expect(caminho).toContain(
        `${WORKSPACE_ID}/opportunities/${OPPORTUNITY_ID}/`,
      );
      // Codigo de verificacao como pasta e o nome da proposta no fim do
      // caminho: "Abrir em nova aba" e salvar sugere o mesmo nome do card.
      expect(caminho).toContain('/orc-3011/ABCD1234/');
      expect(
        String(caminho).endsWith('/Proposta 3011-26 Ver. 1.0 CLIENTE LTDA.pdf'),
      ).toBe(true);
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(tipo).toBe('application/pdf');

      const chamadas = deps.tx.opportunityAttachment.create.mock
        .calls as unknown[][];
      const criado = chamadas[0][0] as { data: Record<string, unknown> };
      // Quem enviou e o sistema: e o que impede qualquer pessoa de remover
      // a proposta oficial pela tela (so o autor do anexo pode).
      expect(criado.data.uploadedBy).toBe(
        '00000000-0000-4000-8000-000000000000',
      );
      expect(criado.data.mimeType).toBe('application/pdf');
      // Mesmo nome do "Salvar como PDF" do app, sem o codigo no fim.
      expect(criado.data.fileName).toBe(
        'Proposta 3011-26 Ver. 1.0 CLIENTE LTDA.pdf',
      );
      expect(res.file_name).toBe('Proposta 3011-26 Ver. 1.0 CLIENTE LTDA.pdf');
      // Entra publicado: gerente e representante veem a proposta na hora.
      expect(criado.data.publishedAt).toBeInstanceOf(Date);
      expect(res.ja_existia).toBe(false);
      expect(res.attachment_id).toBe(ATTACHMENT_ID);
      expect(res.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('recusa quando o HTML nao corresponde ao hash da proposta congelada', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });

      await expect(
        service.upsertProposta(payload({ html_sha256: 'b'.repeat(64) })),
      ).rejects.toThrow(/não corresponde ao hash/);

      // Nada de PDF nem de anexo: documento que nao casa com registro nenhum
      // nao entra no card.
      expect(deps.pdf.renderPdf).not.toHaveBeenCalled();
      expect(deps.storage.upload).not.toHaveBeenCalled();
      expect(deps.tx.opportunityAttachment.create).not.toHaveBeenCalled();
    });

    it('reenvio da mesma versao do orcamento troca o PDF anterior da integracao', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });
      const pasta = `${WORKSPACE_ID}/opportunities/${OPPORTUNITY_ID}/orc-3011/`;
      deps.tx.opportunityAttachment.findMany.mockResolvedValue([
        { id: 'antigo-1', storagePath: `${pasta}velho.pdf` },
      ]);

      await service.upsertProposta(payload());

      const [caminho] = deps.storage.upload.mock.calls[0] as unknown[];
      expect(String(caminho).startsWith(pasta)).toBe(true);
      // So anexos da integracao, desta versao do orcamento, e nunca o novo.
      expect(deps.tx.opportunityAttachment.findMany).toHaveBeenCalledWith({
        where: {
          opportunityId: OPPORTUNITY_ID,
          uploadedBy: '00000000-0000-4000-8000-000000000000',
          storagePath: { startsWith: pasta },
          id: { not: ATTACHMENT_ID },
        },
        select: { id: true, storagePath: true },
      });
      expect(deps.tx.opportunityAttachment.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['antigo-1'] } },
      });
      expect(deps.storage.remove).toHaveBeenCalledWith(`${pasta}velho.pdf`);
    });

    it('nao duplica: reenvio do mesmo codigo devolve o anexo existente', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });
      deps.tx.opportunityAttachment.findFirst.mockResolvedValue({
        id: ATTACHMENT_ID,
        fileName: '3011_26-v1.0 (ABCD1234).pdf',
        storagePath: 'caminho/antigo.pdf',
        sizeBytes: BigInt(1234),
      });

      const res = await service.upsertProposta(payload());

      expect(res.ja_existia).toBe(true);
      expect(res.bytes).toBe(1234);
      expect(res.file_name).toBe('3011_26-v1.0 (ABCD1234).pdf');
      // Acha pela pasta do codigo ou, no formato de antes de 2026-10-16,
      // pelo codigo no fim do nome — e so entre os anexos da integracao.
      const pasta = `${WORKSPACE_ID}/opportunities/${OPPORTUNITY_ID}/orc-3011/`;
      expect(deps.tx.opportunityAttachment.findFirst).toHaveBeenCalledWith({
        where: {
          opportunityId: OPPORTUNITY_ID,
          uploadedBy: '00000000-0000-4000-8000-000000000000',
          OR: [
            { storagePath: { startsWith: `${pasta}ABCD1234/` } },
            {
              storagePath: { startsWith: pasta },
              fileName: { endsWith: '(ABCD1234).pdf' },
            },
          ],
        },
        select: { id: true, fileName: true, storagePath: true, sizeBytes: true },
      });
      expect(deps.pdf.renderPdf).not.toHaveBeenCalled();
      expect(deps.storage.upload).not.toHaveBeenCalled();
    });

    it('recusa oportunidade de outro workspace com 404, nao 403', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue(null);

      await expect(service.upsertProposta(payload())).rejects.toMatchObject({
        status: 404,
      });
      expect(deps.pdf.renderPdf).not.toHaveBeenCalled();
    });

    it('mantem o nome do app e so tira o que o Windows nao aceita', () => {
      expect(
        nomeArquivoProposta('Proposta 3057-26 Ver. 3.0 TCK56Y CLIENTE LTDA'),
      ).toBe('Proposta 3057-26 Ver. 3.0 TCK56Y CLIENTE LTDA.pdf');
      // Barra vira "-" (a mesma troca do app); acento fica.
      expect(nomeArquivoProposta('Proposta 3011/26 Ver. 1.0 MÁQUINAS LTDA')).toBe(
        'Proposta 3011-26 Ver. 1.0 MÁQUINAS LTDA.pdf',
      );
      // Extensao repetida e ponto no fim nao passam; vazio vira "Proposta".
      expect(nomeArquivoProposta('Proposta 1-26 Ver. 1.0 X.pdf')).toBe(
        'Proposta 1-26 Ver. 1.0 X.pdf',
      );
      expect(nomeArquivoProposta('Proposta S.A.')).toBe('Proposta S.A.pdf');
      expect(nomeArquivoProposta('   ')).toBe('Proposta.pdf');
    });

    it('chave do Storage: sem acento, sem barra e sem path traversal', () => {
      expect(nomeArquivoStorage('Proposta 1-26 Ver. 1.0 AGRÍCOLA & CIA.pdf')).toBe(
        'Proposta 1-26 Ver. 1.0 AGRICOLA _ CIA.pdf',
      );
      expect(nomeArquivoStorage(nomeArquivoProposta('../../etc/passwd.pdf'))).toBe(
        '_-_-etc-passwd.pdf',
      );
    });
  });
  // ---------------------------------------------------------------
  // Fila de cotação (2026-09-30) — o funil pedindo, sem saber de orçamento
  // ---------------------------------------------------------------
  describe('fila', () => {
    function oportunidadeFake(over: Record<string, unknown> = {}) {
      return {
        id: OPPORTUNITY_ID,
        description: 'duas máquinas',
        amount: null,
        createdAt: new Date('2026-09-01T12:00:00Z'),
        updatedAt: new Date('2026-09-02T12:00:00Z'),
        slaDueDate: null,
        trelloCardId: 'abc0123456789abcdef01234',
        trelloCardUrl: 'https://trello.com/c/abc',
        ownerUserId: OWNER_USER_ID,
        company: {
          id: COMPANY_ID,
          razaoSocial: 'EMPRESA TESTE LTDA',
          fantasia: null,
          cpfCnpj: '00.000.000/0001-91',
          uf: 'RS',
        },
        stage: { id: STAGE_ID, name: 'Solicitação de Propostas', order: 1 },
        items: [
          { id: 'item-1', name: 'Laser 3015 6kW', amount: null, position: 0 },
          {
            id: 'item-2',
            name: 'Dobradeira 135T',
            amount: 250000,
            position: 1,
          },
        ],
        ...over,
      };
    }

    it('devolve a solicitação com os itens pedidos e o responsável resolvido', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findMany.mockResolvedValue([oportunidadeFake()]);
      deps.supabaseUsers.getIdentities.mockResolvedValue(
        new Map([
          [OWNER_USER_ID, { login: 'darla', name: 'Darlã', email: null }],
        ]),
      );

      const res = await service.fila({});

      expect(res.truncado).toBe(false);
      expect(res.solicitacoes).toHaveLength(1);
      const s = res.solicitacoes[0];
      expect(s.opportunity_id).toBe(OPPORTUNITY_ID);
      expect(s.empresa.cnpj).toBe('00000000000191'); // só dígitos
      expect(s.etapa).toBe('Solicitação de Propostas');
      expect(s.representante).toBe('Darlã');
      expect(s.itens.map((i) => i.item_id)).toEqual(['item-1', 'item-2']);
      expect(s.itens[1].valor).toBe(250000);
    });

    // O filtro tem que ser NULL-safe: oportunidade nascida no CRM tem
    // `origem` nula, e um `NOT` seco a descartaria junto com a carga
    // histórica — foi o que esvaziou a fila inteira em 2026-10-01.
    it('deixa a carga histórica de fora por padrão sem perder quem não tem origem', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findMany.mockResolvedValue([]);

      await service.fila({});
      const semHistorico = deps.tx.opportunity.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(semHistorico.where.NOT).toBeUndefined();
      expect(semHistorico.where.OR).toEqual([
        { origem: null },
        { origem: { not: 'historico-cotacoes' } },
      ]);

      await service.fila({ incluir_historico: true });
      const comHistorico = deps.tx.opportunity.findMany.mock.calls[1][0] as {
        where: Record<string, unknown>;
      };
      expect(comHistorico.where.NOT).toBeUndefined();
      expect(comHistorico.where.OR).toBeUndefined();
    });

    it('avisa quando cortou a lista em vez de mentir por omissão', async () => {
      const { service, deps } = montar();
      // pede 1: a busca traz limite+1 justamente pra saber que havia mais
      deps.tx.opportunity.findMany.mockResolvedValue([
        oportunidadeFake({ id: OPPORTUNITY_ID }),
        oportunidadeFake({ id: COMPANY_ID }),
      ]);

      const res = await service.fila({ limite: 1 });

      expect(res.truncado).toBe(true);
      expect(res.solicitacoes).toHaveLength(1);
    });

    it('só traz oportunidade aberta e viva', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findMany.mockResolvedValue([]);

      await service.fila({});

      const args = deps.tx.opportunity.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where.status).toBe('open');
      expect(args.where.deletedAt).toBeNull();
    });

    it('solicitação sem itens continua aparecendo (é trabalho a detalhar)', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findMany.mockResolvedValue([
        oportunidadeFake({ items: [] }),
      ]);

      const res = await service.fila({});

      expect(res.solicitacoes).toHaveLength(1);
      expect(res.solicitacoes[0].itens).toEqual([]);
    });
  });

  describe('avancarEstagio', () => {
    const APROVACAO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const aprovacao = {
      id: APROVACAO_ID,
      name: 'Aprovação de Propostas',
      order: 3,
    };

    function cardFake(over: Record<string, unknown> = {}) {
      return {
        id: OPPORTUNITY_ID,
        pipelineId: PIPELINE_ID,
        stageId: STAGE_ID,
        status: 'open',
        version: 7,
        stage: { id: STAGE_ID, name: 'Elaboração de Propostas', order: 2 },
        ...over,
      };
    }

    it('move o card para Aprovação pelo OpportunityService, com a versão lida e o ator-sistema', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue(cardFake());
      deps.tx.stage.findFirst.mockResolvedValue(aprovacao);

      const res = await service.avancarEstagio({
        opportunity_id: OPPORTUNITY_ID,
        etapa: 'aprovacao',
      });

      expect(res).toEqual({
        opportunity_id: OPPORTUNITY_ID,
        movido: true,
        de: 'Elaboração de Propostas',
        estagio: 'Aprovação de Propostas',
        motivo: 'movido',
      });
      expect(deps.opportunities.update).toHaveBeenCalledWith(
        deps.tx,
        expect.objectContaining({
          userId: '00000000-0000-4000-8000-000000000000',
          role: 'owner',
        }),
        OPPORTUNITY_ID,
        { version: 7, stageId: APROVACAO_ID },
      );
      // Estágio procurado por nome, dentro do funil do próprio card.
      expect(deps.tx.stage.findFirst).toHaveBeenCalledWith({
        where: {
          pipelineId: PIPELINE_ID,
          name: { equals: 'Aprovação de Propostas', mode: 'insensitive' },
        },
      });
    });

    it('nunca puxa para trás: card já em Negociação fica onde está', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue(
        cardFake({
          stageId: 'negociacao',
          stage: {
            id: 'negociacao',
            name: 'Negociação e Fechamento',
            order: 4,
          },
        }),
      );
      deps.tx.stage.findFirst.mockResolvedValue(aprovacao);

      const res = await service.avancarEstagio({
        opportunity_id: OPPORTUNITY_ID,
        etapa: 'aprovacao',
      });
      expect(res.movido).toBe(false);
      expect(res.motivo).toBe('ja_adiante');
      expect(deps.opportunities.update).not.toHaveBeenCalled();
    });

    it('não mexe em card já no estágio nem em oportunidade fechada', async () => {
      const { service, deps } = montar();
      deps.tx.stage.findFirst.mockResolvedValue(aprovacao);

      deps.tx.opportunity.findFirst.mockResolvedValueOnce(
        cardFake({ stageId: APROVACAO_ID, stage: aprovacao }),
      );
      const mesmo = await service.avancarEstagio({
        opportunity_id: OPPORTUNITY_ID,
        etapa: 'aprovacao',
      });
      expect(mesmo.motivo).toBe('ja_no_estagio');

      deps.tx.opportunity.findFirst.mockResolvedValueOnce(
        cardFake({ status: 'won' }),
      );
      const ganha = await service.avancarEstagio({
        opportunity_id: OPPORTUNITY_ID,
        etapa: 'aprovacao',
      });
      expect(ganha.motivo).toBe('fechada');

      expect(deps.opportunities.update).not.toHaveBeenCalled();
    });

    it('oportunidade inexistente vira 404', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.avancarEstagio({
          opportunity_id: OPPORTUNITY_ID,
          etapa: 'aprovacao',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('etapa "aprovadas" (PDF entregue no card)', () => {
      const APROVADAS_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const aprovadas = {
        id: APROVADAS_ID,
        name: 'Propostas aprovadas',
        order: 4,
      };

      it('move de Aprovação de Propostas para Propostas aprovadas', async () => {
        const { service, deps } = montar();
        deps.tx.opportunity.findFirst.mockResolvedValue(
          cardFake({ stageId: APROVACAO_ID, stage: aprovacao }),
        );
        deps.tx.stage.findFirst.mockResolvedValue(aprovadas);

        const res = await service.avancarEstagio({
          opportunity_id: OPPORTUNITY_ID,
          etapa: 'aprovadas',
        });

        expect(res).toEqual({
          opportunity_id: OPPORTUNITY_ID,
          movido: true,
          de: 'Aprovação de Propostas',
          estagio: 'Propostas aprovadas',
          motivo: 'movido',
        });
        expect(deps.opportunities.update).toHaveBeenCalledWith(
          deps.tx,
          expect.anything(),
          OPPORTUNITY_ID,
          { version: 7, stageId: APROVADAS_ID },
        );
        expect(deps.tx.stage.findFirst).toHaveBeenCalledWith({
          where: {
            pipelineId: PIPELINE_ID,
            name: { equals: 'Propostas aprovadas', mode: 'insensitive' },
          },
        });
      });

      it('não pula etapa: card ainda em Elaboração fica onde está', async () => {
        const { service, deps } = montar();
        deps.tx.opportunity.findFirst.mockResolvedValue(cardFake());
        deps.tx.stage.findFirst.mockResolvedValue(aprovadas);

        const res = await service.avancarEstagio({
          opportunity_id: OPPORTUNITY_ID,
          etapa: 'aprovadas',
        });
        expect(res.movido).toBe(false);
        expect(res.motivo).toBe('fora_da_origem');
        expect(deps.opportunities.update).not.toHaveBeenCalled();
      });

      it('card já em Propostas aprovadas ou adiante não se mexe', async () => {
        const { service, deps } = montar();
        deps.tx.stage.findFirst.mockResolvedValue(aprovadas);

        deps.tx.opportunity.findFirst.mockResolvedValueOnce(
          cardFake({ stageId: APROVADAS_ID, stage: aprovadas }),
        );
        const mesmo = await service.avancarEstagio({
          opportunity_id: OPPORTUNITY_ID,
          etapa: 'aprovadas',
        });
        expect(mesmo.motivo).toBe('ja_no_estagio');

        deps.tx.opportunity.findFirst.mockResolvedValueOnce(
          cardFake({
            stageId: 'negociacao',
            stage: { id: 'negociacao', name: 'Negociação', order: 5 },
          }),
        );
        const adiante = await service.avancarEstagio({
          opportunity_id: OPPORTUNITY_ID,
          etapa: 'aprovadas',
        });
        expect(adiante.motivo).toBe('ja_adiante');

        expect(deps.opportunities.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('itensValor', () => {
    const ITEM_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const ITEM_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    it('grava o valor de cada item pelo servico de itens, com o ator-sistema', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });
      deps.tx.opportunityItem.findMany.mockResolvedValue([
        { id: ITEM_A, amount: null },
        { id: ITEM_B, amount: 500 },
      ]);
      deps.tx.opportunity.findUniqueOrThrow.mockResolvedValue({ amount: 1500 });

      const res = await service.itensValor({
        opportunity_id: OPPORTUNITY_ID,
        itens: [
          { item_id: ITEM_A, amount: 1000 },
          // mesmo valor que ja esta la: nao vira evento no historico
          { item_id: ITEM_B, amount: 500 },
        ],
      });

      expect(deps.opportunityItems.update).toHaveBeenCalledTimes(1);
      expect(deps.opportunityItems.update).toHaveBeenCalledWith(
        deps.tx,
        expect.objectContaining({
          userId: '00000000-0000-4000-8000-000000000000',
        }),
        OPPORTUNITY_ID,
        ITEM_A,
        { amount: 1000 },
      );
      expect(res).toEqual({
        opportunity_id: OPPORTUNITY_ID,
        atualizados: 1,
        valor_oportunidade: '1500',
      });
    });

    it('item de outro card vira 404 e nada e gravado', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue({ id: OPPORTUNITY_ID });
      deps.tx.opportunityItem.findMany.mockResolvedValue([
        { id: ITEM_A, amount: null },
      ]);

      await expect(
        service.itensValor({
          opportunity_id: OPPORTUNITY_ID,
          itens: [{ item_id: ITEM_B, amount: 10 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(deps.opportunityItems.update).not.toHaveBeenCalled();
    });

    it('oportunidade inexistente vira 404', async () => {
      const { service, deps } = montar();
      deps.tx.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.itensValor({
          opportunity_id: OPPORTUNITY_ID,
          itens: [{ item_id: ITEM_A, amount: 10 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
