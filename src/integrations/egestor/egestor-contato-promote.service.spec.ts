import { EgestorContatoPromoteService } from './egestor-contato-promote.service';

function linha(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mirror-1',
    workspaceId: 'ws-1',
    cpfCnpj: '11111111000100',
    status: 'so_matriz',
    codigoMatriz: '10',
    codigoFilial: null,
    nomeMatriz: 'Empresa Teste',
    nomeFilial: null,
    dadosMatriz: { codigo: 10, nome: 'Empresa Teste', emails: [], fones: [] },
    dadosFilial: null,
    camposDiferentes: [],
    companyId: null,
    lastSyncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function criarTx(
  overrides: {
    queryRawResult?: Array<{ id: string | null }>;
    companyCreateResult?: Record<string, unknown>;
    companyFindResult?: Record<string, unknown> | null;
    espelhoFindResult?: Record<string, unknown> | null;
  } = {},
) {
  const companyCreate = jest
    .fn()
    .mockResolvedValue(overrides.companyCreateResult ?? { id: 'company-novo' });
  const companyUpdate = jest.fn().mockResolvedValue({});
  const companyFindUniqueOrThrow = jest
    .fn()
    .mockResolvedValue(overrides.companyFindResult ?? { tags: [] });
  const egestorUpdate = jest.fn().mockResolvedValue({});
  const contactFindMany = jest.fn().mockResolvedValue([]);
  const contactCreate = jest.fn().mockResolvedValue({});
  const contactDeleteMany = jest.fn().mockResolvedValue({});
  const rawLeadUpdateMany = jest.fn().mockResolvedValue({});
  const queryRaw = jest
    .fn()
    .mockResolvedValue(overrides.queryRawResult ?? [{ id: null }]);

  return {
    $queryRaw: queryRaw,
    company: {
      create: companyCreate,
      update: companyUpdate,
      findUniqueOrThrow: companyFindUniqueOrThrow,
    },
    egestorContatoConsolidado: {
      update: egestorUpdate,
      findMany: jest.fn(),
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides.espelhoFindResult ?? null),
    },
    contact: {
      findMany: contactFindMany,
      create: contactCreate,
      deleteMany: contactDeleteMany,
    },
    rawLead: { updateMany: rawLeadUpdateMany },
  } as unknown as Parameters<EgestorContatoPromoteService['promoverLinha']>[0];
}

describe('EgestorContatoPromoteService', () => {
  describe('promoverLinha', () => {
    it('cria uma Company nova quando não há dedupe por CNPJ', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({ queryRawResult: [{ id: null }] });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(tx, 'ws-1', linha() as never, summary);

      expect(tx.company.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: 'ws-1',
            cpfCnpj: '11111111000100',
            tags: ['cliente'],
          }),
        }),
      );
      expect(summary.criadasNovas).toBe(1);
      expect(summary.vinculadasExistente).toBe(0);
      expect(summary.promovidas).toBe(1);
    });

    it('vincula a Company já existente (dedupe por CNPJ) em vez de criar outra', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({
        queryRawResult: [{ id: 'company-existente' }],
        companyFindResult: { tags: ['cliente'] },
      });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(tx, 'ws-1', linha() as never, summary);

      expect(tx.company.create).not.toHaveBeenCalled();
      expect(summary.vinculadasExistente).toBe(1);
      expect(summary.criadasNovas).toBe(0);
    });

    it('"graduar" uma Company de lead-triagem pra cliente ao vincular por dedupe', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({
        queryRawResult: [{ id: 'company-lead' }],
        companyFindResult: { tags: ['lead-triagem'] },
      });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(tx, 'ws-1', linha() as never, summary);

      expect(tx.company.update).toHaveBeenCalledWith({
        where: { id: 'company-lead' },
        data: { tags: ['cliente'] },
      });
      expect(tx.rawLead.updateMany).toHaveBeenCalledWith({
        where: { promotedCompanyId: 'company-lead', status: 'novo' },
        data: { status: 'aprovado' },
      });
    });

    it('linha já promovida (companyId presente) não repete dedupe/criação', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx();
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linha({ companyId: 'company-ja-promovida' }) as never,
        summary,
      );

      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.company.create).not.toHaveBeenCalled();
      expect(summary.promovidas).toBe(0); // já contado numa rodada anterior
    });

    it('sem dados em nenhum dos dois lados e nunca promovida — registra erro, não quebra', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx();
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linha({ dadosMatriz: null, dadosFilial: null }) as never,
        summary,
      );

      expect(summary.erros).toEqual([
        {
          cpfCnpj: '11111111000100',
          motivo: 'Sem dados em nenhum dos dois lados.',
        },
      ]);
      expect(tx.company.create).not.toHaveBeenCalled();
    });

    it('erro durante a promoção desta linha não lança — acumula em summary.erros', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx();
      (tx.company.create as jest.Mock).mockRejectedValue(
        new Error('DB fora do ar'),
      );
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await expect(
        service.promoverLinha(tx, 'ws-1', linha() as never, summary),
      ).resolves.toBeUndefined();

      expect(summary.erros).toEqual([
        { cpfCnpj: '11111111000100', motivo: 'DB fora do ar' },
      ]);
    });
  });

  // Ficha da empresa em dia com o eGestor (2026-08-19): antes o cadastro
  // do ERP só entrava na Company no momento da criação — o usuário lançou
  // a inscrição estadual no eGestor e a ficha continuou em branco. Regras:
  // o ERP manda enquanto tiver valor, vazio nunca apaga, lista nunca perde
  // contato que só o CRM conhece.
  describe('promoverLinha — ficha da empresa em dia com o eGestor', () => {
    const fichaNoCrm = (overrides: Record<string, unknown> = {}) => ({
      tags: [],
      razaoSocial: 'EMPRESA TESTE LTDA',
      emRecuperacaoJudicial: false,
      fantasia: null,
      nomeParaContato: null,
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      cep: null,
      cidade: null,
      uf: null,
      emails: [],
      fones: [],
      customFields: {},
      ...overrides,
    });

    const linhaDoEgestor = (dados: Record<string, unknown>) =>
      linha({
        companyId: 'company-1',
        dadosMatriz: {
          codigo: 10,
          nome: 'EMPRESA TESTE LTDA',
          emails: [],
          fones: [],
          ...dados,
        },
      });

    function dadosGravados(tx: {
      company: { update: unknown };
    }): Record<string, unknown> {
      const chamada = (tx.company.update as jest.Mock).mock.calls[0] as Array<{
        data: Record<string, unknown>;
      }>;
      return chamada[0].data;
    }

    it('copia inscrição estadual e indicador de IE do eGestor pra ficha', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({ companyFindResult: fichaNoCrm() });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linhaDoEgestor({
          inscricaoEstadual: '152602207113',
          indicadorIE: '1',
        }) as never,
        summary,
      );

      expect(dadosGravados(tx).customFields).toEqual({
        inscricao_estadual: '152602207113',
        indicador_ie: '1',
      });
      expect(summary.fichasAtualizadas).toBe(1);
    });

    it('atualiza endereço/fantasia do eGestor já em CAIXA ALTA (padrão do CRM)', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({
        companyFindResult: fichaNoCrm({ bairro: 'CENTRO', fantasia: 'ANTIGO' }),
      });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linhaDoEgestor({ bairro: 'Indianopolis', fantasia: 'Novo' }) as never,
        summary,
      );

      expect(dadosGravados(tx)).toMatchObject({
        bairro: 'INDIANOPOLIS',
        fantasia: 'NOVO',
      });
    });

    it('campo vazio no eGestor não apaga o que está na ficha', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({
        companyFindResult: fichaNoCrm({
          bairro: 'CENTRO',
          customFields: { inscricao_estadual: '111111111', indicador_ie: '1' },
        }),
      });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linhaDoEgestor({
          bairro: '',
          inscricaoEstadual: '',
          indicadorIE: '',
        }) as never,
        summary,
      );

      expect(tx.company.update).not.toHaveBeenCalled();
      expect(summary.fichasAtualizadas).toBe(0);
    });

    it('ignora indicador de IE fora do enum (o 0 que a API às vezes devolve)', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({ companyFindResult: fichaNoCrm() });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linhaDoEgestor({
          inscricaoEstadual: '152602207113',
          indicadorIE: '0',
        }) as never,
        summary,
      );

      expect(dadosGravados(tx).customFields).toEqual({
        inscricao_estadual: '152602207113',
      });
    });

    it('não regrava quando a ficha já bate com o eGestor', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({
        companyFindResult: fichaNoCrm({
          customFields: {
            inscricao_estadual: '152602207113',
            indicador_ie: '1',
          },
        }),
      });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linhaDoEgestor({
          inscricaoEstadual: '152602207113',
          indicadorIE: 1,
        }) as never,
        summary,
      );

      expect(tx.company.update).not.toHaveBeenCalled();
    });

    it('não apaga e-mail que só o CRM conhece', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({
        companyFindResult: fichaNoCrm({ emails: ['vendedor@exemplo.com.br'] }),
      });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linhaDoEgestor({ emails: ['erp@exemplo.com.br'] }) as never,
        summary,
      );

      expect(tx.company.update).not.toHaveBeenCalled();
    });

    it('completa a lista de e-mails quando o eGestor tem os do CRM e mais', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({
        companyFindResult: fichaNoCrm({ emails: ['vendedor@exemplo.com.br'] }),
      });
      const summary = EgestorContatoPromoteService.novoSummaryVazio();

      await service.promoverLinha(
        tx,
        'ws-1',
        linhaDoEgestor({
          emails: ['vendedor@exemplo.com.br', 'financeiro@exemplo.com.br'],
        }) as never,
        summary,
      );

      expect(dadosGravados(tx).emails).toEqual([
        'vendedor@exemplo.com.br',
        'financeiro@exemplo.com.br',
      ]);
    });

    it('linha ainda não promovida (sem Company) não tem ficha pra atualizar', async () => {
      const service = new EgestorContatoPromoteService();
      const tx = criarTx({ queryRawResult: [{ id: null }] });

      const campos = await service.sincronizarFichaDaLinha(
        tx,
        'ws-1',
        'mirror-1',
      );

      expect(campos).toEqual([]);
    });
  });

  describe('promoteClean', () => {
    it('processa todas as linhas do workspace, chamando promoverLinha uma vez por linha', async () => {
      const service = new EgestorContatoPromoteService();
      const linhas = [
        linha({ id: 'l1', cpfCnpj: '11111111000100' }),
        linha({ id: 'l2', cpfCnpj: '22222222000100' }),
      ];
      const tx = criarTx();
      (tx.egestorContatoConsolidado.findMany as jest.Mock).mockResolvedValue(
        linhas,
      );

      const summary = await service.promoteClean(tx, 'ws-1');

      expect(tx.company.create).toHaveBeenCalledTimes(2);
      expect(summary.criadasNovas).toBe(2);
      expect(summary.promovidas).toBe(2);
    });
  });
});
