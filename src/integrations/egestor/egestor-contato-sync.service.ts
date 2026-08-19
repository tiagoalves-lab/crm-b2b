import { Injectable } from '@nestjs/common';
import type { EgestorContatoConsolidado, Prisma } from '@prisma/client';
import { CompanyService } from '../../companies/company.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import type { TenantTx } from '../../tenancy/tenant-context.service';
import { EgestorAuthService } from './egestor-auth.service';
import { EgestorHttpService } from './egestor-http.service';
import {
  CAMPOS_CONTATO,
  CAMPOS_IGNORADOS_NA_COMPARACAO,
  limparDocumento,
} from './egestor.types';
import type { Estabelecimento, EgestorContatoRaw } from './egestor.types';

export interface ConsolidatedContatoRow {
  cpfCnpj: string;
  status: 'so_matriz' | 'so_filial' | 'ambos_iguais' | 'ambos_diferentes';
  codigoMatriz: string | null;
  codigoFilial: string | null;
  nomeMatriz: string | null;
  nomeFilial: string | null;
  dadosMatriz: EgestorContatoRaw | null;
  dadosFilial: EgestorContatoRaw | null;
  camposDiferentes: string[];
}

export interface FetchConsolidatedResult {
  rows: ConsolidatedContatoRow[];
  totalMatriz: number;
  totalFilial: number;
  clientesMatriz: number;
  clientesFilial: number;
  semCnpjIgnorados: number;
}

export interface PersistSummary {
  total: number;
  soMatriz: number;
  soFilial: number;
  ambosIguais: number;
  ambosDiferentes: number;
  // Linhas do espelho de uma rodada anterior cujo CNPJ não apareceu como
  // "cliente" em NENHUMA das duas contas nesta rodada — ver comentário
  // em `persist()`.
  orfasRemovidas: number;
  companiesDesativadas: number;
  errosDesativacao: Array<{ cpfCnpj: string; motivo: string }>;
}

// Consolida os contatos das duas contas eGestor (Matriz/Filial) por CNPJ e
// grava na tabela espelho `egestor_contatos_consolidado` — nunca em
// `Company` diretamente (ver docs/roadmap.md, decisão
// 2.1/2.2: a promoção pra Company de verdade é um passo posterior
// explícito, "sanitização", ainda não implementado).
//
// Dividido em duas fases de propósito: `fetchConsolidated` faz só chamada
// HTTP (sem tocar no banco) — pode levar dezenas de segundos pro volume
// atual (~45 páginas no total, throttle de 1.1s entre chamadas). Rodar
// isso dentro de uma transação do Postgres seguraria uma conexão do pool
// ociosa o tempo todo, o mesmo tipo de esgotamento de pool já documentado
// várias vezes neste projeto. `persist` é a fase curta, só escrita, que
// roda dentro de `TenantContextService.run`.
@Injectable()
export class EgestorContatoSyncService {
  constructor(
    private readonly auth: EgestorAuthService,
    private readonly http: EgestorHttpService,
    private readonly companies: CompanyService,
  ) {}

  async fetchConsolidated(options?: {
    maxPages?: number;
  }): Promise<FetchConsolidatedResult> {
    const [contatosMatriz, contatosFilial] = await Promise.all([
      this.fetchClientes('matriz', options),
      this.fetchClientes('filial', options),
    ]);

    const matrizPorCnpj = this.indexarPorCnpj(contatosMatriz.clientes);
    const filialPorCnpj = this.indexarPorCnpj(contatosFilial.clientes);

    const rows: ConsolidatedContatoRow[] = [];

    for (const [cnpj, matriz] of matrizPorCnpj) {
      const filial = filialPorCnpj.get(cnpj);
      if (!filial) {
        rows.push(this.montarLinha(cnpj, 'so_matriz', matriz, null));
        continue;
      }
      const camposDiferentes = this.listarDiferencas(matriz, filial);
      rows.push(
        this.montarLinha(
          cnpj,
          camposDiferentes.length > 0 ? 'ambos_diferentes' : 'ambos_iguais',
          matriz,
          filial,
          camposDiferentes,
        ),
      );
    }

    for (const [cnpj, filial] of filialPorCnpj) {
      if (!matrizPorCnpj.has(cnpj)) {
        rows.push(this.montarLinha(cnpj, 'so_filial', null, filial));
      }
    }

    return {
      rows,
      totalMatriz: contatosMatriz.total,
      totalFilial: contatosFilial.total,
      clientesMatriz: contatosMatriz.clientes.length,
      clientesFilial: contatosFilial.clientes.length,
      semCnpjIgnorados: contatosMatriz.semCnpj + contatosFilial.semCnpj,
    };
  }

  async persist(
    tx: TenantTx,
    membership: MembershipContext,
    rows: ConsolidatedContatoRow[],
  ): Promise<PersistSummary> {
    const workspaceId = membership.workspaceId;
    const summary: PersistSummary = {
      total: 0,
      soMatriz: 0,
      soFilial: 0,
      ambosIguais: 0,
      ambosDiferentes: 0,
      orfasRemovidas: 0,
      companiesDesativadas: 0,
      errosDesativacao: [],
    };
    for (const row of rows) {
      await this.persistirLinha(tx, workspaceId, row, summary);
    }

    await this.reconciliarOrfas(tx, membership, rows, summary);

    return summary;
  }

  // Upsert de UMA linha (extraído do loop de `persist()`, 2026-08-12) —
  // reaproveitado pelo processamento em tempo real do webhook
  // (`EgestorWebhookProcessingService`), que resolve uma linha por vez em
  // vez do lote inteiro.
  private async persistirLinha(
    tx: TenantTx,
    workspaceId: string,
    row: ConsolidatedContatoRow,
    summary: Pick<
      PersistSummary,
      'total' | 'soMatriz' | 'soFilial' | 'ambosIguais' | 'ambosDiferentes'
    >,
  ): Promise<void> {
    const now = new Date();
    await tx.egestorContatoConsolidado.upsert({
      where: { workspaceId_cpfCnpj: { workspaceId, cpfCnpj: row.cpfCnpj } },
      create: {
        workspaceId,
        cpfCnpj: row.cpfCnpj,
        status: row.status,
        codigoMatriz: row.codigoMatriz,
        codigoFilial: row.codigoFilial,
        nomeMatriz: row.nomeMatriz,
        nomeFilial: row.nomeFilial,
        dadosMatriz: (row.dadosMatriz ?? undefined) as Prisma.InputJsonValue,
        dadosFilial: (row.dadosFilial ?? undefined) as Prisma.InputJsonValue,
        camposDiferentes: row.camposDiferentes,
        lastSyncedAt: now,
      },
      update: {
        status: row.status,
        codigoMatriz: row.codigoMatriz,
        codigoFilial: row.codigoFilial,
        nomeMatriz: row.nomeMatriz,
        nomeFilial: row.nomeFilial,
        dadosMatriz: (row.dadosMatriz ?? undefined) as Prisma.InputJsonValue,
        dadosFilial: (row.dadosFilial ?? undefined) as Prisma.InputJsonValue,
        camposDiferentes: row.camposDiferentes,
        lastSyncedAt: now,
      },
    });

    summary.total += 1;
    if (row.status === 'so_matriz') summary.soMatriz += 1;
    else if (row.status === 'so_filial') summary.soFilial += 1;
    else if (row.status === 'ambos_iguais') summary.ambosIguais += 1;
    else summary.ambosDiferentes += 1;
  }

  // Ponto de entrada do processamento em tempo real do webhook
  // (2026-08-12): um evento chegou pra `estabelecimentoAtualizado`/
  // `codigo`. Monta (sem gravar — dry run) a linha combinando o lado que
  // mudou com o que já estava salvo do OUTRO lado no espelho (não busca
  // o outro lado de novo — 1 única chamada à API por evento). Separado
  // de `persistirContatoUnico` (que grava) porque
  // `EgestorWebhookProcessingService` precisa decidir ANTES de gravar se
  // uma divergência exige correção automática no eGestor (chamada de
  // rede — nunca dentro de uma tx, ver comentário lá).
  computarContatoUnico(
    estabelecimentoAtualizado: Estabelecimento,
    cnpj: string,
    dadosFrescos: EgestorContatoRaw | null,
    mirrorExistente: EgestorContatoConsolidado | null,
  ): ConsolidatedContatoRow {
    const matriz =
      estabelecimentoAtualizado === 'matriz'
        ? dadosFrescos
        : ((mirrorExistente?.dadosMatriz ?? null) as EgestorContatoRaw | null);
    const filial =
      estabelecimentoAtualizado === 'filial'
        ? dadosFrescos
        : ((mirrorExistente?.dadosFilial ?? null) as EgestorContatoRaw | null);

    if (matriz && filial) {
      const camposDiferentes = this.listarDiferencas(matriz, filial);
      return this.montarLinha(
        cnpj,
        camposDiferentes.length > 0 ? 'ambos_diferentes' : 'ambos_iguais',
        matriz,
        filial,
        camposDiferentes,
      );
    }
    if (matriz) return this.montarLinha(cnpj, 'so_matriz', matriz, null);
    return this.montarLinha(cnpj, 'so_filial', null, filial);
  }

  // Grava (upsert) uma linha JÁ CALCULADA — usada pelo processamento do
  // webhook depois de decidir (e, se preciso, aplicar uma correção
  // automática) o estado final da linha.
  async persistirLinhaCalculada(
    tx: TenantTx,
    workspaceId: string,
    row: ConsolidatedContatoRow,
  ): Promise<void> {
    await this.persistirLinha(tx, workspaceId, row, {
      total: 0,
      soMatriz: 0,
      soFilial: 0,
      ambosIguais: 0,
      ambosDiferentes: 0,
    });
  }

  // Composição de `computarContatoUnico` + `persistirLinhaCalculada` —
  // atalho pro caso comum (sem divergência a corrigir, ver
  // EgestorWebhookProcessingService#planejarEvento).
  async persistirContatoUnico(
    tx: TenantTx,
    workspaceId: string,
    estabelecimentoAtualizado: Estabelecimento,
    cnpj: string,
    dadosFrescos: EgestorContatoRaw | null,
    mirrorExistente: EgestorContatoConsolidado | null,
  ): Promise<ConsolidatedContatoRow> {
    const row = this.computarContatoUnico(
      estabelecimentoAtualizado,
      cnpj,
      dadosFrescos,
      mirrorExistente,
    );
    await this.persistirLinhaCalculada(tx, workspaceId, row);
    return row;
  }

  // `fetchClientes` já filtra por "cliente" no `tipo` de cada conta (ver
  // comentário lá) — então `rows` só traz CNPJs que são cliente em pelo
  // menos uma das duas contas AGORA. O que falta: quando um contato
  // deixa de ser cliente nas duas contas ao mesmo tempo (ex.: usuário
  // desmarca "Cliente" no eGestor porque foi cadastrado errado — achado
  // real, 2026-08-12), ele simplesmente some de `rows`, e sem este passo
  // a linha antiga do espelho (e a Company promovida a partir dela)
  // ficaria presa pra sempre — o loop de upsert acima só toca em quem
  // ainda é cliente, nunca revisita quem deixou de ser.
  //
  // Fica de fora daqui quem nunca foi promovido (`companyId: null`) —
  // só apaga a linha do espelho (staging, disposable, recriada do zero
  // se o contato voltar a ser cliente). Quem já foi promovido tem a
  // Company **desativada por soft-delete** (reaproveita
  // `CompanyService.remove()`, reversível via "Restaurar" — nunca um
  // DELETE físico, é dado real de CRM que pode ter Opportunity/Task/nota
  // anexada por um representante antes de alguém notar o erro de
  // classificação).
  private async reconciliarOrfas(
    tx: TenantTx,
    membership: MembershipContext,
    rows: ConsolidatedContatoRow[],
    summary: PersistSummary,
  ): Promise<void> {
    // Trava de segurança: `rows` vazio (as duas contas devolveram zero
    // clientes na rodada) quase certamente é falha da API/rede, não a
    // carteira inteira virando não-cliente de uma vez. Sem isso, um
    // fetch vazio por acidente desativaria TODAS as companies já
    // promovidas — pular reconciliação inteira nesse caso, mesmo que
    // custe deixar órfã real presa até a próxima rodada.
    if (rows.length === 0) return;

    const cnpjsAtuais = new Set(rows.map((r) => r.cpfCnpj));

    const orfas = await tx.egestorContatoConsolidado.findMany({
      where: {
        workspaceId: membership.workspaceId,
        cpfCnpj: { notIn: [...cnpjsAtuais] },
      },
      select: { id: true, cpfCnpj: true, companyId: true },
    });

    for (const orfa of orfas) {
      await this.reconciliarLinha(tx, membership, orfa, summary);
    }
  }

  private async reconciliarLinha(
    tx: TenantTx,
    membership: MembershipContext,
    orfa: { id: string; cpfCnpj: string; companyId: string | null },
    summary: Pick<
      PersistSummary,
      'orfasRemovidas' | 'companiesDesativadas' | 'errosDesativacao'
    >,
  ): Promise<void> {
    try {
      if (orfa.companyId) {
        await this.companies.remove(tx, membership, orfa.companyId);
        summary.companiesDesativadas += 1;
      }
      await tx.egestorContatoConsolidado.delete({ where: { id: orfa.id } });
      summary.orfasRemovidas += 1;
    } catch (err) {
      summary.errosDesativacao.push({
        cpfCnpj: orfa.cpfCnpj,
        motivo: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Reconcilia UMA linha específica já identificada como órfã (achado,
  // 2026-08-12) — usada pelo processamento em tempo real do webhook
  // quando um evento chega dizendo que um contato deixou de ser cliente
  // (`tipo` sem "cliente") ou foi excluído no eGestor. Mesma regra do
  // lote (`reconciliarOrfas` acima): desativa a Company por soft-delete
  // se já promovida, sempre apaga a linha do espelho.
  async reconciliarContatoUnico(
    tx: TenantTx,
    membership: MembershipContext,
    mirrorRow: Pick<EgestorContatoConsolidado, 'id' | 'cpfCnpj' | 'companyId'>,
  ): Promise<{ desativouCompany: boolean; erro?: string }> {
    const summary = {
      orfasRemovidas: 0,
      companiesDesativadas: 0,
      errosDesativacao: [] as PersistSummary['errosDesativacao'],
    };
    await this.reconciliarLinha(tx, membership, mirrorRow, summary);

    if (summary.errosDesativacao.length > 0) {
      return {
        desativouCompany: false,
        erro: summary.errosDesativacao[0].motivo,
      };
    }
    return { desativouCompany: summary.companiesDesativadas > 0 };
  }

  private async fetchClientes(
    estabelecimento: 'matriz' | 'filial',
    options?: { maxPages?: number },
  ): Promise<{
    clientes: EgestorContatoRaw[];
    total: number;
    semCnpj: number;
  }> {
    const accessToken = await this.auth.getAccessToken(estabelecimento);
    const todos = await this.http.getAllPages<EgestorContatoRaw>(
      accessToken,
      '/v1/contatos',
      { fields: CAMPOS_CONTATO.join(','), orderBy: 'codigo,asc' },
      options,
    );

    // Decisão 1.9 (docs/roadmap.md): só entra quem tem
    // "cliente" no array `tipo` — fornecedor puro fica de fora.
    const clientesComCnpj: EgestorContatoRaw[] = [];
    let semCnpj = 0;
    for (const contato of todos) {
      if (!Array.isArray(contato.tipo) || !contato.tipo.includes('cliente'))
        continue;
      const cnpj = limparDocumento(contato.cpfcnpj);
      if (!cnpj) {
        semCnpj += 1;
        continue;
      }
      clientesComCnpj.push(contato);
    }

    return { clientes: clientesComCnpj, total: todos.length, semCnpj };
  }

  private indexarPorCnpj(
    contatos: EgestorContatoRaw[],
  ): Map<string, EgestorContatoRaw> {
    const indice = new Map<string, EgestorContatoRaw>();
    for (const contato of contatos) {
      const cnpj = limparDocumento(contato.cpfcnpj);
      if (cnpj && !indice.has(cnpj)) indice.set(cnpj, contato);
    }
    return indice;
  }

  private listarDiferencas(
    matriz: EgestorContatoRaw,
    filial: EgestorContatoRaw,
  ): string[] {
    return CAMPOS_CONTATO.filter((campo) => {
      if (CAMPOS_IGNORADOS_NA_COMPARACAO.has(campo)) return false;
      return normalizarValor(matriz[campo]) !== normalizarValor(filial[campo]);
    });
  }

  private montarLinha(
    cnpj: string,
    status: ConsolidatedContatoRow['status'],
    matriz: EgestorContatoRaw | null,
    filial: EgestorContatoRaw | null,
    camposDiferentes: string[] = [],
  ): ConsolidatedContatoRow {
    return {
      cpfCnpj: cnpj,
      status,
      codigoMatriz: matriz ? String(matriz.codigo) : null,
      codigoFilial: filial ? String(filial.codigo) : null,
      nomeMatriz: matriz?.nome ? String(matriz.nome) : null,
      nomeFilial: filial?.nome ? String(filial.nome) : null,
      dadosMatriz: matriz,
      dadosFilial: filial,
      camposDiferentes,
    };
  }
}

// Mesmo critério do script de referência (normalizarValor_): array vira
// JSON ordenado, objeto vira JSON, resto vira texto trim+maiúsculo — pra
// "diferença" não disparar por causa só de ordem de array ou espaço/caixa.
function normalizarValor(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (Array.isArray(valor)) {
    return JSON.stringify([...valor.map((v) => normalizarValor(v))].sort());
  }
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor).trim().toUpperCase();
}
