import { Injectable, Logger } from '@nestjs/common';
import type { TenantTx } from '../../tenancy/tenant-context.service';
import { EgestorAuthService } from './egestor-auth.service';
import { EgestorHttpService } from './egestor-http.service';
import { EgestorUsuarioService } from './egestor-usuario.service';
import type { VendedorResolvido } from './egestor-usuario.service';
import {
  CAMPOS_VENDA,
  TIPO_VENDA,
  chavePorConta,
  type EgestorVendaDetalhadaRaw,
  type EgestorVendaItemRaw,
  type EgestorVendaProdutoRaw,
  type EgestorVendaRaw,
  type Estabelecimento,
} from './egestor.types';

// Uma venda do eGestor já normalizada, ainda SEM saber a que empresa do
// CRM pertence (isso só é resolvido em `persist`, que tem o banco).
export interface VendaNormalizada {
  estabelecimento: Estabelecimento;
  codVenda: string;
  codContato: string;
  codVendedor: string | null;
  vendedorNome: string | null;
  vendedorUserId: string | null;
  dtVenda: Date;
  valorTotal: string;
  situacaoOs: string | null;
}

// O que foi vendido dentro de uma venda. Sempre com valores TOTAIS do
// item, independente da fonte (o relatório já manda total, o detalhe manda
// unitário e é multiplicado na entrada).
export interface ItemNormalizado {
  tipo: 'produto' | 'servico';
  codProduto: string | null;
  descricao: string;
  quantidade: string;
  valorTotal: string;
  custoTotal: string | null;
}

export interface FetchVendasResult {
  vendas: VendaNormalizada[];
  // Itens indexados por `estabelecimento:codVenda` — casados com a venda
  // só na hora de gravar, quando cada venda já tem id.
  itensPorVenda: Map<string, ItemNormalizado[]>;
  totalMatriz: number;
  totalFilial: number;
  // Linhas que a API devolveu sem código de venda, sem cliente ou sem
  // data utilizável — descartadas antes de chegar no banco, contadas aqui
  // pra nunca sumirem em silêncio.
  descartadas: number;
  // Itens cujo `tipoProd` não é nem "produto" nem "servico" — ficam de
  // fora em vez de serem chutados pra um dos dois lados, que é o que
  // estragaria a curva ABC.
  itensIgnorados: number;
  vendedoresSemMembro: string[];
}

export interface PersistVendasSummary {
  gravadas: number;
  itensGravados: number;
  novas: number;
  // Vendas que existiam no CRM e não vieram mais nesta rodada — foram
  // excluídas ou canceladas no eGestor.
  removidas: number;
  // Venda cujo cliente ainda não virou Company no CRM (contato não
  // promovido, ou promovido sem vínculo). Não é erro: é fila de trabalho.
  orfas: number;
  orfasCodContatos: string[];
  empresasComVenda: number;
  semVendedorVinculado: number;
}

// Traz o histórico de vendas das duas contas eGestor (Matriz/Filial) pra
// `sales_history` — a tabela que alimenta LTV, última compra e a aba
// Pós-venda da ficha da empresa. Nunca cria Opportunity: venda fechada no
// ERP não é negócio de pipeline (ver comentário do model SalesHistory).
//
// Mesma divisão em duas fases de EgestorContatoSyncService, pelo mesmo
// motivo: `fetch` é só rede (21 páginas na Matriz + 2 na Filial no volume
// atual, com throttle de 1,1s entre chamadas — mais de meio minuto) e
// rodar isso dentro de uma transação seguraria uma conexão do pool
// ociosa; `persist` é a fase curta de escrita.
@Injectable()
export class EgestorVendaSyncService {
  private readonly logger = new Logger(EgestorVendaSyncService.name);

  constructor(
    private readonly auth: EgestorAuthService,
    private readonly http: EgestorHttpService,
    private readonly usuarios: EgestorUsuarioService,
  ) {}

  async fetch(
    membroUserIds: string[],
    options?: { maxPages?: number },
  ): Promise<FetchVendasResult> {
    const vendedores = await this.usuarios.resolverVendedores(membroUserIds);

    const [matriz, filial] = await Promise.all([
      this.listarVendas('matriz', options),
      this.listarVendas('filial', options),
    ]);

    const vendas: VendaNormalizada[] = [];
    let descartadas = 0;
    const semMembro = new Set<string>();

    for (const [estabelecimento, brutas] of [
      ['matriz', matriz] as const,
      ['filial', filial] as const,
    ]) {
      for (const bruta of brutas) {
        const normalizada = this.normalizar(
          estabelecimento,
          bruta,
          vendedores,
          semMembro,
        );
        if (!normalizada) {
          descartadas += 1;
          continue;
        }
        vendas.push(normalizada);
      }
    }

    // Itens (o que foi vendido) vêm de um relatório à parte, uma chamada
    // por conta — ver listarItens. Best-effort: se o relatório falhar, as
    // vendas entram do mesmo jeito e só as abas de produto/serviço ficam
    // vazias, em vez de derrubar a carga inteira.
    const { itensPorVenda, itensIgnorados } = await this.listarItens();

    return {
      vendas,
      itensPorVenda,
      totalMatriz: matriz.length,
      totalFilial: filial.length,
      descartadas,
      itensIgnorados,
      vendedoresSemMembro: [...semMembro].sort(),
    };
  }

  // Espelho completo, não merge incremental: a rodada apaga as vendas da
  // conta e regrava o que a API devolveu agora. É o que faz venda excluída
  // no eGestor desaparecer do CRM sem precisar de comparação linha a
  // linha — e `sales_history` não tem nada pendurado nela (nenhuma FK
  // aponta pra cá), então recriar a linha não perde histórico de ninguém.
  // O webhook, esse sim, mexe em uma venda de cada vez.
  async persist(
    tx: TenantTx,
    workspaceId: string,
    fetched: FetchVendasResult,
  ): Promise<PersistVendasSummary> {
    const porContato = await this.mapearContatoParaCompany(tx, workspaceId);

    const paraGravar: Array<{
      workspaceId: string;
      companyId: string;
      estabelecimento: Estabelecimento;
      codVenda: string;
      dtVenda: Date;
      valorTotal: string;
      situacaoOs: string | null;
      codVendedor: string | null;
      vendedorNome: string | null;
      vendedorUserId: string | null;
    }> = [];
    const orfas = new Set<string>();
    let semVendedorVinculado = 0;

    for (const venda of fetched.vendas) {
      const companyId = porContato.get(
        chavePorConta(venda.estabelecimento, venda.codContato),
      );
      if (!companyId) {
        orfas.add(`${venda.estabelecimento}:${venda.codContato}`);
        continue;
      }
      if (!venda.vendedorUserId) semVendedorVinculado += 1;
      paraGravar.push({
        workspaceId,
        companyId,
        estabelecimento: venda.estabelecimento,
        codVenda: venda.codVenda,
        dtVenda: venda.dtVenda,
        valorTotal: venda.valorTotal,
        situacaoOs: venda.situacaoOs,
        codVendedor: venda.codVendedor,
        vendedorNome: venda.vendedorNome,
        vendedorUserId: venda.vendedorUserId,
      });
    }

    // Só apaga o lado que a API respondeu nesta rodada — se a Filial
    // falhar no meio, a Matriz é regravada e a Filial fica intacta em vez
    // de ser zerada por uma falha de rede.
    const ladosSincronizados = [
      ...new Set(fetched.vendas.map((v) => v.estabelecimento)),
    ];

    // Fotografia do que já estava gravado, tirada ANTES de apagar — é o
    // que permite dizer no histórico o que entrou de novo e o que sumiu
    // do eGestor, em vez de só "regravei tudo".
    const antes = ladosSincronizados.length
      ? await tx.salesHistory.findMany({
          where: { workspaceId, estabelecimento: { in: ladosSincronizados } },
          select: { estabelecimento: true, codVenda: true },
        })
      : [];
    const chavesAntes = new Set(
      antes.map((v) => chavePorConta(v.estabelecimento, v.codVenda)),
    );
    const chavesDepois = new Set(
      paraGravar.map((v) => chavePorConta(v.estabelecimento, v.codVenda)),
    );

    if (ladosSincronizados.length > 0) {
      // Os itens vão junto pelo ON DELETE CASCADE da FK — nenhum passo
      // extra aqui, e nenhuma sobra órfã se algo falhar no meio.
      await tx.salesHistory.deleteMany({
        where: { workspaceId, estabelecimento: { in: ladosSincronizados } },
      });
    }
    let itensGravados = 0;
    if (paraGravar.length > 0) {
      // `createManyAndReturn` em vez de `createMany`: os itens precisam do
      // id da venda, e sem isso seria um SELECT extra de 1.000 linhas só
      // pra reencontrar o que acabou de ser inserido.
      const criadas = await tx.salesHistory.createManyAndReturn({
        data: paraGravar,
        select: {
          id: true,
          companyId: true,
          estabelecimento: true,
          codVenda: true,
        },
      });

      const itens = criadas.flatMap((venda) =>
        (
          fetched.itensPorVenda.get(
            chavePorConta(venda.estabelecimento, venda.codVenda),
          ) ?? []
        ).map((item) => ({
          workspaceId,
          salesHistoryId: venda.id,
          companyId: venda.companyId,
          tipo: item.tipo,
          codProduto: item.codProduto,
          descricao: item.descricao,
          quantidade: item.quantidade,
          valorTotal: item.valorTotal,
          custoTotal: item.custoTotal,
        })),
      );
      if (itens.length > 0) {
        await tx.salesHistoryItem.createMany({ data: itens });
        itensGravados = itens.length;
      }
    }

    return {
      gravadas: paraGravar.length,
      itensGravados,
      novas: [...chavesDepois].filter((c) => !chavesAntes.has(c)).length,
      removidas: [...chavesAntes].filter((c) => !chavesDepois.has(c)).length,
      orfas: orfas.size,
      orfasCodContatos: [...orfas].sort(),
      empresasComVenda: new Set(paraGravar.map((v) => v.companyId)).size,
      semVendedorVinculado,
    };
  }

  // ───────────────────────── webhook (uma venda por vez) ─────────────────
  //
  // Fase de rede, fora de transação — mesmo contrato de
  // EgestorWebhookProcessingService#buscarContatoFresco: deixa propagar se
  // o GET falhar, pro eGestor reenviar o evento (até 5x), em vez de
  // inferir exclusão a partir de um erro de rede.
  async buscarVendaFresca(
    estabelecimento: Estabelecimento,
    action: string,
    codigo: string,
  ): Promise<EgestorVendaRaw | null> {
    if (action === 'deleted') return null;
    const accessToken = await this.auth.getAccessToken(estabelecimento);
    return this.http.getOne<EgestorVendaRaw>(
      accessToken,
      `/v1/vendas/${codigo}`,
    );
  }

  // Fase de escrita (dentro de tx). Devolve a chave curta que vira
  // `processResult` no log do evento e entra no histórico de requisições.
  async aplicarEventoWebhook(
    tx: TenantTx,
    workspaceId: string,
    estabelecimento: Estabelecimento,
    codigo: string,
    action: string,
    vendaFresca: EgestorVendaRaw | null,
  ): Promise<{ resultado: string; empresa: string | null }> {
    const apagar = async () => {
      const { count } = await tx.salesHistory.deleteMany({
        where: { workspaceId, estabelecimento, codVenda: codigo },
      });
      return count > 0 ? 'venda_removida' : 'venda_inexistente_ignorada';
    };

    if (action === 'deleted' || !vendaFresca) {
      return { resultado: await apagar(), empresa: null };
    }

    // `situacao` 10 = orçamento, 50 = venda. O mesmo endpoint serve os
    // dois, e o webhook do módulo "vendas" dispara para ambos — orçamento
    // não é histórico de compra e não pode entrar no LTV.
    if (String(vendaFresca.situacao ?? '') !== TIPO_VENDA) {
      return { resultado: 'orcamento_ignorado', empresa: null };
    }
    // Venda cancelada no eGestor vem com `ativo: false` — pro CRM é o
    // mesmo que não existir (segundo o usuário, "cancelada" ali quer
    // dizer cadastro feito errado, não devolução).
    if (vendaFresca.ativo === false) {
      return { resultado: await apagar(), empresa: null };
    }

    const normalizada = this.normalizar(
      estabelecimento,
      vendaFresca,
      new Map(),
      new Set(),
    );
    if (!normalizada) {
      return { resultado: 'venda_sem_dados_minimos', empresa: null };
    }

    const porContato = await this.mapearContatoParaCompany(tx, workspaceId);
    const companyId = porContato.get(
      chavePorConta(estabelecimento, normalizada.codContato),
    );
    if (!companyId) {
      return { resultado: 'cliente_sem_empresa_no_crm', empresa: null };
    }

    // Vendedor: reaproveita o de-para que a carga completa já estabeleceu
    // (outra venda do mesmo vendedor, na mesma conta). Evita duas
    // chamadas ao eGestor + uma ao Supabase Auth dentro dos 3 segundos de
    // timeout do webhook. Vendedor novo fica sem vínculo até a próxima
    // sincronização manual — o nome dele é gravado do mesmo jeito.
    let vendedorUserId: string | null = null;
    if (normalizada.codVendedor) {
      const conhecido = await tx.salesHistory.findFirst({
        where: {
          workspaceId,
          estabelecimento,
          codVendedor: normalizada.codVendedor,
          vendedorUserId: { not: null },
        },
        select: { vendedorUserId: true },
      });
      vendedorUserId = conhecido?.vendedorUserId ?? null;
    }

    const empresa = await tx.company.findUnique({
      where: { id: companyId },
      select: { razaoSocial: true, fantasia: true },
    });

    const dados = {
      companyId,
      dtVenda: normalizada.dtVenda,
      valorTotal: normalizada.valorTotal,
      situacaoOs: normalizada.situacaoOs,
      codVendedor: normalizada.codVendedor,
      vendedorNome: normalizada.vendedorNome,
      vendedorUserId,
    };
    const existente = await tx.salesHistory.findUnique({
      where: {
        workspaceId_estabelecimento_codVenda: {
          workspaceId,
          estabelecimento,
          codVenda: normalizada.codVenda,
        },
      },
      select: { id: true },
    });
    const gravada = await tx.salesHistory.upsert({
      where: {
        workspaceId_estabelecimento_codVenda: {
          workspaceId,
          estabelecimento,
          codVenda: normalizada.codVenda,
        },
      },
      create: {
        workspaceId,
        estabelecimento,
        codVenda: normalizada.codVenda,
        ...dados,
      },
      update: dados,
      select: { id: true },
    });

    // Itens: apaga e regrava os desta venda. O detalhe que o webhook já
    // buscou (`produtos`) traz a composição atual, então não há por que
    // comparar item a item — e assim item removido da venda no eGestor
    // some daqui também.
    await tx.salesHistoryItem.deleteMany({
      where: { salesHistoryId: gravada.id },
    });
    const itens = (
      Array.isArray(vendaFresca.produtos)
        ? (vendaFresca.produtos as EgestorVendaProdutoRaw[])
        : []
    )
      .map((p) => normalizarItemDoDetalhe(p))
      .filter((i): i is ItemNormalizado => i !== null)
      .map((i) => ({
        workspaceId,
        salesHistoryId: gravada.id,
        companyId,
        tipo: i.tipo,
        codProduto: i.codProduto,
        descricao: i.descricao,
        quantidade: i.quantidade,
        valorTotal: i.valorTotal,
        custoTotal: i.custoTotal,
      }));
    if (itens.length > 0) {
      await tx.salesHistoryItem.createMany({ data: itens });
    }

    return {
      resultado: existente ? 'venda_atualizada' : 'venda_criada',
      empresa: empresa?.razaoSocial ?? empresa?.fantasia ?? null,
    };
  }

  // `codContato` (numeração por conta do eGestor) → `companyId` do CRM.
  // O vínculo já existe no espelho de contatos: `codigoMatriz`/
  // `codigoFilial` de cada linha promovida apontam pra uma Company. Por
  // isso o sync de Contatos precisa ter rodado antes — venda de cliente
  // ainda não promovido não tem onde pousar (vira "órfã" no resumo).
  private async mapearContatoParaCompany(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<Map<string, string>> {
    const linhas = await tx.egestorContatoConsolidado.findMany({
      where: { workspaceId, companyId: { not: null } },
      select: { codigoMatriz: true, codigoFilial: true, companyId: true },
    });

    const mapa = new Map<string, string>();
    for (const linha of linhas) {
      if (!linha.companyId) continue;
      if (linha.codigoMatriz) {
        mapa.set(chavePorConta('matriz', linha.codigoMatriz), linha.companyId);
      }
      if (linha.codigoFilial) {
        mapa.set(chavePorConta('filial', linha.codigoFilial), linha.companyId);
      }
    }
    return mapa;
  }

  // Itens de TODAS as vendas das duas contas, numa chamada por conta.
  // `POST /v1/relatorios/vendasDetalhadas` não é paginado e devolve o
  // histórico inteiro de uma vez (607 KB na Matriz, 40 KB na Filial —
  // medido em 2026-08-21), então não vale a pena buscar venda a venda.
  //
  // `mostrarOrcamentos: 0` mantém a mesma regra da listagem (`tipo=50`):
  // orçamento não é compra.
  private async listarItens(): Promise<{
    itensPorVenda: Map<string, ItemNormalizado[]>;
    itensIgnorados: number;
  }> {
    const itensPorVenda = new Map<string, ItemNormalizado[]>();
    let itensIgnorados = 0;

    for (const estabelecimento of ['matriz', 'filial'] as const) {
      let relatorio: EgestorVendaDetalhadaRaw[];
      try {
        const accessToken = await this.auth.getAccessToken(estabelecimento);
        relatorio = await this.http.post<EgestorVendaDetalhadaRaw[]>(
          accessToken,
          '/v1/relatorios/vendasDetalhadas',
          {
            tipoData: 'dtVenda',
            // Janela larga em vez de "sem filtro": aqui as datas são
            // obrigatórias no relatório (diferente da listagem de vendas).
            de: '2000-01-01',
            ate: '2100-12-31',
            mostrarvendasConcluidas: 1,
            mostrarOrcamentos: 0,
          },
        );
      } catch (err) {
        this.logger.warn(
          `Relatório de itens (${estabelecimento}) falhou — vendas entram sem detalhe de produto/serviço: ${(err as Error).message}`,
        );
        continue;
      }

      if (!Array.isArray(relatorio)) continue;
      for (const venda of relatorio) {
        const codVenda = String(venda.codVenda ?? '').trim();
        if (!codVenda) continue;
        const itens: ItemNormalizado[] = [];
        for (const bruto of venda.vendasItens ?? []) {
          const item = normalizarItemDoRelatorio(bruto);
          if (!item) {
            itensIgnorados += 1;
            continue;
          }
          itens.push(item);
        }
        if (itens.length > 0) {
          itensPorVenda.set(chavePorConta(estabelecimento, codVenda), itens);
        }
      }
    }

    return { itensPorVenda, itensIgnorados };
  }

  private async listarVendas(
    estabelecimento: Estabelecimento,
    options?: { maxPages?: number },
  ): Promise<EgestorVendaRaw[]> {
    const accessToken = await this.auth.getAccessToken(estabelecimento);
    // Sem `dtIni`/`dtFim`: confirmado contra a API real (2026-08-20) que a
    // listagem sem filtro de data devolve o histórico inteiro — o mesmo
    // total que uma janela 2000→2026 explícita. Filtro de data fica pra
    // uma eventual carga incremental, que hoje não é necessária (o webhook
    // é quem mantém em dia).
    return this.http.getAllPages<EgestorVendaRaw>(
      accessToken,
      '/v1/vendas',
      { tipo: TIPO_VENDA, fields: CAMPOS_VENDA.join(',') },
      options,
    );
  }

  private normalizar(
    estabelecimento: Estabelecimento,
    bruta: EgestorVendaRaw,
    vendedores: Map<string, VendedorResolvido>,
    semMembro: Set<string>,
  ): VendaNormalizada | null {
    const codVenda = String(bruta.codigo ?? '').trim();
    const codContato = String(bruta.codContato ?? '').trim();
    const dtVenda = parseDataVenda(bruta.dtVenda);
    if (!codVenda || !codContato || !dtVenda) return null;

    const codVendedor = String(bruta.codVendedor ?? '').trim() || null;
    const vendedor = codVendedor
      ? vendedores.get(chavePorConta(estabelecimento, codVendedor))
      : undefined;
    // Nome: prefere o cadastro de usuários (é o nome "oficial"), cai pro
    // que veio no próprio payload da venda quando /usuarios não respondeu.
    const vendedorNome =
      vendedor?.nome ??
      (typeof bruta.nomeVendedor === 'string' && bruta.nomeVendedor.trim()
        ? bruta.nomeVendedor.trim()
        : null);
    if (codVendedor && !vendedor?.userId && vendedorNome) {
      semMembro.add(vendedorNome);
    }

    const situacaoOs =
      typeof bruta.situacaoOS === 'string' && bruta.situacaoOS.trim()
        ? bruta.situacaoOS.trim()
        : null;

    return {
      estabelecimento,
      codVenda,
      codContato,
      codVendedor,
      vendedorNome,
      vendedorUserId: vendedor?.userId ?? null,
      dtVenda,
      // String em vez de number: `valorTotal` é Decimal(14,2) no banco, e
      // passar por float perderia centavo em valor alto (o histórico da
      // Gama tem venda de sete dígitos).
      valorTotal: String(bruta.valorTotal ?? '0'),
      situacaoOs,
    };
  }
}

// Só "produto" e "servico" existem hoje no eGestor. Qualquer outro valor
// devolve null e o item fica de fora: chutar um dos dois lados estragaria
// silenciosamente a curva ABC, que é justamente a divisão entre os dois.
function tipoItem(valor: unknown): 'produto' | 'servico' | null {
  const limpo = String(valor ?? '')
    .trim()
    .toLowerCase();
  if (limpo === 'produto') return 'produto';
  if (limpo === 'servico' || limpo === 'serviço') return 'servico';
  return null;
}

function num(valor: unknown): number {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Item vindo do relatório de vendas detalhadas — `venda` e `custo` já são
// os totais do item.
function normalizarItemDoRelatorio(
  bruto: EgestorVendaItemRaw,
): ItemNormalizado | null {
  const tipo = tipoItem(bruto.tipoProd);
  const descricao = String(bruto.produto ?? '').trim();
  if (!tipo || !descricao) return null;

  return {
    tipo,
    codProduto: String(bruto.codProd ?? '').trim() || null,
    descricao,
    quantidade: num(bruto.quant).toFixed(4),
    valorTotal: num(bruto.venda).toFixed(2),
    custoTotal: bruto.custo === undefined ? null : num(bruto.custo).toFixed(2),
  };
}

// Item vindo do detalhe de UMA venda (`produtos` de GET /v1/vendas/{cod}),
// que é o caminho do webhook. Aqui `preco`/`custo` são UNITÁRIOS — o total
// é quantidade × preço menos o desconto do item, conta conferida contra o
// relatório para a mesma venda (2026-08-21).
function normalizarItemDoDetalhe(
  bruto: EgestorVendaProdutoRaw,
): ItemNormalizado | null {
  const tipo = tipoItem(bruto.tipo);
  const descricao = String(bruto.descricao ?? '').trim();
  if (!tipo || !descricao) return null;

  const quantidade = num(bruto.quant);
  return {
    tipo,
    codProduto: String(bruto.codProduto ?? '').trim() || null,
    descricao,
    quantidade: quantidade.toFixed(4),
    valorTotal: (quantidade * num(bruto.preco) - num(bruto.vDesc)).toFixed(2),
    custoTotal:
      bruto.custo === undefined
        ? null
        : (quantidade * num(bruto.custo)).toFixed(2),
  };
}

// `dtVenda` vem como `yyyy-mm-dd` (confirmado contra a API real). Data-only
// em UTC de propósito: a coluna é DATE, sem hora — interpretar no fuso
// local jogaria a venda pro dia anterior à noite.
function parseDataVenda(valor: unknown): Date | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpo)) return null;
  const data = new Date(`${limpo}T00:00:00Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}
