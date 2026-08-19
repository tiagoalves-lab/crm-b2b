import { Injectable } from '@nestjs/common';
import type { EgestorContatoConsolidado, Prisma } from '@prisma/client';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import type { TenantTx } from '../../tenancy/tenant-context.service';
import { EgestorAuthService } from './egestor-auth.service';
import type {
  AplicarCorrecaoResult,
  CompletarResult,
  CorrecaoDirecao,
} from './egestor-contato-correction.service';
import { EgestorContatoCorrectionService } from './egestor-contato-correction.service';
import { EgestorContatoPromoteService } from './egestor-contato-promote.service';
import {
  EgestorContatoSyncService,
  type ConsolidatedContatoRow,
} from './egestor-contato-sync.service';
import { EgestorHttpService } from './egestor-http.service';
import { limparDocumento } from './egestor.types';
import type { Estabelecimento, EgestorContatoRaw } from './egestor.types';

// Regras de negócio (decisão do usuário, 2026-08-12; recalibrada em
// 2026-08-13 — ver docs/webhook-egestor.md, seção "Correção da regra de
// hierarquia"):
// 1. Matriz e Filial devem ter os dados IGUAIS, exceto o código interno
//    de cada conta (`codigo`, é só o id do registro naquele banco).
// 2. SEM hierarquia fixa entre Matriz e Filial. A conta que disparou o
//    evento (acabou de ser editada por um humano) é a fonte da verdade
//    daquela mudança — o CRM corrige a OUTRA conta pra bater com ela.
//    Direção da correção = `estabelecimento` do evento → o outro lado,
//    não mais sempre Matriz → Filial.
// 3. O webhook age como um "braço" do CRM: uma alteração em qualquer uma
//    das duas contas faz o CRM corrigir automaticamente a outra, pra
//    manter a integridade das duas bases — não é só ler e refletir, é
//    escrever de volta no eGestor quando necessário.
// 4. Escrita automática registra eco (`EgestorWebhookEchoService`) —
//    sem isso, o webhook disparado pela PRÓPRIA correção automática
//    reprocessaria a si mesmo.
// 5. Concorrência: eventos quase simultâneos do MESMO contato (Matriz e
//    Filial editadas quase juntas) são aplicados na ordem de chegada,
//    sem preferência por conta — garantido por um lock por contato
//    (`pg_advisory_xact_lock`, ver `EgestorWebhookService#handleEvent`,
//    que segura o lock por toda a decisão+correção+persistência).
//
// Importante: esta regra 2 (direção da correção automática) é
// independente da regra de EXIBIÇÃO usada em
// `EgestorContatoPromoteService#promoverLinha` (decisão de 2026-08-07,
// Matriz decide o que aparece na ficha de Empresa quando diverge) — são
// duas decisões diferentes, não confundir uma com a outra.
//
// 6. "Completar Matriz⇄Filial" automático (2026-08-13, decisão do
//    usuário depois de ver ao vivo um contato cadastrado só na Matriz
//    ficar parado esperando clique manual) — quando falta um lado
//    inteiro (so_matriz/so_filial), o webhook agora CRIA
//    automaticamente o contato que falta na outra conta, reaproveitando
//    `EgestorContatoCorrectionService#completarNoEgestor` (mesma lógica
//    do botão manual). Só dispara quando: (a) o evento NÃO é `deleted`
//    — nunca recria um registro que acabou de ser apagado de propósito
//    por um humano, ver `ehEventoDeExclusao` abaixo; (b) o contato é
//    CLIENTE (mesmo filtro de `promoverLinha` — não faz sentido
//    espalhar fornecedor/outro tipo pras duas contas, escopo do módulo
//    inteiro é rastrear cliente). Igual à correção de divergência: eco
//    registrado logo após a escrita (regra 4), lock por contato ainda
//    ativo (regra 5).
@Injectable()
export class EgestorWebhookProcessingService {
  constructor(
    private readonly auth: EgestorAuthService,
    private readonly http: EgestorHttpService,
    private readonly sync: EgestorContatoSyncService,
    private readonly promote: EgestorContatoPromoteService,
    private readonly correction: EgestorContatoCorrectionService,
  ) {}

  // Fase 1 (fora de tx) — GET do contato que disparou o evento.
  async buscarContatoFresco(
    estabelecimento: Estabelecimento,
    action: string,
    codigo: string,
  ): Promise<EgestorContatoRaw | null> {
    if (action === 'deleted') return null;

    const accessToken = await this.auth.getAccessToken(estabelecimento);
    // Deixa propagar se falhar (ex.: 404 — contato sumiu entre o evento e
    // agora) — o handler do webhook (EgestorWebhookService) responde 500
    // nesse caso, o eGestor tenta de novo (até 5x); não trata como
    // "excluído" por inferência, só quando o payload já diz isso
    // (`action === 'deleted'`).
    return this.http.getOne<EgestorContatoRaw>(
      accessToken,
      `/v1/contatos/${codigo}`,
    );
  }

  // Fase 2 (tx curta, só leitura + cálculo, SEM chamada de rede) —
  // decide o que fazer: ignorar, corrigir divergência (regra 2 —
  // direção evento → outro lado, sem hierarquia fixa), completar o lado
  // que falta (regra 6), ou só avaliar/persistir a linha calculada.
  async planejarEvento(
    tx: TenantTx,
    workspaceId: string,
    estabelecimento: Estabelecimento,
    action: string,
    codigo: string,
    contatoFresco: EgestorContatoRaw | null,
  ): Promise<PlanoEventoContato> {
    const mirrorExistente = await tx.egestorContatoConsolidado.findFirst({
      where:
        estabelecimento === 'matriz'
          ? { workspaceId, codigoMatriz: codigo }
          : { workspaceId, codigoFilial: codigo },
    });

    const cnpj = contatoFresco
      ? limparDocumento(contatoFresco.cpfcnpj)
      : mirrorExistente?.cpfCnpj;
    if (!cnpj) {
      return { tipo: 'sem_cnpj' };
    }

    const row = this.sync.computarContatoUnico(
      estabelecimento,
      cnpj,
      contatoFresco,
      mirrorExistente,
    );

    // Divergência real entre os dois lados (não só "cliente" — qualquer
    // campo de CAMPOS_CONTATO) e os dois códigos existem — corrige
    // automaticamente. Direção (regra 2, recalibrada 2026-08-13): o lado
    // que disparou ESTE evento é quem acabou de ser editado por um
    // humano, então é a fonte da verdade dessa mudança — corrige o
    // OUTRO lado pra bater com ele. Se por algum motivo um dos códigos
    // não existir (não deveria acontecer quando o status é
    // `ambos_diferentes`, que exige os dois lados com dado), não arrisca
    // corrigir sem saber pra onde escrever — cai pro fluxo normal.
    if (
      row.status === 'ambos_diferentes' &&
      row.codigoMatriz &&
      row.codigoFilial
    ) {
      const direcao: CorrecaoDirecao =
        estabelecimento === 'matriz'
          ? 'matriz_para_filial'
          : 'filial_para_matriz';
      return {
        tipo: 'corrigir_divergencia',
        cnpj,
        row,
        mirrorExistente,
        direcao,
      };
    }

    // Falta um lado inteiro (regra 6) — completa automaticamente, exceto
    // quando o evento é uma exclusão (nunca recria o que um humano
    // acabou de apagar de propósito) ou o contato não é cliente (fora do
    // escopo do módulo, mesmo filtro de `promoverLinha`).
    if (
      (row.status === 'so_matriz' || row.status === 'so_filial') &&
      action !== 'deleted' &&
      contatoEhCliente(row)
    ) {
      return { tipo: 'completar_lado_faltante', cnpj, row, mirrorExistente };
    }

    return { tipo: 'avaliar', cnpj, row, mirrorExistente };
  }

  // Fase 3 (dentro do lock do contato, só quando `planejarEvento` pede)
  // — aplica a correção automática no eGestor, na direção decidida pelo
  // plano (regra 2 recalibrada: evento → outro lado, não mais sempre
  // Matriz → Filial).
  async aplicarCorrecaoAutomatica(
    row: ConsolidatedContatoRow,
    direcao: CorrecaoDirecao,
  ): Promise<AplicarCorrecaoResult> {
    return this.correction.aplicarCorrecaoNoEgestor(
      {
        codigoMatriz: row.codigoMatriz,
        codigoFilial: row.codigoFilial,
        dadosMatriz: row.dadosMatriz as unknown as Prisma.JsonValue,
        dadosFilial: row.dadosFilial as unknown as Prisma.JsonValue,
        camposDiferentes: row.camposDiferentes,
      },
      direcao,
    );
  }

  // Fase 3 (dentro do lock do contato, só quando `planejarEvento` pede,
  // regra 6, 2026-08-13) — completa automaticamente o lado que falta,
  // reaproveitando a mesma lógica do botão manual "Completar Matriz ⇄
  // Filial" (`EgestorContatoCorrectionService#completarNoEgestor`
  // decide sozinho o destino a partir de `row.status`).
  async aplicarCompletarAutomatico(
    row: ConsolidatedContatoRow,
  ): Promise<CompletarResult> {
    return this.correction.completarNoEgestor({
      status: row.status,
      dadosMatriz: row.dadosMatriz as unknown as Prisma.JsonValue,
      dadosFilial: row.dadosFilial as unknown as Prisma.JsonValue,
    });
  }

  // Fase 4 (tx curta) — persiste o estado final (já corrigido/completado,
  // se foi o caso) e promove/atualiza ou reconcilia a Company conforme o
  // resultado.
  async finalizarEvento(
    tx: TenantTx,
    workspaceId: string,
    membership: MembershipContext,
    plano: PlanoEventoContato,
    resultadoCorrecao?: AplicarCorrecaoResult,
    resultadoCompletar?: CompletarResult,
  ): Promise<string> {
    if (plano.tipo === 'sem_cnpj') {
      return 'sem_cnpj_ignorado';
    }

    let rowFinal = plano.row;
    if (plano.tipo === 'corrigir_divergencia') {
      if (!resultadoCorrecao) {
        // Não deveria acontecer (handleEvent sempre chama
        // aplicarCorrecaoAutomatica antes de finalizarEvento pra este
        // tipo de plano) — proteção defensiva, nunca inventa dado.
        throw new Error(
          'Plano pediu correção automática mas o resultado não veio.',
        );
      }
      // Qual lado foi de fato corrigido vem do resultado (destino real do
      // PUT), não de uma direção fixa — regra 2 recalibrada: a correção
      // automática pode ter ido em qualquer sentido, dependendo de qual
      // conta disparou o evento.
      const ladoCorrigidoEhFilial =
        resultadoCorrecao.estabelecimentoEscrito === 'filial';
      const nomeAtualizado =
        typeof resultadoCorrecao.dadosDestinoAtualizados.nome === 'string'
          ? resultadoCorrecao.dadosDestinoAtualizados.nome
          : ladoCorrigidoEhFilial
            ? plano.row.nomeFilial
            : plano.row.nomeMatriz;
      rowFinal = {
        ...plano.row,
        status: 'ambos_iguais',
        camposDiferentes: [],
        ...(ladoCorrigidoEhFilial
          ? {
              dadosFilial: resultadoCorrecao.dadosDestinoAtualizados,
              nomeFilial: nomeAtualizado,
            }
          : {
              dadosMatriz: resultadoCorrecao.dadosDestinoAtualizados,
              nomeMatriz: nomeAtualizado,
            }),
      };
    } else if (plano.tipo === 'completar_lado_faltante') {
      if (!resultadoCompletar) {
        // Não deveria acontecer (handleEvent sempre chama
        // aplicarCompletarAutomatico antes de finalizarEvento pra este
        // tipo de plano) — proteção defensiva, nunca inventa dado.
        throw new Error(
          'Plano pediu completar o lado faltante mas o resultado não veio.',
        );
      }
      const ladoCompletadoEhFilial =
        resultadoCompletar.estabelecimentoEscrito === 'filial';
      const nomeNovo = resultadoCompletar.dadosNovo.nome
        ? String(resultadoCompletar.dadosNovo.nome)
        : undefined;
      rowFinal = {
        ...plano.row,
        status: 'ambos_iguais',
        camposDiferentes: [],
        ...(ladoCompletadoEhFilial
          ? {
              codigoFilial: resultadoCompletar.codigoNovo,
              dadosFilial: resultadoCompletar.dadosNovo,
              ...(nomeNovo ? { nomeFilial: nomeNovo } : {}),
            }
          : {
              codigoMatriz: resultadoCompletar.codigoNovo,
              dadosMatriz: resultadoCompletar.dadosNovo,
              ...(nomeNovo ? { nomeMatriz: nomeNovo } : {}),
            }),
      };
    }

    // Regra de EXIBIÇÃO (decisão de 2026-08-07, independente da direção
    // da correção/completar acima) — prioriza a Matriz quando ela tem
    // dado; só usa a Filial quando o contato só existe lá (`so_filial`,
    // sem Matriz pra opinar ainda). Depois da correção/completar acima os
    // dois lados já ficam iguais, então na prática isso só importa pro
    // caminho `avaliar`.
    if (!contatoEhCliente(rowFinal)) {
      if (!plano.mirrorExistente) {
        return 'nao_e_cliente_nunca_rastreado';
      }
      const resultado = await this.sync.reconciliarContatoUnico(
        tx,
        membership,
        plano.mirrorExistente,
      );
      if (resultado.erro) return `erro_ao_desativar: ${resultado.erro}`;
      return resultado.desativouCompany
        ? 'desativada_nao_e_mais_cliente'
        : 'removida_do_espelho_nunca_promovida';
    }

    await this.sync.persistirLinhaCalculada(tx, workspaceId, rowFinal);

    const linhaPersistida =
      await tx.egestorContatoConsolidado.findUniqueOrThrow({
        where: { workspaceId_cpfCnpj: { workspaceId, cpfCnpj: plano.cnpj } },
      });

    const summary = EgestorContatoPromoteService.novoSummaryVazio();
    await this.promote.promoverLinha(tx, workspaceId, linhaPersistida, summary);

    if (summary.erros.length > 0) {
      return `erro_ao_promover: ${summary.erros[0].motivo}`;
    }
    if (summary.criadasNovas > 0) return 'company_criada';
    if (summary.vinculadasExistente > 0) return 'vinculada_a_company_existente';
    if (plano.tipo === 'corrigir_divergencia')
      return 'divergencia_corrigida_e_atualizada';
    if (plano.tipo === 'completar_lado_faltante')
      return 'lado_faltante_completado_e_atualizada';
    return 'atualizada';
  }
}

// Mesmo critério de `promoverLinha`/`EgestorContatoSyncService` — usa
// Matriz quando ela tem dado, senão Filial (regra de EXIBIÇÃO,
// 2026-08-07). Compartilhado entre `planejarEvento` (decide se vale a
// pena completar o lado faltante, regra 6) e `finalizarEvento` (decide
// promover vs. reconciliar).
function contatoEhCliente(
  row: Pick<ConsolidatedContatoRow, 'dadosMatriz' | 'dadosFilial'>,
): boolean {
  const referencia = row.dadosMatriz ?? row.dadosFilial;
  return (
    !!referencia &&
    Array.isArray(referencia.tipo) &&
    referencia.tipo.includes('cliente')
  );
}

export type PlanoEventoContato =
  | { tipo: 'sem_cnpj' }
  | {
      tipo: 'corrigir_divergencia';
      cnpj: string;
      row: ConsolidatedContatoRow;
      mirrorExistente: EgestorContatoConsolidado | null;
      direcao: CorrecaoDirecao;
    }
  | {
      tipo: 'completar_lado_faltante';
      cnpj: string;
      row: ConsolidatedContatoRow;
      mirrorExistente: EgestorContatoConsolidado | null;
    }
  | {
      tipo: 'avaliar';
      cnpj: string;
      row: ConsolidatedContatoRow;
      mirrorExistente: EgestorContatoConsolidado | null;
    };
