import type { TenantTx } from '../../tenancy/tenant-context.service';
import type { EgestorAuthService } from './egestor-auth.service';
import type { EgestorHttpService } from './egestor-http.service';
import type { EgestorUsuarioService } from './egestor-usuario.service';
import { EgestorVendaSyncService } from './egestor-venda-sync.service';
import type { FetchVendasResult } from './egestor-venda-sync.service';

// Espelho de contatos já promovido: código 10 na Matriz e 20 na Filial
// apontam pra mesma empresa; código 99 (Matriz) não existe aqui — é o
// caso "cliente do eGestor que ainda não virou empresa no CRM".
const ESPELHO = [
  { codigoMatriz: '10', codigoFilial: '20', companyId: 'company-1' },
  { codigoMatriz: '11', codigoFilial: null, companyId: 'company-2' },
  // Linha nunca promovida — companyId nulo é ignorado no mapa.
  { codigoMatriz: '12', codigoFilial: null, companyId: null },
];

function criarTx(
  overrides: {
    salesExistentes?: Array<{ estabelecimento: string; codVenda: string }>;
    vendedorConhecido?: { vendedorUserId: string } | null;
    salesExistenteUnica?: { id: string } | null;
  } = {},
) {
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const upsert = jest.fn().mockResolvedValue({ id: 'sh-nova' });
  // Itens da venda (2026-08-21) — tabela filha; o fake registra as
  // chamadas pra os testes conferirem o que foi gravado.
  const itemCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const itemDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const createManyAndReturn = jest.fn(
    async ({ data }: { data: Array<Record<string, unknown>> }) =>
      data.map((v, i) => ({
        id: `sh-${i + 1}`,
        companyId: v.companyId,
        estabelecimento: v.estabelecimento,
        codVenda: v.codVenda,
      })),
  );
  const tx = {
    egestorContatoConsolidado: {
      findMany: jest.fn().mockResolvedValue(ESPELHO),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({
        razaoSocial: 'EMPRESA UM LTDA',
        fantasia: null,
      }),
    },
    salesHistory: {
      findMany: jest.fn().mockResolvedValue(overrides.salesExistentes ?? []),
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides.vendedorConhecido ?? null),
      findUnique: jest
        .fn()
        .mockResolvedValue(overrides.salesExistenteUnica ?? null),
      createMany,
      // Devolve o que foi pedido pra gravar já com id — é o retorno que a
      // gravação dos itens usa pra saber a qual venda cada item pertence.
      createManyAndReturn,
      deleteMany,
      upsert,
    },
    salesHistoryItem: {
      createMany: itemCreateMany,
      deleteMany: itemDeleteMany,
    },
  } as unknown as TenantTx;
  return {
    tx,
    createMany: createManyAndReturn,
    deleteMany,
    upsert,
    itemCreateMany,
    itemDeleteMany,
  };
}

function criarService(
  overrides: {
    vendasMatriz?: unknown[];
    vendasFilial?: unknown[];
    vendedores?: Map<string, unknown>;
    getOne?: jest.Mock;
    relatorio?: unknown[];
  } = {},
) {
  const auth = {
    getAccessToken: jest.fn().mockResolvedValue('token'),
  } as unknown as EgestorAuthService;

  // O service chama /v1/vendas uma vez por conta (Matriz e depois Filial),
  // com o mesmo path — alternar pela ordem da chamada é o jeito mais
  // simples de dar respostas diferentes pra cada lado.
  let chamadas = 0;
  const getAllPages = jest.fn(async (): Promise<unknown[]> => {
    chamadas += 1;
    return chamadas === 1
      ? (overrides.vendasMatriz ?? [])
      : (overrides.vendasFilial ?? []);
  });
  // `post` aqui é o relatório de vendas detalhadas (itens), chamado uma
  // vez por conta dentro de fetch(). Vazio por padrão.
  const post = jest.fn(async (): Promise<unknown> => overrides.relatorio ?? []);
  const http = {
    getAllPages,
    getOne: overrides.getOne ?? jest.fn(),
    post,
  } as unknown as EgestorHttpService;

  const usuarios = {
    resolverVendedores: jest
      .fn()
      .mockResolvedValue(overrides.vendedores ?? new Map()),
  } as unknown as EgestorUsuarioService;

  return {
    service: new EgestorVendaSyncService(auth, http, usuarios),
    getAllPages,
    post,
    http,
  };
}

const VENDA_OK = {
  codigo: 447,
  codContato: 10,
  codVendedor: 3,
  nomeVendedor: 'Fulano',
  dtVenda: '2026-03-25',
  valorTotal: 1234.56,
  situacao: 50,
  situacaoOS: 'Faturado',
};

describe('EgestorVendaSyncService', () => {
  describe('fetch — normalização', () => {
    it('descarta linha sem código, sem cliente ou sem data utilizável, contando cada uma', async () => {
      const { service } = criarService({
        vendasMatriz: [
          VENDA_OK,
          { ...VENDA_OK, codigo: '' },
          { ...VENDA_OK, codContato: null },
          { ...VENDA_OK, dtVenda: '25/03/2026' },
          { ...VENDA_OK, dtVenda: undefined },
        ],
      });

      const resultado = await service.fetch([]);

      expect(resultado.vendas).toHaveLength(1);
      expect(resultado.descartadas).toBe(4);
      expect(resultado.totalMatriz).toBe(5);
    });

    it('valor vira string (Decimal no banco) — centavo de venda alta não passa por float', async () => {
      const { service } = criarService({
        vendasMatriz: [{ ...VENDA_OK, valorTotal: '241230.99' }],
      });

      const { vendas } = await service.fetch([]);

      expect(vendas[0].valorTotal).toBe('241230.99');
      expect(typeof vendas[0].valorTotal).toBe('string');
    });

    it('data vem como data pura em UTC — não escorrega pro dia anterior', async () => {
      const { service } = criarService({ vendasMatriz: [VENDA_OK] });

      const { vendas } = await service.fetch([]);

      expect(vendas[0].dtVenda.toISOString()).toBe('2026-03-25T00:00:00.000Z');
    });

    it('situacaoOS em branco vira nulo em vez de string vazia', async () => {
      const { service } = criarService({
        vendasMatriz: [{ ...VENDA_OK, situacaoOS: '   ' }],
      });

      const { vendas } = await service.fetch([]);

      expect(vendas[0].situacaoOs).toBeNull();
    });

    it('vendedor casado com membro do CRM entra com vínculo; sem membro, entra só com o nome', async () => {
      const { service } = criarService({
        vendasMatriz: [VENDA_OK],
        vendasFilial: [{ ...VENDA_OK, codContato: 20, codVendedor: 9 }],
        vendedores: new Map([
          [
            'matriz:3',
            {
              codigo: '3',
              nome: 'Fulano',
              userId: 'user-1',
              casadoPor: 'email',
            },
          ],
          [
            'filial:9',
            { codigo: '9', nome: 'Beltrano', userId: null, casadoPor: null },
          ],
        ]),
      });

      const resultado = await service.fetch(['user-1']);

      const matriz = resultado.vendas.find(
        (v) => v.estabelecimento === 'matriz',
      );
      const filial = resultado.vendas.find(
        (v) => v.estabelecimento === 'filial',
      );
      expect(matriz?.vendedorUserId).toBe('user-1');
      expect(filial?.vendedorUserId).toBeNull();
      expect(filial?.vendedorNome).toBe('Beltrano');
      // Vendedor sem membro é DITO no resumo — nunca some em silêncio.
      expect(resultado.vendedoresSemMembro).toEqual(['Beltrano']);
    });

    it('itens do relatório vêm com valores totais e ficam indexados por conta+código', async () => {
      const { service } = criarService({
        vendasMatriz: [VENDA_OK],
        relatorio: [
          {
            codVenda: '447',
            vendasItens: [
              {
                codProd: '335',
                produto: 'CHAPA DE ACO',
                tipoProd: 'produto',
                quant: '2.0000',
                venda: 170,
                custo: 23.66,
              },
              {
                codProd: '900',
                produto: 'MONTAGEM',
                tipoProd: 'servico',
                quant: '1.0000',
                venda: 500,
                custo: 0,
              },
            ],
          },
        ],
      });

      const { itensPorVenda } = await service.fetch([]);

      // O mesmo relatório é devolvido pras duas contas pelo dublê, então
      // as duas chaves existem — o que importa é que a chave leva a conta
      // junto, nunca só o código.
      const doMatriz = itensPorVenda.get('matriz:447');
      expect(doMatriz).toHaveLength(2);
      expect(doMatriz?.[0]).toEqual({
        tipo: 'produto',
        codProduto: '335',
        descricao: 'CHAPA DE ACO',
        quantidade: '2.0000',
        valorTotal: '170.00',
        custoTotal: '23.66',
      });
      expect(doMatriz?.[1].tipo).toBe('servico');
    });

    it('item com tipo desconhecido fica de fora e é contado (não vira produto por chute)', async () => {
      const { service } = criarService({
        vendasMatriz: [VENDA_OK],
        relatorio: [
          {
            codVenda: '447',
            vendasItens: [
              { produto: 'X', tipoProd: 'kit', quant: 1, venda: 10 },
              { produto: '', tipoProd: 'produto', quant: 1, venda: 10 },
            ],
          },
        ],
      });

      const { itensPorVenda, itensIgnorados } = await service.fetch([]);

      expect(itensPorVenda.size).toBe(0);
      // 2 itens × 2 contas (o dublê devolve o mesmo relatório pros dois lados)
      expect(itensIgnorados).toBe(4);
    });

    it('relatório de itens fora do ar não derruba a carga — vendas entram sem detalhe', async () => {
      const { service, post } = criarService({ vendasMatriz: [VENDA_OK] });
      post.mockRejectedValue(new Error('502 Bad Gateway'));

      const resultado = await service.fetch([]);

      expect(resultado.vendas).toHaveLength(1);
      expect(resultado.itensPorVenda.size).toBe(0);
    });

    it('sempre filtra tipo=50 (venda) — orçamento nunca é pedido à API', async () => {
      const { service, getAllPages } = criarService({ vendasMatriz: [] });

      await service.fetch([]);

      expect(getAllPages).toHaveBeenCalledWith(
        'token',
        '/v1/vendas',
        expect.objectContaining({ tipo: '50' }),
        undefined,
      );
    });
  });

  describe('persist', () => {
    const fetched = (
      vendas: FetchVendasResult['vendas'],
      itensPorVenda: FetchVendasResult['itensPorVenda'] = new Map(),
    ): FetchVendasResult => ({
      vendas,
      itensPorVenda,
      totalMatriz: vendas.length,
      totalFilial: 0,
      descartadas: 0,
      itensIgnorados: 0,
      vendedoresSemMembro: [],
    });

    const venda = (over: Partial<FetchVendasResult['vendas'][0]> = {}) => ({
      estabelecimento: 'matriz' as const,
      codVenda: '447',
      codContato: '10',
      codVendedor: '3',
      vendedorNome: 'Fulano',
      vendedorUserId: 'user-1',
      dtVenda: new Date('2026-03-25T00:00:00Z'),
      valorTotal: '1234.56',
      situacaoOs: 'Faturado',
      ...over,
    });

    it('grava a venda na empresa que o espelho de contatos aponta', async () => {
      const { service } = criarService();
      const { tx, createMany } = criarTx();

      const resumo = await service.persist(tx, 'ws-1', fetched([venda()]));

      expect(resumo.gravadas).toBe(1);
      expect(resumo.empresasComVenda).toBe(1);
      expect(createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ companyId: 'company-1' })],
        }),
      );
    });

    it('venda de cliente ainda sem empresa no CRM vira órfã contada, não erro', async () => {
      const { service } = criarService();
      const { tx, createMany } = criarTx();

      const resumo = await service.persist(
        tx,
        'ws-1',
        fetched([venda({ codContato: '99' })]),
      );

      expect(resumo.gravadas).toBe(0);
      expect(resumo.orfas).toBe(1);
      expect(resumo.orfasCodContatos).toEqual(['matriz:99']);
      expect(createMany).not.toHaveBeenCalled();
    });

    it('código igual em contas diferentes não colide — cada lado resolve a própria empresa', async () => {
      const { service } = criarService();
      const { tx, createMany } = criarTx();

      const resumo = await service.persist(
        tx,
        'ws-1',
        fetched([
          venda({ estabelecimento: 'matriz', codContato: '11' }),
          venda({ estabelecimento: 'filial', codContato: '20' }),
        ]),
      );

      expect(resumo.gravadas).toBe(2);
      const gravadas = createMany.mock.calls[0][0].data;
      expect(gravadas.map((v: { companyId: string }) => v.companyId)).toEqual([
        'company-2',
        'company-1',
      ]);
    });

    it('diz o que entrou de novo e o que sumiu do eGestor desde a última rodada', async () => {
      const { service } = criarService();
      const { tx } = criarTx({
        salesExistentes: [
          { estabelecimento: 'matriz', codVenda: '447' },
          { estabelecimento: 'matriz', codVenda: '900' },
        ],
      });

      const resumo = await service.persist(
        tx,
        'ws-1',
        fetched([venda({ codVenda: '447' }), venda({ codVenda: '448' })]),
      );

      expect(resumo.novas).toBe(1);
      expect(resumo.removidas).toBe(1);
    });

    it('só apaga o lado que a API respondeu — falha numa conta não zera a outra', async () => {
      const { service } = criarService();
      const { tx, deleteMany } = criarTx();

      await service.persist(
        tx,
        'ws-1',
        fetched([venda({ estabelecimento: 'matriz' })]),
      );

      expect(deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', estabelecimento: { in: ['matriz'] } },
      });
    });

    it('grava os itens da venda amarrados ao id que acabou de ser criado', async () => {
      const { service } = criarService();
      const { tx, itemCreateMany } = criarTx();
      const itens = new Map([
        [
          'matriz:447',
          [
            {
              tipo: 'produto' as const,
              codProduto: '335',
              descricao: 'CHAPA DE ACO',
              quantidade: '2.0000',
              valorTotal: '170.00',
              custoTotal: '23.66',
            },
          ],
        ],
      ]);

      const resumo = await service.persist(
        tx,
        'ws-1',
        fetched([venda({ codVenda: '447' })], itens),
      );

      expect(resumo.itensGravados).toBe(1);
      expect(itemCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            salesHistoryId: 'sh-1',
            companyId: 'company-1',
            tipo: 'produto',
            descricao: 'CHAPA DE ACO',
          }),
        ],
      });
    });

    it('venda sem itens no relatório entra assim mesmo, só sem detalhe', async () => {
      const { service } = criarService();
      const { tx, itemCreateMany } = criarTx();

      const resumo = await service.persist(tx, 'ws-1', fetched([venda()]));

      expect(resumo.gravadas).toBe(1);
      expect(resumo.itensGravados).toBe(0);
      expect(itemCreateMany).not.toHaveBeenCalled();
    });

    it('rodada sem nenhuma venda não apaga nada (não zera o histórico por resposta vazia)', async () => {
      const { service } = criarService();
      const { tx, deleteMany, createMany } = criarTx();

      const resumo = await service.persist(tx, 'ws-1', fetched([]));

      expect(deleteMany).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
      expect(resumo.gravadas).toBe(0);
    });
  });

  describe('aplicarEventoWebhook', () => {
    it('action deleted: remove a venda do histórico', async () => {
      const { service } = criarService();
      const { tx, deleteMany } = criarTx();
      (tx.salesHistory.deleteMany as unknown as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const r = await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'deleted',
        null,
      );

      expect(r.resultado).toBe('venda_removida');
      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws-1',
          estabelecimento: 'matriz',
          codVenda: '447',
        },
      });
    });

    it('exclusão de venda que o CRM não tinha: encerra sem alarme', async () => {
      const { service } = criarService();
      const { tx } = criarTx();

      const r = await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'deleted',
        null,
      );

      expect(r.resultado).toBe('venda_inexistente_ignorada');
    });

    it('orçamento (situacao 10) é ignorado — não entra no total comprado', async () => {
      const { service } = criarService();
      const { tx, upsert } = criarTx();

      const r = await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'updated',
        { ...VENDA_OK, situacao: 10 },
      );

      expect(r.resultado).toBe('orcamento_ignorado');
      expect(upsert).not.toHaveBeenCalled();
    });

    it('venda cancelada no eGestor (ativo=false) sai do histórico', async () => {
      const { service } = criarService();
      const { tx } = criarTx();
      (tx.salesHistory.deleteMany as unknown as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const r = await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'updated',
        { ...VENDA_OK, ativo: false },
      );

      expect(r.resultado).toBe('venda_removida');
    });

    it('venda de cliente sem empresa no CRM não é gravada, e o motivo é dito', async () => {
      const { service } = criarService();
      const { tx, upsert } = criarTx();

      const r = await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'created',
        { ...VENDA_OK, codContato: 99 },
      );

      expect(r.resultado).toBe('cliente_sem_empresa_no_crm');
      expect(upsert).not.toHaveBeenCalled();
    });

    it('venda nova: grava e reaproveita o vínculo de vendedor que a carga já resolveu', async () => {
      const { service } = criarService();
      const { tx, upsert } = criarTx({
        vendedorConhecido: { vendedorUserId: 'user-1' },
      });

      const r = await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'created',
        VENDA_OK,
      );

      expect(r.resultado).toBe('venda_criada');
      expect(r.empresa).toBe('EMPRESA UM LTDA');
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ vendedorUserId: 'user-1' }),
          update: expect.objectContaining({ vendedorUserId: 'user-1' }),
        }),
      );
    });

    it('venda que já existia: reporta atualização em vez de criação', async () => {
      const { service } = criarService();
      const { tx } = criarTx({ salesExistenteUnica: { id: 'sh-1' } });

      const r = await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'updated',
        VENDA_OK,
      );

      expect(r.resultado).toBe('venda_atualizada');
    });

    it('regrava os itens da venda a partir do detalhe, convertendo unitário em total', async () => {
      const { service } = criarService();
      const { tx, itemCreateMany, itemDeleteMany } = criarTx();

      await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'updated',
        {
          ...VENDA_OK,
          produtos: [
            {
              codProduto: 335,
              tipo: 'produto',
              descricao: 'CHAPA DE ACO',
              quant: 2,
              preco: 85,
              custo: 11.83,
              vDesc: 0,
            },
            {
              codProduto: 900,
              tipo: 'servico',
              descricao: 'MONTAGEM',
              quant: 1,
              preco: 500,
              custo: 0,
              vDesc: 50,
            },
          ],
        },
      );

      // Apaga antes de gravar: item removido da venda no eGestor precisa
      // sumir daqui também.
      expect(itemDeleteMany).toHaveBeenCalledWith({
        where: { salesHistoryId: 'sh-nova' },
      });
      const gravados = itemCreateMany.mock.calls[0][0].data;
      expect(gravados[0]).toEqual(
        expect.objectContaining({
          descricao: 'CHAPA DE ACO',
          quantidade: '2.0000',
          valorTotal: '170.00',
          custoTotal: '23.66',
        }),
      );
      // Desconto do item entra na conta do total.
      expect(gravados[1]).toEqual(
        expect.objectContaining({ tipo: 'servico', valorTotal: '450.00' }),
      );
    });

    it('vendedor ainda desconhecido: grava a venda com o nome, sem inventar vínculo', async () => {
      const { service } = criarService();
      const { tx, upsert } = criarTx({ vendedorConhecido: null });

      await service.aplicarEventoWebhook(
        tx,
        'ws-1',
        'matriz',
        '447',
        'created',
        VENDA_OK,
      );

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            vendedorUserId: null,
            vendedorNome: 'Fulano',
          }),
        }),
      );
    });
  });
});
