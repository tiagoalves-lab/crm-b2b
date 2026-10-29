import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EgestorAuthService, tokenRenovavel } from '../integrations/egestor/egestor-auth.service';
import { EgestorHttpService } from '../integrations/egestor/egestor-http.service';
import { EgestorInteractionLogService } from '../integrations/egestor/egestor-interaction-log.service';
import {
  EgestorNfeWebhookRegistry,
  type ProcessadorNfeWebhook,
  type ResultadoEventoNfe,
} from '../integrations/egestor/egestor-nfe-webhook.registry';
import type { Estabelecimento } from '../integrations/egestor/egestor.types';
import {
  TenantContextService,
  type TenantContext,
  type TenantTx,
} from '../tenancy/tenant-context.service';
import { lerNfeXml, type NfeXmlCabecalho } from './nfe-xml';
import {
  acaoNfeRecebida,
  gravarNfeRecebida,
  partesDaChave,
  temXmlNoEgestor,
  type NfeRecebidaGravada,
  type NfeRecebidaLista,
} from './nfe-recebida';

// Carga das notas EMITIDAS pela Gama (NF-e e NFS-e, Matriz e Filial) a
// partir da API do eGestor — docs/console-fiscal.md, seções 2 e 5.
//
// Incremental: nota já gravada, com a mesma situação e (quando cabe) com o
// XML, não é baixada de novo. Por isso a primeira rodada demora (~1 XML
// por segundo, limite do eGestor) e as seguintes são rápidas, e uma
// rodada interrompida (deploy, queda) continua de onde parou ao rodar de
// novo.
//
// Cada nota é gravada na sua própria transação curta, nunca segurando
// conexão do banco aberta durante as chamadas ao eGestor (mesmo cuidado
// da carga de vendas, egestor-venda-sync.service.ts).

const ESTABELECIMENTOS: Estabelecimento[] = ['matriz', 'filial'];

// Origem = consulta do eGestor de onde a nota veio, nunca o conteúdo dela
// (docs/console-fiscal.md, decisões 2.2 e 2.3). As notas recebidas vão ter
// a sua própria ("egestor:/v1/nfe/recebidas" ou "upload_xml").
export const ORIGEM_NFE_EMITIDA = 'egestor:/v1/nfe';
export const ORIGEM_NFSE_EMITIDA = 'egestor:/v1/nfse';

// Só autorizada e cancelada têm XML no eGestor (GET /v1/nfe/{codigo}/xml
// devolve 403 nas outras).
const NFE_SITUACOES_COM_XML = new Set([50, 90]);

// Tempo-limite de cada gravação de nota. O padrão do Prisma (5 s) estourou
// na carga de 2026-10-21 numa nota de 3 itens, por lentidão momentânea do
// banco — gravar uma nota é rápido, mas a carga não pode morrer por um
// soluço.
const TX_NOTA_MS = 30_000;

const NFE_CAMPOS_LISTA =
  'codigo,numero,chave,ambiente,serie,modelo,dtEmissao,cfop,valor,situacao,cliente';

interface NfeLista {
  codigo: number;
  numero?: number | null;
  chave?: string | null;
  ambiente?: number | null;
  serie?: number | null;
  modelo?: number | null;
  dtEmissao?: string | null;
  valor?: string | number | null;
  situacao: number;
  cliente?: string | null;
}

// GET /v1/nfe/{codigo} — formato próprio, com nomes antigos (dt_emissao).
// O detalhe devolve número, modelo e situação como TEXTO ("1202", "55",
// "50"), diferente da listagem. Sem converter, a nota autorizada caía como
// "pendente", sem XML, e a gravação estourava no tipo da coluna (1º
// webhook de NF-e em produção, 2026-10-22).
interface NfeDetalhe {
  codigo: number | string;
  numero?: number | string | null;
  chave?: string | null;
  modelo?: number | string | null;
  dt_emissao?: string | null;
  situacao: number | string;
}

interface NfseLista {
  codigo: number;
  nomeContato?: string | null;
  codVenda?: string | null;
  numeroRPS?: number | null;
  numeroNFSe?: number | null;
  serie?: string | null;
  ambiente?: number | null;
  dtEmissao?: string | null;
  valorBruto?: string | number | null;
  valorLiquido?: string | number | null;
  situacao: number;
}

interface NfseDetalhe {
  nfseItens?: {
    codListaServico?: string | null;
    servico?: string | null;
    cnae?: string | null;
    quant?: string | number | null;
    total?: string | number | null;
  }[];
}

interface NfseImpostosLinha {
  codigo: string | number;
  cpfcnpj?: string | null;
  issqn?: string | number | null;
  inss?: string | number | null;
  pis?: string | number | null;
  cofins?: string | number | null;
  csll?: string | number | null;
  irrf?: string | number | null;
}

export interface FalhaNota {
  estabelecimento: Estabelecimento;
  tipo: 'nfe' | 'nfse' | 'nfe_recebida';
  codEgestor: number;
  numero: number | null;
  motivo: string;
}

export interface ResultadoEstabelecimento {
  nfeListadas: number;
  nfeGravadas: number;
  nfeInalteradas: number;
  nfseListadas: number;
  nfseGravadas: number;
  recebidasListadas: number;
  recebidasGravadas: number;
  recebidasInalteradas: number;
  // Recebidas que o eGestor só tem em resumo (sem manifestação de ciência)
  // — entram sem itens e impostos.
  recebidasSemXml: number;
}

export type ResultadoRecebidasEstabelecimento = Pick<
  ResultadoEstabelecimento,
  'recebidasListadas' | 'recebidasGravadas' | 'recebidasInalteradas' | 'recebidasSemXml'
>;

export interface ResultadoConferenciaRecebidas {
  desde: string;
  ate: string;
  porEstabelecimento: Record<Estabelecimento, ResultadoRecebidasEstabelecimento>;
  falhas: FalhaNota[];
}

export interface ResultadoCarga {
  desde: string;
  ate: string;
  iniciadaEm: string;
  concluidaEm: string;
  porEstabelecimento: Record<Estabelecimento, ResultadoEstabelecimento>;
  falhas: FalhaNota[];
}

export interface StatusCarga {
  emAndamento: boolean;
  etapa: string | null;
  processadas: number;
  total: number;
  iniciadaEm: string | null;
  ultima: ResultadoCarga | null;
  erro: string | null;
}

@Injectable()
export class FiscalNotasSyncService implements OnModuleInit, ProcessadorNfeWebhook {
  private readonly logger = new Logger(FiscalNotasSyncService.name);

  // Estado em memória: o backend roda numa instância só. Se o processo
  // reiniciar no meio, a carga para e a próxima rodada retoma (incremental).
  private andamento: { etapa: string; processadas: number; total: number; iniciadaEm: string } | null =
    null;
  private ultima: ResultadoCarga | null = null;
  private ultimoErro: string | null = null;

  constructor(
    private readonly auth: EgestorAuthService,
    private readonly http: EgestorHttpService,
    private readonly tenantContext: TenantContextService,
    private readonly interactionLog: EgestorInteractionLogService,
    private readonly nfeWebhook: EgestorNfeWebhookRegistry,
  ) {}

  // Se oferece pro webhook do eGestor processar os eventos de NF-e (ver
  // EgestorNfeWebhookRegistry pro porquê da ponte).
  onModuleInit(): void {
    this.nfeWebhook.registrar(this);
  }

  // Um evento do webhook de NF-e (decisão 5.2): busca a nota atual no
  // eGestor e grava, igual à carga, só que de uma nota. Nota que sumiu do
  // eGestor (rascunho excluído) sai da tabela. Erro de rede propaga — o
  // webhook devolve 500 e o eGestor reenvia.
  async aplicarEventoNfe(
    ctx: TenantContext,
    estabelecimento: Estabelecimento,
    codigo: string,
    action: string,
  ): Promise<ResultadoEventoNfe> {
    const cod = Number(codigo);
    const token = await this.auth.getAccessToken(estabelecimento);

    let detalhe: NfeDetalhe | null = null;
    if (action !== 'deleted' && Number.isInteger(cod)) {
      try {
        detalhe = await this.http.getOne<NfeDetalhe>(token, `/v1/nfe/${cod}`);
      } catch (err) {
        if (!/HTTP 404/.test(mensagem(err))) throw err;
      }
    }

    if (!detalhe) {
      const removidas = Number.isInteger(cod)
        ? await this.tenantContext.run(ctx, (tx) =>
            tx.fiscalNfeEmitida.deleteMany({
              where: { workspaceId: ctx.workspaceId, estabelecimento, codEgestor: cod },
            }),
          )
        : { count: 0 };
      return {
        resultado: removidas.count > 0 ? 'nfe_removida' : 'nfe_inexistente_ignorada',
        numero: null,
        situacao: null,
      };
    }

    const situacao = inteiro(detalhe.situacao) ?? 0;
    const numero = inteiro(detalhe.numero);

    let xml: string | null = null;
    let lida: ReturnType<typeof lerNfeXml> | null = null;
    if (NFE_SITUACOES_COM_XML.has(situacao)) {
      xml = await this.http.getText(token, `/v1/nfe/${cod}/xml`);
      if (/<tpAmb>2<\/tpAmb>/.test(xml)) {
        return { resultado: 'nfe_homologacao_ignorada', numero, situacao: null };
      }
      lida = lerNfeXml(xml);
    }

    const nota: NfeLista = {
      codigo: cod,
      numero,
      chave: detalhe.chave ?? null,
      modelo: inteiro(detalhe.modelo),
      dtEmissao: detalhe.dt_emissao ?? null,
      situacao,
    };

    const existia = await this.tenantContext.run(
      ctx,
      async (tx) => {
        // O eGestor manda vários eventos seguidos pra mesma nota (criada,
        // assinada, autorizada) e reenvia até 5x — um de cada vez por nota.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nfe:${estabelecimento}:${cod}`})::bigint)`;
        const antes = await tx.fiscalNfeEmitida.findUnique({
          where: {
            workspaceId_estabelecimento_codEgestor: {
              workspaceId: ctx.workspaceId,
              estabelecimento,
              codEgestor: cod,
            },
          },
          select: { id: true },
        });
        await this.gravarNfe(tx, ctx.workspaceId, estabelecimento, nota, xml, lida);
        return antes !== null;
      },
      { timeoutMs: TX_NOTA_MS },
    );

    return {
      resultado: existia ? 'nfe_atualizada' : 'nfe_criada',
      numero: lida?.cabecalho.numero ?? nota.numero ?? null,
      situacao: situacaoNfe(situacao),
    };
  }

  status(): StatusCarga {
    return {
      emAndamento: this.andamento !== null,
      etapa: this.andamento?.etapa ?? null,
      processadas: this.andamento?.processadas ?? 0,
      total: this.andamento?.total ?? 0,
      iniciadaEm: this.andamento?.iniciadaEm ?? null,
      ultima: this.ultima,
      erro: this.ultimoErro,
    };
  }

  // Dispara em segundo plano e devolve na hora — a primeira carga leva
  // vários minutos, mais que qualquer requisição HTTP aguenta.
  iniciar(ctx: TenantContext, opcoes: { desde: string; ate?: string }): StatusCarga {
    if (!this.andamento) {
      void this.executar(ctx, opcoes).catch((err: unknown) => {
        this.logger.error(`Carga de notas emitidas falhou: ${mensagem(err)}`);
      });
    }
    return this.status();
  }

  async executar(
    ctx: TenantContext,
    opcoes: { desde: string; ate?: string },
  ): Promise<ResultadoCarga> {
    if (this.andamento) {
      throw new Error('Já existe uma carga de notas emitidas em andamento.');
    }
    const desde = opcoes.desde;
    const ate = opcoes.ate ?? hojeBrasilia();
    const iniciadaEm = new Date().toISOString();
    this.andamento = { etapa: 'iniciando', processadas: 0, total: 0, iniciadaEm };
    this.ultimoErro = null;

    const falhas: FalhaNota[] = [];
    const porEstabelecimento = {} as Record<Estabelecimento, ResultadoEstabelecimento>;

    try {
      for (const estabelecimento of ESTABELECIMENTOS) {
        const token = tokenRenovavel(() => this.auth.getAccessToken(estabelecimento));
        const nfe = await this.carregarNfe(ctx, estabelecimento, token, desde, ate, falhas);
        const nfse = await this.carregarNfse(ctx, estabelecimento, token, desde, ate, falhas);
        const recebidas = await this.carregarNfeRecebidas(ctx, estabelecimento, token, desde, ate, falhas);
        porEstabelecimento[estabelecimento] = { ...nfe, ...nfse, ...recebidas };
      }

      const resultado: ResultadoCarga = {
        desde,
        ate,
        iniciadaEm,
        concluidaEm: new Date().toISOString(),
        porEstabelecimento,
        falhas,
      };

      await this.tenantContext.run(ctx, (tx) =>
        this.interactionLog.registrar(tx, ctx.workspaceId, {
          origin: 'crm',
          action: 'carregar_notas_emitidas',
          summary: resumoTexto(resultado),
        }),
      );

      this.ultima = resultado;
      return resultado;
    } catch (err) {
      this.ultimoErro = mensagem(err);
      throw err;
    } finally {
      this.andamento = null;
    }
  }

  // Conferência de hora em hora só das NF-e recebidas (decisão 5.5): o
  // eGestor não avisa quando chega nota recebida nem quando ela ganha o
  // arquivo completo depois da ciência, então o CRM pergunta. Mesma trava
  // da carga completa, pra nunca rodarem juntas (dividem a cota do
  // eGestor). Não mexe na "Última atualização" da tela, que é da carga
  // completa, e só entra no histórico quando gravou ou falhou alguma nota —
  // rodada sem novidade, de hora em hora, seria só ruído.
  async conferirRecebidas(
    ctx: TenantContext,
    opcoes: { desde: string },
  ): Promise<ResultadoConferenciaRecebidas> {
    if (this.andamento) {
      throw new Error('Já existe uma carga de notas em andamento.');
    }
    const desde = opcoes.desde;
    const ate = hojeBrasilia();
    this.andamento = { etapa: 'iniciando', processadas: 0, total: 0, iniciadaEm: new Date().toISOString() };

    const falhas: FalhaNota[] = [];
    const porEstabelecimento = {} as Record<Estabelecimento, ResultadoRecebidasEstabelecimento>;
    try {
      for (const estabelecimento of ESTABELECIMENTOS) {
        const token = tokenRenovavel(() => this.auth.getAccessToken(estabelecimento));
        porEstabelecimento[estabelecimento] = await this.carregarNfeRecebidas(
          ctx,
          estabelecimento,
          token,
          desde,
          ate,
          falhas,
        );
      }

      const resultado: ResultadoConferenciaRecebidas = { desde, ate, porEstabelecimento, falhas };
      const gravadas = ESTABELECIMENTOS.reduce((s, e) => s + porEstabelecimento[e].recebidasGravadas, 0);
      if (gravadas > 0 || falhas.length > 0) {
        await this.tenantContext.run(ctx, (tx) =>
          this.interactionLog.registrar(tx, ctx.workspaceId, {
            origin: 'crm',
            action: 'conferir_nfe_recebidas',
            summary: resumoRecebidasTexto(resultado),
          }),
        );
      }
      return resultado;
    } finally {
      this.andamento = null;
    }
  }

  private async carregarNfe(
    ctx: TenantContext,
    estabelecimento: Estabelecimento,
    token: () => Promise<string>,
    desde: string,
    ate: string,
    falhas: FalhaNota[],
  ): Promise<Pick<ResultadoEstabelecimento, 'nfeListadas' | 'nfeGravadas' | 'nfeInalteradas'>> {
    this.etapa(`NF-e ${estabelecimento}: listando`);
    // dtFim do eGestor não inclui o próprio dia (conferido em 2026-10-20:
    // as notas do dia ficaram de fora) — pede até o dia seguinte e corta
    // aqui pela data local da nota.
    const lista = (
      await this.http.getAllPages<NfeLista>(await token(), '/v1/nfe', {
        dtIni: desde,
        dtFim: diaSeguinte(ate),
        fields: NFE_CAMPOS_LISTA,
      })
    ).filter((n) => {
      const data = dataDaLista(n.dtEmissao).data;
      return (n.ambiente == null || n.ambiente === 1) && (data === null || data <= ate);
    });

    const existentes = await this.tenantContext.run(ctx, (tx) =>
      tx.$queryRaw<{ cod: number; situacao: number; tem_xml: boolean }[]>`
        SELECT cod_egestor AS cod, situacao_egestor AS situacao, (xml IS NOT NULL) AS tem_xml
          FROM fiscal_nfe_emitida
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND estabelecimento = ${estabelecimento}::"Estabelecimento"`,
    );
    const porCodigo = new Map(existentes.map((e) => [e.cod, e]));

    const pendentes = lista.filter((n) => {
      const atual = porCodigo.get(n.codigo);
      if (!atual || atual.situacao !== n.situacao) return true;
      return NFE_SITUACOES_COM_XML.has(n.situacao) && !atual.tem_xml;
    });

    this.andamento = { ...this.andamento!, etapa: `NF-e ${estabelecimento}`, processadas: 0, total: pendentes.length };

    let gravadas = 0;
    for (const nota of pendentes) {
      let xml: string | null = null;
      let lida: ReturnType<typeof lerNfeXml> | null = null;
      if (NFE_SITUACOES_COM_XML.has(nota.situacao)) {
        try {
          xml = await this.http.getText(await token(), `/v1/nfe/${nota.codigo}/xml`);
          lida = lerNfeXml(xml);
        } catch (err) {
          // A nota entra assim mesmo, só com o cabeçalho da listagem e sem
          // XML — a próxima rodada tenta o XML de novo (tem_xml = false).
          falhas.push({
            estabelecimento,
            tipo: 'nfe',
            codEgestor: nota.codigo,
            numero: nota.numero ?? null,
            motivo: mensagem(err),
          });
          xml = null;
          lida = null;
        }
      }

      const ok = await this.gravarNota(
        ctx,
        { estabelecimento, tipo: 'nfe', codEgestor: nota.codigo, numero: nota.numero ?? null },
        falhas,
        (tx) => this.gravarNfe(tx, ctx.workspaceId, estabelecimento, nota, xml, lida),
      );
      if (ok) gravadas += 1;
      this.avancar();
    }

    return {
      nfeListadas: lista.length,
      nfeGravadas: gravadas,
      nfeInalteradas: lista.length - pendentes.length,
    };
  }

  private async gravarNfe(
    tx: TenantTx,
    workspaceId: string,
    estabelecimento: Estabelecimento,
    nota: NfeLista,
    xml: string | null,
    lida: ReturnType<typeof lerNfeXml> | null,
  ): Promise<void> {
    const daLista = dataDaLista(nota.dtEmissao);
    const cab: Partial<NfeXmlCabecalho> = lida?.cabecalho ?? {};

    const dados = {
      origem: ORIGEM_NFE_EMITIDA,
      chave: cab.chave ?? texto(nota.chave),
      numero: cab.numero ?? nota.numero ?? null,
      serie: cab.serie ?? nota.serie ?? null,
      modelo: cab.modelo ?? nota.modelo ?? null,
      dhEmissao: cab.dhEmissao ?? daLista.instante,
      dataEmissao: comoData(cab.dataEmissao ?? daLista.data),
      situacao: situacaoNfe(nota.situacao),
      situacaoEgestor: nota.situacao,
      sentido: cab.sentido ?? null,
      naturezaOperacao: cab.naturezaOperacao ?? null,
      finalidade: cab.finalidade ?? null,
      destCpfCnpj: cab.destCpfCnpj ?? null,
      destNome: cab.destNome ?? texto(nota.cliente),
      destUf: cab.destUf ?? null,
      destIndIe: cab.destIndIe ?? null,
      vBc: cab.vBc ?? null,
      vIcms: cab.vIcms ?? null,
      vIcmsDeson: cab.vIcmsDeson ?? null,
      vFcp: cab.vFcp ?? null,
      vBcSt: cab.vBcSt ?? null,
      vSt: cab.vSt ?? null,
      vFcpSt: cab.vFcpSt ?? null,
      vFcpStRet: cab.vFcpStRet ?? null,
      vIcmsUfDest: cab.vIcmsUfDest ?? null,
      vFcpUfDest: cab.vFcpUfDest ?? null,
      vIcmsUfRemet: cab.vIcmsUfRemet ?? null,
      vProd: cab.vProd ?? null,
      vFrete: cab.vFrete ?? null,
      vSeg: cab.vSeg ?? null,
      vDesc: cab.vDesc ?? null,
      vIi: cab.vIi ?? null,
      vIpi: cab.vIpi ?? null,
      vIpiDevol: cab.vIpiDevol ?? null,
      vPis: cab.vPis ?? null,
      vCofins: cab.vCofins ?? null,
      vOutro: cab.vOutro ?? null,
      vNf: cab.vNf ?? decimal(nota.valor),
      vTotTrib: cab.vTotTrib ?? null,
      vBcIbsCbs: cab.vBcIbsCbs ?? null,
      vIbs: cab.vIbs ?? null,
      vCbs: cab.vCbs ?? null,
      refChaves: cab.refChaves ?? [],
      infCpl: cab.infCpl ?? null,
      xml,
      sincronizadoEm: new Date(),
    };

    const salva = await tx.fiscalNfeEmitida.upsert({
      where: {
        workspaceId_estabelecimento_codEgestor: {
          workspaceId,
          estabelecimento,
          codEgestor: nota.codigo,
        },
      },
      create: { workspaceId, estabelecimento, codEgestor: nota.codigo, ...dados },
      update: dados,
      select: { id: true },
    });

    // Itens só são trocados quando o XML veio — nota que perdeu o XML
    // nesta rodada (falha de rede) mantém os itens que já tinha.
    if (lida) {
      await tx.fiscalNfeEmitidaItem.deleteMany({ where: { nfeId: salva.id } });
      if (lida.itens.length > 0) {
        await tx.fiscalNfeEmitidaItem.createMany({
          data: lida.itens.map((item) => ({ workspaceId, nfeId: salva.id, ...item })),
        });
      }
    }
  }

  private async carregarNfse(
    ctx: TenantContext,
    estabelecimento: Estabelecimento,
    token: () => Promise<string>,
    desde: string,
    ate: string,
    falhas: FalhaNota[],
  ): Promise<Pick<ResultadoEstabelecimento, 'nfseListadas' | 'nfseGravadas'>> {
    this.etapa(`NFS-e ${estabelecimento}: listando`);
    // A listagem de NFS-e não aceita filtro de data — vem tudo e o corte
    // por período é feito aqui (pela data local da nota).
    const lista = (
      await this.http.getAllPages<NfseLista>(await token(), '/v1/nfse', { orderBy: 'codigo,desc' })
    ).filter((n) => {
      const data = dataDaLista(n.dtEmissao).data;
      return (n.ambiente == null || n.ambiente === 1) && data !== null && data >= desde && data <= ate;
    });

    // Impostos da NFS-e só existem neste relatório (a nota não tem XML no
    // eGestor) — uma chamada cobre o período inteiro.
    const impostos = await this.http.post<NfseImpostosLinha[]>(
      await token(),
      '/v1/relatorios/nfseImpostos',
      { de: desde, ate: diaSeguinte(ate) },
    );
    const impostosPorCodigo = new Map(
      (Array.isArray(impostos) ? impostos : []).map((l) => [String(l.codigo), l]),
    );

    const existentes = await this.tenantContext.run(ctx, (tx) =>
      tx.fiscalNfseEmitida.findMany({
        where: { workspaceId: ctx.workspaceId, estabelecimento },
        select: { codEgestor: true, situacaoEgestor: true, itens: true },
      }),
    );
    const porCodigo = new Map(existentes.map((e) => [e.codEgestor, e]));

    this.andamento = { ...this.andamento!, etapa: `NFS-e ${estabelecimento}`, processadas: 0, total: lista.length };

    let gravadas = 0;
    for (const nota of lista) {
      const atual = porCodigo.get(nota.codigo);
      const temItens = !!atual && Array.isArray(atual.itens) && atual.itens.length > 0;

      // Detalhe (itens/serviço) só pra nota nova ou que mudou — o resto da
      // nota é regravado sempre, é barato e mantém os impostos em dia.
      let itens: Prisma.InputJsonValue | undefined;
      if (!atual || atual.situacaoEgestor !== nota.situacao || !temItens) {
        try {
          const detalhe = await this.http.getOne<NfseDetalhe>(await token(), `/v1/nfse/${nota.codigo}`);
          itens = (detalhe.nfseItens ?? []).map((i) => ({
            codListaServico: texto(i.codListaServico),
            servico: texto(i.servico),
            cnae: texto(i.cnae),
            quant: decimal(i.quant),
            total: decimal(i.total),
          }));
        } catch (err) {
          falhas.push({
            estabelecimento,
            tipo: 'nfse',
            codEgestor: nota.codigo,
            numero: nota.numeroNFSe ?? null,
            motivo: mensagem(err),
          });
        }
      }

      const imp = impostosPorCodigo.get(String(nota.codigo));
      const daLista = dataDaLista(nota.dtEmissao);
      const primeiroItem = Array.isArray(itens) ? (itens[0] as { codListaServico?: string | null }) : null;

      const dados = {
        origem: ORIGEM_NFSE_EMITIDA,
        numeroNfse: nota.numeroNFSe ?? null,
        numeroRps: nota.numeroRPS ?? null,
        serie: texto(nota.serie),
        dhEmissao: daLista.instante,
        dataEmissao: comoData(daLista.data),
        situacao: situacaoNfse(nota.situacao),
        situacaoEgestor: nota.situacao,
        codVenda: texto(nota.codVenda),
        tomadorCpfCnpj: texto(imp?.cpfcnpj),
        tomadorNome: texto(nota.nomeContato),
        valorBruto: decimal(nota.valorBruto),
        valorLiquido: decimal(nota.valorLiquido),
        vIss: decimal(imp?.issqn),
        vInss: decimal(imp?.inss),
        vPis: decimal(imp?.pis),
        vCofins: decimal(imp?.cofins),
        vCsll: decimal(imp?.csll),
        vIrrf: decimal(imp?.irrf),
        sincronizadoEm: new Date(),
        ...(itens !== undefined
          ? { itens, codListaServico: primeiroItem?.codListaServico ?? null }
          : {}),
      };

      const ok = await this.gravarNota(
        ctx,
        { estabelecimento, tipo: 'nfse', codEgestor: nota.codigo, numero: nota.numeroNFSe ?? null },
        falhas,
        (tx) =>
          tx.fiscalNfseEmitida.upsert({
            where: {
              workspaceId_estabelecimento_codEgestor: {
                workspaceId: ctx.workspaceId,
                estabelecimento,
                codEgestor: nota.codigo,
              },
            },
            create: { workspaceId: ctx.workspaceId, estabelecimento, codEgestor: nota.codigo, ...dados },
            update: dados,
            select: { id: true },
          }),
      );
      if (ok) gravadas += 1;
      this.avancar();
    }

    return { nfseListadas: lista.length, nfseGravadas: gravadas };
  }

  // NF-e recebidas (emitidas por terceiros contra a Gama). O eGestor puxa
  // essas notas da SEFAZ por conta própria — aqui só se lê o que ele já
  // tem. Mesma lógica incremental das emitidas: XML só de nota nova, que
  // mudou de situação ou que passou a ter o arquivo completo; o resto
  // (manifestação, lançada como compra) só atualiza o resumo, sem chamada
  // extra ao eGestor.
  private async carregarNfeRecebidas(
    ctx: TenantContext,
    estabelecimento: Estabelecimento,
    token: () => Promise<string>,
    desde: string,
    ate: string,
    falhas: FalhaNota[],
  ): Promise<ResultadoRecebidasEstabelecimento> {
    this.etapa(`NF-e recebidas ${estabelecimento}: listando`);
    // Nota de antes do período que ainda está só em resumo também é
    // conferida, um dia de cada vez: a ciência pode vir meses depois, e só
    // a listagem do eGestor diz se o arquivo já chegou. Fica de fora a que
    // a Gama declarou desconhecida ou não realizada — essa nunca vai ter
    // arquivo.
    const diasSoResumo = await this.tenantContext.run(ctx, (tx) =>
      tx.$queryRaw<{ dia: string }[]>`
        SELECT DISTINCT to_char(data_emissao, 'YYYY-MM-DD') AS dia
          FROM fiscal_nfe_recebida
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND estabelecimento = ${estabelecimento}::"Estabelecimento"
           AND xml IS NULL
           AND situacao = 'autorizada'
           AND data_emissao < ${desde}::date
           AND (manifesto IS NULL OR manifesto NOT IN ('210220', '210240'))
         ORDER BY 1`,
    );
    const periodos = [
      { dtIni: desde, dtFim: diaSeguinte(ate) },
      ...diasSoResumo.map(({ dia }) => ({ dtIni: dia, dtFim: diaSeguinte(dia) })),
    ];

    const porChaveListada = new Map<string, NfeRecebidaLista & { chave: string }>();
    for (const periodo of periodos) {
      const pagina = await this.http.getAllPages<NfeRecebidaLista>(await token(), '/v1/nfe/recebidas', periodo);
      for (const n of pagina) {
        const data = dataDaLista(n.dtEmissao).data;
        if (
          n.tipo !== 'evento' &&
          (n.ambiente == null || n.ambiente === 1) &&
          typeof n.chave === 'string' &&
          /^\d{44}$/.test(n.chave) &&
          (data === null || data <= ate)
        ) {
          porChaveListada.set(n.chave, n as NfeRecebidaLista & { chave: string });
        }
      }
    }
    const lista = [...porChaveListada.values()];

    const gravadas = await this.tenantContext.run(ctx, (tx) =>
      tx.$queryRaw<NfeRecebidaGravada[]>`
        SELECT chave,
               cod_egestor      AS "codEgestor",
               situacao_egestor AS "situacaoEgestor",
               manifesto,
               lancada_compra   AS "lancadaCompra",
               (xml IS NOT NULL) AS "temXml"
          FROM fiscal_nfe_recebida
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND estabelecimento = ${estabelecimento}::"Estabelecimento"`,
    );
    const porChave = new Map(gravadas.map((g) => [g.chave, g]));

    const pendentes = lista
      .map((nota) => ({ nota, acao: acaoNfeRecebida(nota, porChave.get(nota.chave)) }))
      .filter((p) => p.acao !== 'nada');

    this.andamento = {
      ...this.andamento!,
      etapa: `NF-e recebidas ${estabelecimento}`,
      processadas: 0,
      total: pendentes.length,
    };

    let gravadasAgora = 0;
    for (const { nota, acao } of pendentes) {
      let xml: string | null = null;
      let lida: ReturnType<typeof lerNfeXml> | null = null;
      if (acao === 'baixar_xml') {
        try {
          xml = await this.http.getText(await token(), `/v1/nfe/recebidas/${nota.codigo}/xml`);
          lida = lerNfeXml(xml);
        } catch (err) {
          falhas.push({
            estabelecimento,
            tipo: 'nfe_recebida',
            codEgestor: nota.codigo,
            numero: partesDaChave(nota.chave)?.numero ?? null,
            motivo: mensagem(err),
          });
          xml = null;
          lida = null;
        }
      }

      const preservarArquivo = !lida && Boolean(porChave.get(nota.chave)?.temXml);
      const ok = await this.gravarNota(
        ctx,
        {
          estabelecimento,
          tipo: 'nfe_recebida',
          codEgestor: nota.codigo,
          numero: partesDaChave(nota.chave)?.numero ?? null,
        },
        falhas,
        (tx) =>
          gravarNfeRecebida(tx, {
            workspaceId: ctx.workspaceId,
            estabelecimento,
            nota,
            preservarArquivo,
            xml,
            lida,
            daLista: dataDaLista(nota.dtEmissao),
            decimal,
          }),
      );
      if (ok) gravadasAgora += 1;
      this.avancar();
    }

    return {
      recebidasListadas: lista.length,
      recebidasGravadas: gravadasAgora,
      recebidasInalteradas: lista.length - pendentes.length,
      recebidasSemXml: lista.filter((n) => !temXmlNoEgestor(n)).length,
    };
  }

  // Grava uma nota na sua própria transação. Falha de banco numa nota vira
  // falha da nota (fica de fora e entra de novo na próxima rodada, porque a
  // carga é incremental) — nunca derruba a carga inteira.
  private async gravarNota(
    ctx: TenantContext,
    identificacao: Omit<FalhaNota, 'motivo'>,
    falhas: FalhaNota[],
    gravar: (tx: TenantTx) => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await this.tenantContext.run(ctx, gravar, { timeoutMs: TX_NOTA_MS });
      return true;
    } catch (err) {
      falhas.push({ ...identificacao, motivo: `erro ao gravar: ${mensagem(err)}` });
      return false;
    }
  }

  private etapa(etapa: string): void {
    if (this.andamento) this.andamento = { ...this.andamento, etapa, processadas: 0, total: 0 };
    this.logger.log(etapa);
  }

  private avancar(): void {
    if (this.andamento) {
      this.andamento = { ...this.andamento, processadas: this.andamento.processadas + 1 };
    }
  }
}

// NF-e: 50 autorizada, 90 cancelada, 91 inutilizada, 80 denegada,
// 15 rejeitada; o resto (criada, em digitação, assinada, enviada,
// inutilização solicitada) ainda não produziu efeito fiscal.
export function situacaoNfe(codigo: number): string {
  switch (codigo) {
    case 50:
      return 'autorizada';
    case 90:
      return 'cancelada';
    case 91:
      return 'inutilizada';
    case 80:
      return 'denegada';
    case 15:
      return 'rejeitada';
    default:
      return 'pendente';
  }
}

// NFS-e: 10 autorizada, 25 aguardando a prefeitura cancelar (ainda vale
// até a prefeitura confirmar), 90 cancelada, 30 rejeitada, 40 denegada.
export function situacaoNfse(codigo: number): string {
  switch (codigo) {
    case 10:
      return 'autorizada';
    case 25:
      return 'cancelamento_pendente';
    case 90:
      return 'cancelada';
    case 30:
      return 'rejeitada';
    case 40:
      return 'denegada';
    default:
      return 'pendente';
  }
}

// O eGestor manda data como "AAAA-MM-DD HH:MM:SS", no horário de Brasília
// (sem horário de verão desde 2019).
export function dataDaLista(valor: string | null | undefined): {
  data: string | null;
  instante: Date | null;
} {
  if (!valor || !/^\d{4}-\d{2}-\d{2}/.test(valor)) return { data: null, instante: null };
  const data = valor.slice(0, 10);
  const hora = /\d{2}:\d{2}(:\d{2})?/.exec(valor.slice(10))?.[0] ?? '00:00:00';
  const instante = new Date(`${data}T${hora.length === 5 ? `${hora}:00` : hora}-03:00`);
  return { data, instante: Number.isNaN(instante.getTime()) ? null : instante };
}

// Valor numérico do eGestor vem ora como número, ora como texto "1234.56".
export function decimal(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : null;
  const limpo = valor.trim();
  if (/^-?\d+(\.\d+)?$/.test(limpo)) return limpo;
  // Formato brasileiro ("1.234,56"), por garantia.
  if (/^-?[\d.]+,\d+$/.test(limpo)) return limpo.replace(/\./g, '').replace(',', '.');
  return null;
}

// O eGestor manda alguns campos ora como texto, ora como número (o NSU,
// por exemplo, vem numérico).
function texto(valor: string | number | null | undefined): string | null {
  const t = valor === null || valor === undefined ? '' : String(valor).trim();
  return t ? t : null;
}

function inteiro(valor: string | number | null | undefined): number | null {
  const t = texto(valor);
  const n = t === null ? NaN : Number(t);
  return Number.isInteger(n) ? n : null;
}

// Coluna DATE: meia-noite UTC do dia, pra o Postgres gravar exatamente o
// dia da nota.
function comoData(data: string | null): Date | null {
  return data ? new Date(`${data}T00:00:00.000Z`) : null;
}

function diaSeguinte(data: string): string {
  const d = new Date(`${data}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function hojeBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resumoRecebidasTexto(r: ResultadoConferenciaRecebidas): string {
  const partes = ESTABELECIMENTOS.map((e) => {
    const x = r.porEstabelecimento[e];
    const nome = e === 'matriz' ? 'Matriz' : 'Filial';
    return `${nome}: ${x.recebidasGravadas} gravada(s), ${x.recebidasSemXml} só com o resumo`;
  });
  const falhas = r.falhas.length > 0 ? `; ${r.falhas.length} nota(s) com falha — entram de novo na próxima rodada` : '';
  return `Conferência das NF-e recebidas de ${r.desde} a ${r.ate} — ${partes.join('; ')}${falhas}.`;
}

function resumoTexto(r: ResultadoCarga): string {
  const partes = ESTABELECIMENTOS.map((e) => {
    const x = r.porEstabelecimento[e];
    const nome = e === 'matriz' ? 'Matriz' : 'Filial';
    return `${nome}: ${x.nfeListadas} NF-e emitida(s) no eGestor (${x.nfeGravadas} gravada(s), ${x.nfeInalteradas} sem mudança), ${x.nfseListadas} NFS-e e ${x.recebidasListadas} NF-e recebida(s) (${x.recebidasGravadas} gravada(s), ${x.recebidasSemXml} só com o resumo)`;
  });
  const falhas = r.falhas.length > 0 ? `; ${r.falhas.length} nota(s) com falha — entram de novo na próxima rodada` : '';
  return `Carga de notas de ${r.desde} a ${r.ate} — ${partes.join('; ')}${falhas}.`;
}
