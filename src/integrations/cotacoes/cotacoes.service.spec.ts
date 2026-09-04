import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CotacoesService } from './cotacoes.service';

const TOKEN = 'token-de-teste-cotacoes';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const OPPORTUNITY_ID = '55555555-5555-4555-8555-555555555555';
const OWNER_USER_ID = '66666666-6666-4666-8666-666666666666';
const MEMBERSHIP_ID = '77777777-7777-4777-8777-777777777777';
const PIPELINE_ID = '88888888-8888-4888-8888-888888888888';
const STAGE_ID = '99999999-9999-4999-8999-999999999999';
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

interface Deps {
  config: { get: jest.Mock };
  prisma: { workspace: { findUniqueOrThrow: jest.Mock } };
  tenantContext: { run: jest.Mock };
  opportunities: { create: jest.Mock };
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
    };
    opportunityComment: { findMany: jest.Mock; createMany: jest.Mock };
    pipeline: { findFirst: jest.Mock };
    stage: { findFirst: jest.Mock };
    membership: { findFirst: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
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
    },
    opportunityComment: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown[] }) =>
          Promise.resolve({ count: data.length }),
        ),
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
    },
    supabaseUsers: {
      getIdentities: jest.fn().mockResolvedValue(new Map()),
    },
    tx,
  };

  const service = new CotacoesService(
    deps.config as never,
    deps.prisma as never,
    deps.tenantContext as never,
    deps.opportunities as never,
    deps.supabaseUsers as never,
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
        { externalRef: jaEspelhado },
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
        recebidos: 2,
      });

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
