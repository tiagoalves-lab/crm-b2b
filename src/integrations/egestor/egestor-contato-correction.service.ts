import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EgestorContatoConsolidado } from '@prisma/client';
import { EgestorContatoStatus, Prisma } from '@prisma/client';
import { CompanyService } from '../../companies/company.service';
import type { CnpjLookupResult } from '../../companies/company.service';
import type { TenantTx } from '../../tenancy/tenant-context.service';
import { EgestorAuthService } from './egestor-auth.service';
import { EgestorHttpService } from './egestor-http.service';
import { EgestorWebhookEchoService } from './egestor-webhook-echo.service';
import {
  CAMPOS_ARRAY,
  CAMPOS_CONTATO,
  CAMPOS_IGNORADOS_NA_COMPARACAO,
  extrairContatoArray,
} from './egestor.types';
import type { Estabelecimento, EgestorContatoRaw } from './egestor.types';

export type CorrecaoDirecao = 'matriz_para_filial' | 'filial_para_matriz';

export interface AplicarCorrecaoResult {
  camposCorrigidos: string[];
  dadosDestinoAtualizados: EgestorContatoRaw;
  // Usado pra registrar o eco (EgestorWebhookEchoService, 2026-08-12) —
  // essa escrita dispara o mesmo webhook de uma edição manual no eGestor,
  // confirmado contra a API real.
  estabelecimentoEscrito: Estabelecimento;
  codigoEscrito: string;
}

export interface PersistirCorrecaoResult {
  camposCorrigidos: string[];
  statusFinal: EgestorContatoStatus;
}

export interface AplicarConsolidacaoResult {
  camposConsolidados: string[];
  dadosMatrizAtualizados: EgestorContatoRaw;
  dadosFilialAtualizados: EgestorContatoRaw;
  // Idem AplicarCorrecaoResult — Consolidar sempre escreve nos dois
  // lados; Corrigir com SEFAZ escreve condicionalmente (0, 1 ou os 2).
  codigosEscritos: Array<{ estabelecimento: Estabelecimento; codigo: string }>;
}

// Mapeamento campo do eGestor → chave do CnpjLookupResult (cartão CNPJ —
// ver CompanyService#lookupCnpj: é a Receita Federal via BrasilAPI, não
// SEFAZ de verdade — SEFAZ é estadual e não tem API unificada pra dado
// cadastral, o rótulo "SEFAZ" na tela é o termo que o usuário já usa no
// dia a dia pra "consultar o cadastro oficial do CNPJ"). Só campos de
// CADASTRO formal — nunca `emails`/`fones` (o e-mail/telefone da Receita
// costuma ser do contador, não do contato real da empresa, arriscado
// sobrescrever) nem `tipo`/`indicadorIE`/etc. (não vêm do cartão CNPJ).
const CAMPOS_SEFAZ: Partial<Record<string, keyof CnpjLookupResult>> = {
  nome: 'razaoSocial',
  fantasia: 'fantasia',
  logradouro: 'logradouro',
  numero: 'numero',
  complemento: 'complemento',
  bairro: 'bairro',
  cep: 'cep',
  uf: 'uf',
};

// Cadastro de Company (CRM), como fonte alternativa de correção (pedido
// do usuário, 2026-08-13, no mesmo fio da sanitização em lote via cartão
// CNPJ — ver scripts/sanitizar-cadastros-cnpj.ts): diferente de
// "Corrigir com SEFAZ" (sempre busca a Receita de novo, na hora), aqui a
// fonte é o que já está gravado em `companies` — pode ter sido corrigido
// à mão por alguém, não necessariamente é igual ao cartão CNPJ agora.
//
// Cobre TODO campo do eGestor que tenha equivalente em Company (corrigido
// em 2026-08-14 depois de o usuário apontar 3x a coluna "CRM" em branco na
// tela: a versão anterior só mapeava razão social/fantasia/endereço, então
// `nomeParaContato`, `emails`, `fones`, `cidade` e `inscricaoEstadual`
// apareciam vazios mesmo com dado real no CRM).
// Campo do eGestor sem equivalente nenhum em Company continua fora, e
// nesses a coluna mostra "—" legitimamente: `inscricaoMunicipal`,
// `clienteFinal`, `obs`, `tipo`, `codIBGE`.
export interface CrmContatoFonte {
  razaoSocial: string | null;
  fantasia: string | null;
  nomeParaContato: string | null;
  cpfCnpj: string | null;
  emails: string[];
  fones: string[];
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  uf: string | null;
  cidade: string | null;
  // customFields.inscricao_estadual (preenchimento manual, a Receita não
  // fornece IE — ver updateCustomFieldsAction em web/). Hoje 0 das 1166
  // Company têm isso preenchido; mapeado mesmo assim pra passar a
  // funcionar sozinho quando alguém começar a preencher.
  inscricaoEstadual: string | null;
  // customFields.indicador_ie — enum do eGestor (1 = Contribuinte, 2 =
  // Isento de IE, 9 = Não contribuinte), escolhido à mão no bloco "Dados
  // estaduais" da ficha da empresa. Mapeado em 2026-08-17 depois de o
  // usuário achar a coluna "CRM" em branco justamente na linha em que os 3
  // campos divergentes eram fantasia/indicadorIE/inscricaoEstadual — o
  // campo não existia no CRM, então nem o preview nem "Corrigir com CRM"
  // tinham o que mostrar. `null` (opção "Não informado") = o CRM não opina
  // e o campo fica de fora da correção: decisão do usuário de tratar os
  // cadastros divergentes caso a caso, sem preenchimento em lote.
  indicadorIE: string | null;
}

// Campos que "Corrigir com CRM" pode GRAVAR de volta no eGestor.
// Deliberadamente menor que CAMPOS_CRM_EXIBICAO abaixo:
//   - `cidade` fica de fora — o eGestor deriva do codIBGE e rejeita
//     escrita (CAMPOS_IGNORADOS_NA_COMPARACAO, 422 confirmado).
//   - `cpfcnpj` fica de fora — é a própria chave de consolidação das duas
//     bases, nunca diverge, e reescrever documento é risco desnecessário.
//   - `emails`/`fones` ficam de fora — são LISTA: gravar a do CRM por
//     cima apagaria endereço/telefone que só existe no eGestor (mesmo
//     cuidado da sanitização em lote, scripts/sanitizar-cadastros-cnpj.ts).
//     Pra esses o caminho certo é "Consolidar", que une os dois lados.
const CAMPOS_CRM_ESCRITA: Partial<Record<string, keyof CrmContatoFonte>> = {
  nome: 'razaoSocial',
  fantasia: 'fantasia',
  nomeParaContato: 'nomeParaContato',
  logradouro: 'logradouro',
  numero: 'numero',
  complemento: 'complemento',
  bairro: 'bairro',
  cep: 'cep',
  uf: 'uf',
  inscricaoEstadual: 'inscricaoEstadual',
  indicadorIE: 'indicadorIE',
};

// Campos de CAMPOS_CRM_ESCRITA onde branco no CRM NÃO apaga o valor do
// eGestor — a exceção à regra 1.3 ("campo vazio na origem esvazia o
// destino"). O porquê de cada um está em extrairValoresDoCrm, que é quem
// aplica esta lista.
const CAMPOS_CRM_SEM_APAGAR = new Set([
  'nome',
  'inscricaoEstadual',
  'indicadorIE',
]);

export type EgestorContatoComCrm = EgestorContatoConsolidado & {
  crm: CrmContatoFonte | null;
  // Campos onde o CRM diverge de Matriz e/ou Filial — calculado mesmo
  // quando Matriz e Filial JÁ SÃO IGUAIS entre si (status ambos_iguais,
  // fora de `camposDiferentes`, que só compara Matriz×Filial). Achado do
  // usuário, 2026-08-14: o eGestor pode estar consistente internamente
  // (as duas contas concordam) e ainda assim desatualizado em relação ao
  // CRM — sem isso, essa divergência era invisível (a linha nem tinha
  // link "Corrigir" na tela). Vazio pra so_matriz/so_filial (não há
  // Matriz+Filial pra comparar) e quando não há Company com este CNPJ.
  crmCamposDivergentes: string[];
};

export interface CompletarResult {
  codigoNovo: string;
  dadosNovo: EgestorContatoRaw;
  // Idem AplicarCorrecaoResult — aqui é sempre o código NOVO (criado
  // agora), não um dos códigos já existentes na linha.
  estabelecimentoEscrito: Estabelecimento;
}

export interface PersistirCompletarResult {
  statusFinal: EgestorContatoStatus;
}

// Relatório de auditoria + correção de divergência Matriz×Filial no
// eGestor (docs/roadmap.md, itens 9.3/9.6 — mesmo fluxo/tela). Só lê a
// tabela espelho `EgestorContatoConsolidado` pro relatório; a correção em
// si é a única ação deste módulo que ESCREVE de volta no eGestor (as
// outras, sync/promote, só leem de lá ou só escrevem no CRM).
//
// Dividida em 3 fases de propósito, mesmo racional de
// EgestorContatoSyncService (fetch de rede fora de transação — network
// call não pode segurar conexão do pool ociosa):
// 1. `buscarParaCorrecao` (dentro de tx, curta) — lê e valida o registro.
// 2. `aplicarCorrecaoNoEgestor` (fora de tx) — GET do destino + PUT.
// 3. `persistirCorrecao` (dentro de tx, curta) — grava o resultado local.
@Injectable()
export class EgestorContatoCorrectionService {
  constructor(
    private readonly auth: EgestorAuthService,
    private readonly http: EgestorHttpService,
    private readonly companies: CompanyService,
    private readonly echo: EgestorWebhookEchoService,
  ) {}

  // Enriquece cada linha com o cadastro de Company correspondente (mesmo
  // CNPJ), pra tela de relatório mostrar uma 3ª coluna "CRM" ao lado de
  // Matriz/Filial (pedido do usuário, 2026-08-13). Uma query só pra tudo
  // (buscarDadosCrmEmLote), não 1 por linha — mesmo critério de
  // performance já usado no resto do módulo (fetch tudo de uma vez,
  // volume baixo).
  async listar(
    tx: TenantTx,
    workspaceId: string,
    status?: EgestorContatoStatus,
  ): Promise<EgestorContatoComCrm[]> {
    const rows = await tx.egestorContatoConsolidado.findMany({
      where: { workspaceId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { cpfCnpj: 'asc' }],
    });
    if (rows.length === 0) return [];

    const crmPorCnpj = await this.buscarDadosCrmEmLote(tx, workspaceId);
    return rows.map((row) => {
      const crm = crmPorCnpj.get(row.cpfCnpj) ?? null;
      return {
        ...row,
        crm,
        crmCamposDivergentes: calcularCrmCamposDivergentes(row, crm),
      };
    });
  }

  // Fonte "CRM" pra uma única linha (usado por corrigirContatoCrm) —
  // reaproveita a mesma busca em lote de listar() acima em vez de
  // duplicar o SQL; ~300 linhas no volume atual, custo desprezível mesmo
  // buscando tudo só pra achar 1 CNPJ.
  async buscarDadosCrm(
    tx: TenantTx,
    workspaceId: string,
    cpfCnpj: string,
  ): Promise<CrmContatoFonte | null> {
    const crmPorCnpj = await this.buscarDadosCrmEmLote(tx, workspaceId);
    return crmPorCnpj.get(cpfCnpj) ?? null;
  }

  // Cadastro de cada Company do workspace, indexado pelo CNPJ só-dígitos
  // (mesma normalização de `find_company_id_by_cnpj` — companies.cpf_cnpj
  // pode ter pontuação, egestor_contatos_consolidado.cpf_cnpj nunca tem).
  // Quando 2 Company do mesmo CNPJ existem (duplicidade antiga, rara —
  // ver CompanyService#create/attachToExisting, que hoje reaproveita em
  // vez de duplicar), fica a mais antiga (ORDER BY created_at ASC + só
  // grava no Map na 1ª ocorrência) — mesmo critério do find_company_id_by_cnpj.
  private async buscarDadosCrmEmLote(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<Map<string, CrmContatoFonte>> {
    const linhas = await tx.$queryRaw<
      Array<{
        cnpj_digits: string;
        razao_social: string | null;
        fantasia: string | null;
        nome_para_contato: string | null;
        cpf_cnpj: string | null;
        emails: string[] | null;
        fones: string[] | null;
        logradouro: string | null;
        numero: string | null;
        complemento: string | null;
        bairro: string | null;
        cep: string | null;
        uf: string | null;
        cidade: string | null;
        inscricao_estadual: string | null;
        indicador_ie: string | null;
      }>
    >(Prisma.sql`
      SELECT
        regexp_replace(COALESCE("cpf_cnpj", ''), '\D', '', 'g') AS cnpj_digits,
        "razao_social", "fantasia", "nome_para_contato", "cpf_cnpj",
        "emails", "fones", "logradouro", "numero", "complemento",
        "bairro", "cep", "uf", "cidade",
        "custom_fields"->>'inscricao_estadual' AS inscricao_estadual,
        "custom_fields"->>'indicador_ie' AS indicador_ie
      FROM "companies"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "deleted_at" IS NULL
        AND "cpf_cnpj" IS NOT NULL
      ORDER BY "created_at" ASC
    `);

    const mapa = new Map<string, CrmContatoFonte>();
    for (const linha of linhas) {
      if (!linha.cnpj_digits || mapa.has(linha.cnpj_digits)) continue;
      mapa.set(linha.cnpj_digits, {
        razaoSocial: linha.razao_social,
        fantasia: linha.fantasia,
        nomeParaContato: linha.nome_para_contato,
        cpfCnpj: linha.cpf_cnpj,
        emails: linha.emails ?? [],
        fones: linha.fones ?? [],
        logradouro: linha.logradouro,
        numero: linha.numero,
        complemento: linha.complemento,
        bairro: linha.bairro,
        cep: linha.cep,
        uf: linha.uf,
        cidade: linha.cidade,
        inscricaoEstadual: linha.inscricao_estadual,
        indicadorIE: sanitizarIndicadorIE(linha.indicador_ie),
      });
    }
    return mapa;
  }

  async buscarParaCorrecao(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<EgestorContatoConsolidado> {
    const row = await tx.egestorContatoConsolidado.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundException('Registro não encontrado.');
    if (
      row.status !== EgestorContatoStatus.ambos_diferentes ||
      row.camposDiferentes.length === 0
    ) {
      throw new BadRequestException(
        'Este registro não tem divergência pendente pra corrigir.',
      );
    }
    if (!row.codigoMatriz || !row.codigoFilial) {
      throw new BadRequestException(
        'Faltam os códigos de Matriz e Filial pra corrigir.',
      );
    }
    if (!row.dadosMatriz || !row.dadosFilial) {
      throw new BadRequestException(
        'Faltam os dados de um dos dois lados pra corrigir.',
      );
    }
    return row;
  }

  // Validação equivalente a buscarParaCorrecao() acima, mas pra uma FONTE
  // EXTERNA (SEFAZ/CRM) em vez de Matriz×Filial — usada por
  // corrigirContatoSefaz/corrigirContatoCrm. Diferença chave (achado do
  // usuário, 2026-08-14): não exige `status === ambos_diferentes` nem
  // `camposDiferentes.length > 0` — uma fonte externa pode divergir de
  // Matriz E Filial mesmo quando os dois JÁ SÃO IGUAIS entre si (status
  // ambos_iguais), caso que buscarParaCorrecao() rejeitaria. Ainda exige
  // que os dois lados EXISTAM (com código e dado) — so_matriz/so_filial
  // não tem o que comparar dos dois lados, usa "Completar" em vez disso.
  async buscarParaCorrecaoExterna(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<EgestorContatoConsolidado> {
    const row = await tx.egestorContatoConsolidado.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundException('Registro não encontrado.');
    if (
      row.status === EgestorContatoStatus.so_matriz ||
      row.status === EgestorContatoStatus.so_filial
    ) {
      throw new BadRequestException(
        'Este registro só existe de um lado (Matriz ou Filial) — use "Completar Matriz ⇄ Filial" antes de corrigir com uma fonte externa.',
      );
    }
    if (!row.codigoMatriz || !row.codigoFilial) {
      throw new BadRequestException(
        'Faltam os códigos de Matriz e Filial pra corrigir.',
      );
    }
    if (!row.dadosMatriz || !row.dadosFilial) {
      throw new BadRequestException(
        'Faltam os dados de um dos dois lados pra corrigir.',
      );
    }
    return row;
  }

  // Propagação disparada ao salvar a ficha da empresa (Empresas > Dados
  // cadastrais / Dados fiscais) — decisão do usuário, 2026-08-14: "eu
  // atualizo no CRM e isso deve propagar pro eGestor". Entrada é o
  // `companyId` (não o id do espelho, como nos endpoints da tela
  // Integração eGestor), porque quem chama é a ficha, que só conhece a
  // Company.
  //
  // Devolve um resultado descritivo em vez de lançar: nenhum dos casos
  // "não dá pra propagar" é erro do ponto de vista da ficha — salvar uma
  // empresa que não veio do eGestor é normal, e o save no CRM já
  // aconteceu de qualquer forma. Só o que é de fato erro (falha de rede
  // no PUT) continua propagando exceção.
  async buscarParaPropagacao(
    tx: TenantTx,
    workspaceId: string,
    companyId: string,
  ): Promise<
    | { ok: true; row: EgestorContatoConsolidado; crm: CrmContatoFonte | null }
    | { ok: false; motivo: string }
  > {
    const row = await tx.egestorContatoConsolidado.findFirst({
      where: { companyId, workspaceId },
    });
    if (!row) {
      return { ok: false, motivo: 'Empresa sem vínculo com o eGestor.' };
    }
    if (
      row.status === EgestorContatoStatus.so_matriz ||
      row.status === EgestorContatoStatus.so_filial
    ) {
      return {
        ok: false,
        motivo:
          'Este contato só existe de um lado no eGestor — use "Completar Matriz ⇄ Filial" na tela Integração eGestor.',
      };
    }
    if (
      !row.codigoMatriz ||
      !row.codigoFilial ||
      !row.dadosMatriz ||
      !row.dadosFilial
    ) {
      return {
        ok: false,
        motivo: 'Faltam dados de um dos lados do eGestor pra propagar.',
      };
    }
    const crm = await this.buscarDadosCrm(tx, workspaceId, row.cpfCnpj);
    return { ok: true, row, crm };
  }

  async aplicarCorrecaoNoEgestor(
    // Tipo mais permissivo que `EgestorContatoConsolidado` completo
    // (2026-08-12) — o método só usa esses 5 campos; permite chamar
    // tanto com uma linha real do banco (tela "Corrigir") quanto com uma
    // linha calculada na hora, sem `id`/`status`/etc. (correção
    // automática disparada pelo webhook, ver
    // `EgestorWebhookProcessingService`).
    row: Pick<
      EgestorContatoConsolidado,
      | 'codigoMatriz'
      | 'codigoFilial'
      | 'dadosMatriz'
      | 'dadosFilial'
      | 'camposDiferentes'
    >,
    direcao: CorrecaoDirecao,
    // Subconjunto opcional de `row.camposDiferentes` — default é corrigir
    // TODOS os campos divergentes na direção escolhida (fluxo normal da
    // tela). Existe pra permitir corrigir só uma parte (ex.:
    // scripts/egestor-preencher-gaps.ts, que separa "lacuna" de "conflito
    // real" campo a campo dentro da mesma linha, podendo precisar de até
    // 2 chamadas — uma por direção — pra uma única linha).
    campos: string[] = row.camposDiferentes,
  ): Promise<AplicarCorrecaoResult> {
    const destino: Estabelecimento =
      direcao === 'matriz_para_filial' ? 'filial' : 'matriz';
    const codigoDestino =
      direcao === 'matriz_para_filial' ? row.codigoFilial : row.codigoMatriz;
    const dadosOrigem = (
      direcao === 'matriz_para_filial' ? row.dadosMatriz : row.dadosFilial
    ) as EgestorContatoRaw;
    const dadosDestinoAtual = (
      direcao === 'matriz_para_filial' ? row.dadosFilial : row.dadosMatriz
    ) as EgestorContatoRaw;

    const accessToken = await this.auth.getAccessToken(destino);

    // Busca o registro completo e atual do destino — usado só como fonte
    // dos valores atuais dos campos que a Gama de fato rastreia
    // (CAMPOS_CONTATO), NUNCA reenviado cru de volta (ver comentário no
    // payload abaixo — mudou em 2026-08-11, ver histórico).
    const atual = await this.http.getOne<Record<string, unknown>>(
      accessToken,
      `/v1/contatos/${codigoDestino}`,
    );

    const camposCorrigidos = [...campos];
    const payload = montarPayloadWhitelist(atual);
    for (const campo of camposCorrigidos) {
      payload[campo] = normalizarCampoParaEnvio(campo, dadosOrigem[campo]);
    }

    await this.http.put(accessToken, `/v1/contatos/${codigoDestino}`, payload);

    const dadosDestinoAtualizados: EgestorContatoRaw = {
      ...dadosDestinoAtual,
      ...Object.fromEntries(
        camposCorrigidos.map((campo) => [
          campo,
          normalizarCampoParaEnvio(campo, dadosOrigem[campo]),
        ]),
      ),
    };

    return {
      camposCorrigidos,
      dadosDestinoAtualizados,
      estabelecimentoEscrito: destino,
      codigoEscrito: String(codigoDestino),
    };
  }

  // "Consolidar" (pedido do usuário, 2026-08-11) — alternativa ao
  // "Corrigir" pros campos de LISTA divergentes (CAMPOS_ARRAY: emails,
  // fones, tags, tipo). Em vez de escolher um lado pra sobrescrever o
  // outro, UNE os dois: ex. Matriz com 1 e-mail e Filial com outro vira
  // os dois e-mails nos dois lados, não um ganhando do outro. Só entram
  // os campos divergentes que são de lista — campo escalar (nome, uf...)
  // que também esteja divergente na mesma linha fica de fora e continua
  // divergente (mesmo racional parcial de scripts/egestor-preencher-
  // gaps.ts: aplica o que dá pra aplicar com segurança, deixa o resto pro
  // "Corrigir" manual). Grava nos DOIS lados (2 PUT, um por conta) —
  // diferente de aplicarCorrecaoNoEgestor, que só grava no destino.
  async aplicarConsolidacaoNoEgestor(
    row: EgestorContatoConsolidado,
  ): Promise<AplicarConsolidacaoResult> {
    const camposConsolidaveis = row.camposDiferentes.filter((campo) =>
      CAMPOS_ARRAY.has(campo),
    );
    if (camposConsolidaveis.length === 0) {
      throw new BadRequestException(
        'Nenhum campo divergente deste registro pode ser consolidado — só campos de lista (e-mails, telefones, tags, tipo). Use "Corrigir" pros demais.',
      );
    }

    const dadosMatrizOrigem = row.dadosMatriz as EgestorContatoRaw;
    const dadosFilialOrigem = row.dadosFilial as EgestorContatoRaw;

    const mesclados: Record<string, string[]> = {};
    for (const campo of camposConsolidaveis) {
      mesclados[campo] = mesclarCampoArray(
        campo,
        dadosMatrizOrigem[campo],
        dadosFilialOrigem[campo],
      );
    }

    const [tokenMatriz, tokenFilial] = await Promise.all([
      this.auth.getAccessToken('matriz'),
      this.auth.getAccessToken('filial'),
    ]);

    const atualMatriz = await this.http.getOne<Record<string, unknown>>(
      tokenMatriz,
      `/v1/contatos/${row.codigoMatriz}`,
    );
    const payloadMatriz = montarPayloadWhitelist(atualMatriz);
    for (const campo of camposConsolidaveis)
      payloadMatriz[campo] = mesclados[campo];
    await this.http.put(
      tokenMatriz,
      `/v1/contatos/${row.codigoMatriz}`,
      payloadMatriz,
    );

    const atualFilial = await this.http.getOne<Record<string, unknown>>(
      tokenFilial,
      `/v1/contatos/${row.codigoFilial}`,
    );
    const payloadFilial = montarPayloadWhitelist(atualFilial);
    for (const campo of camposConsolidaveis)
      payloadFilial[campo] = mesclados[campo];
    await this.http.put(
      tokenFilial,
      `/v1/contatos/${row.codigoFilial}`,
      payloadFilial,
    );

    return {
      camposConsolidados: camposConsolidaveis,
      dadosMatrizAtualizados: { ...dadosMatrizOrigem, ...mesclados },
      dadosFilialAtualizados: { ...dadosFilialOrigem, ...mesclados },
      codigosEscritos: [
        { estabelecimento: 'matriz', codigo: String(row.codigoMatriz) },
        { estabelecimento: 'filial', codigo: String(row.codigoFilial) },
      ],
    };
  }

  // "Corrigir com SEFAZ" (pedido do usuário, 2026-08-11) — usa o cartão
  // CNPJ (Receita Federal, ver CompanyService#lookupCnpj e comentário de
  // CAMPOS_SEFAZ acima) como fonte, em vez de escolher Matriz ou Filial.
  // Busca a Receita de novo aqui no backend (nunca confia em dado de
  // Receita mandado pelo client — o botão "Consultar SEFAZ" da tela é só
  // pré-visualização) e decide, campo a campo, qual(is) lado(s)
  // precisa(m) de PUT: como nem Matriz nem Filial são presumidos
  // corretos aqui (diferente de aplicarCorrecaoNoEgestor), pode ter que
  // corrigir só um lado, os dois, ou nenhum — se o cadastro na Receita
  // não trouxer valor útil (campo vazio) ou os dois lados já baterem com
  // ela, aquele campo fica de fora. Só entram campos cobertos pelo cartão
  // CNPJ (CAMPOS_SEFAZ) — o resto que estiver divergente na mesma linha
  // continua precisando de "Corrigir"/"Consolidar" manual.
  //
  // Compara TODO campo de CAMPOS_SEFAZ, não só os que estão em
  // `row.camposDiferentes` (mudou em 2026-08-14, achado do usuário —
  // mesmo motivo de buscarParaCorrecaoExterna acima): Matriz e Filial
  // podem concordar entre si num campo e MESMO ASSIM os dois estarem
  // errados em relação à Receita — `camposDiferentes` só sabe comparar
  // Matriz×Filial, nunca detectaria isso sozinho. Resultado no mesmo
  // formato de aplicarConsolidacaoNoEgestor (persiste com o mesmo
  // persistirConsolidacao abaixo — a semântica de "campos tratados nesta
  // operação, que já podem sair de camposDiferentes" é idêntica).
  async aplicarCorrecaoSefazNoEgestor(
    row: EgestorContatoConsolidado,
  ): Promise<AplicarConsolidacaoResult> {
    const sefaz = await this.companies.lookupCnpj(row.cpfCnpj);
    const valoresSefaz = extrairValoresDeFonte(CAMPOS_SEFAZ, sefaz);
    return this.aplicarValoresDeFonteNoEgestor(
      row,
      valoresSefaz,
      'A consulta ao cartão CNPJ (Receita Federal) não trouxe valor útil pra nenhum campo desta linha — campo vazio na consulta, campo não coberto pelo cartão CNPJ, ou os dois lados já batem com a Receita.',
    );
  }

  // "Corrigir com CRM" (pedido do usuário, 2026-08-13, na esteira da
  // sanitização em lote via cartão CNPJ — ver
  // scripts/sanitizar-cadastros-cnpj.ts) — mesmo mecanismo de "Corrigir
  // com SEFAZ" acima, mas a fonte é o cadastro já gravado em `companies`
  // (CrmContatoFonte/CAMPOS_CRM_ESCRITA) em vez de consultar a Receita.
  // `crm` vem de fora (buscarDadosCrm, dentro de uma tx — este método é a
  // fase de rede, sem tx) — se vier `null` (nenhuma Company com este
  // CNPJ), sobra um Record vazio e cai direto na mensagem de erro abaixo.
  // Mesma generalização de 2026-08-14 de aplicarCorrecaoSefazNoEgestor:
  // compara TODO campo de CAMPOS_CRM_ESCRITA, não só os de `camposDiferentes`
  // — é exatamente isso que permite corrigir os dois lados quando Matriz
  // e Filial concordam entre si mas divergem do CRM (status ambos_iguais,
  // entrada pela crmCamposDivergentes calculada em listar()).
  async aplicarCorrecaoCrmNoEgestor(
    row: EgestorContatoConsolidado,
    crm: CrmContatoFonte | null,
  ): Promise<AplicarConsolidacaoResult> {
    const valoresCrm = crm ? extrairValoresDoCrm(crm) : {};
    return this.aplicarValoresDeFonteNoEgestor(
      row,
      valoresCrm,
      'O cadastro desta empresa no CRM não tem nada a corrigir nesta linha — empresa não cadastrada no CRM, campo não coberto por este cadastro, ou os dois lados já batem com o CRM.',
    );
  }

  // Núcleo compartilhado por "Corrigir com SEFAZ" e "Corrigir com CRM" —
  // dado um conjunto de valores já resolvido de uma fonte externa a
  // Matriz/Filial (`valoresFonte`, campo → valor), decide campo a campo
  // qual(is) lado(s) precisa(m) de PUT (pode ser um lado só, os dois, ou
  // nenhum) e grava. Extraído em 2026-08-13 pra "Corrigir com CRM" não
  // duplicar essa lógica — comportamento idêntico ao que
  // aplicarCorrecaoSefazNoEgestor sempre teve.
  private async aplicarValoresDeFonteNoEgestor(
    row: EgestorContatoConsolidado,
    valoresFonte: Record<string, string>,
    mensagemSemValorUtil: string,
  ): Promise<AplicarConsolidacaoResult> {
    const dadosMatrizOrigem = row.dadosMatriz as EgestorContatoRaw;
    const dadosFilialOrigem = row.dadosFilial as EgestorContatoRaw;

    const camposParaMatriz = Object.keys(valoresFonte).filter(
      (campo) =>
        normalizarParaComparacao(dadosMatrizOrigem[campo]) !==
        normalizarParaComparacao(valoresFonte[campo]),
    );
    const camposParaFilial = Object.keys(valoresFonte).filter(
      (campo) =>
        normalizarParaComparacao(dadosFilialOrigem[campo]) !==
        normalizarParaComparacao(valoresFonte[campo]),
    );

    if (camposParaMatriz.length === 0 && camposParaFilial.length === 0) {
      throw new BadRequestException(mensagemSemValorUtil);
    }

    let dadosMatrizAtualizados = dadosMatrizOrigem;
    if (camposParaMatriz.length > 0) {
      const tokenMatriz = await this.auth.getAccessToken('matriz');
      const atualMatriz = await this.http.getOne<Record<string, unknown>>(
        tokenMatriz,
        `/v1/contatos/${row.codigoMatriz}`,
      );
      const payloadMatriz = montarPayloadWhitelist(atualMatriz);
      for (const campo of camposParaMatriz) {
        payloadMatriz[campo] = normalizarCampoParaEnvio(
          campo,
          valoresFonte[campo],
        );
      }
      await this.http.put(
        tokenMatriz,
        `/v1/contatos/${row.codigoMatriz}`,
        payloadMatriz,
      );
      dadosMatrizAtualizados = {
        ...dadosMatrizOrigem,
        ...Object.fromEntries(
          camposParaMatriz.map((campo) => [campo, valoresFonte[campo]]),
        ),
      };
    }

    let dadosFilialAtualizados = dadosFilialOrigem;
    if (camposParaFilial.length > 0) {
      const tokenFilial = await this.auth.getAccessToken('filial');
      const atualFilial = await this.http.getOne<Record<string, unknown>>(
        tokenFilial,
        `/v1/contatos/${row.codigoFilial}`,
      );
      const payloadFilial = montarPayloadWhitelist(atualFilial);
      for (const campo of camposParaFilial) {
        payloadFilial[campo] = normalizarCampoParaEnvio(
          campo,
          valoresFonte[campo],
        );
      }
      await this.http.put(
        tokenFilial,
        `/v1/contatos/${row.codigoFilial}`,
        payloadFilial,
      );
      dadosFilialAtualizados = {
        ...dadosFilialOrigem,
        ...Object.fromEntries(
          camposParaFilial.map((campo) => [campo, valoresFonte[campo]]),
        ),
      };
    }

    // Um campo pode ter precisado de PUT só num lado (o outro já batia
    // com a fonte) ou nos dois — de qualquer forma, depois desta operação
    // os dois lados ficam iguais à fonte, então sai de camposDiferentes.
    const camposConsolidados = Array.from(
      new Set([...camposParaMatriz, ...camposParaFilial]),
    );

    const codigosEscritos: Array<{
      estabelecimento: Estabelecimento;
      codigo: string;
    }> = [];
    if (camposParaMatriz.length > 0) {
      codigosEscritos.push({
        estabelecimento: 'matriz',
        codigo: String(row.codigoMatriz),
      });
    }
    if (camposParaFilial.length > 0) {
      codigosEscritos.push({
        estabelecimento: 'filial',
        codigo: String(row.codigoFilial),
      });
    }

    return {
      camposConsolidados,
      dadosMatrizAtualizados,
      dadosFilialAtualizados,
      codigosEscritos,
    };
  }

  // Marca as escritas que ACABARAM de sair daqui pro eGestor, pra o
  // webhook disparado por elas não ser reprocessado como se fosse edição
  // humana (EgestorWebhookEchoService).
  //
  // Mora DENTRO dos `persistir*` de propósito (mudou em 2026-08-14): antes
  // cada chamador registrava o eco por conta própria, o que já eram 7
  // pontos espalhados — todos corretos, mas nada obrigava o oitavo a
  // lembrar. Um caminho de escrita sem eco faz o CRM tratar a própria
  // escrita como mudança externa e reescrever de volta; se o eGestor
  // normalizar o valor ao gravar (formatação de inscrição estadual, por
  // exemplo), os dois passam a se reescrever até estourar o rate limit da
  // API. Persistir é obrigatório em todo caminho de escrita, então
  // ancorar o eco aqui é o que torna "esquecer" impossível.
  private async registrarEco(
    tx: TenantTx,
    workspaceId: string,
    codigos: Array<{ estabelecimento: Estabelecimento; codigo: string }>,
  ): Promise<void> {
    await this.echo.registrar(tx, workspaceId, codigos);
  }

  async persistirConsolidacao(
    tx: TenantTx,
    id: string,
    row: EgestorContatoConsolidado,
    resultado: AplicarConsolidacaoResult,
  ): Promise<PersistirCorrecaoResult> {
    await this.registrarEco(tx, row.workspaceId, resultado.codigosEscritos);

    const camposDiferentesRestantes = row.camposDiferentes.filter(
      (campo) => !resultado.camposConsolidados.includes(campo),
    );
    const status =
      camposDiferentesRestantes.length === 0
        ? EgestorContatoStatus.ambos_iguais
        : EgestorContatoStatus.ambos_diferentes;

    // `nomeMatriz`/`nomeFilial` são colunas DENORMALIZADAS — é o que a
    // lista da tela "Integração eGestor" exibe (a tela nunca lê
    // dadosMatriz.nome). Sem atualizar aqui, uma correção que muda o
    // `nome` grava certo no eGestor e no JSON mas a lista continua
    // mostrando o nome ANTIGO pra sempre — bug relatado pelo usuário em
    // 2026-08-14 ("na Matriz não ajustou o nome e ajustou só na Filial":
    // o eGestor Matriz TINHA sido corrigido, só a coluna ficou velha).
    // `persistirCorrecao`/`persistirCompletar` já faziam isso; só este
    // caminho (Consolidar/Corrigir com SEFAZ/Corrigir com CRM) não fazia.
    const nomeMatrizAtualizado = resultado.dadosMatrizAtualizados.nome
      ? String(resultado.dadosMatrizAtualizados.nome)
      : undefined;
    const nomeFilialAtualizado = resultado.dadosFilialAtualizados.nome
      ? String(resultado.dadosFilialAtualizados.nome)
      : undefined;

    await tx.egestorContatoConsolidado.update({
      where: { id },
      data: {
        status,
        camposDiferentes: camposDiferentesRestantes,
        dadosMatriz:
          resultado.dadosMatrizAtualizados as unknown as Prisma.InputJsonValue,
        dadosFilial:
          resultado.dadosFilialAtualizados as unknown as Prisma.InputJsonValue,
        ...(nomeMatrizAtualizado ? { nomeMatriz: nomeMatrizAtualizado } : {}),
        ...(nomeFilialAtualizado ? { nomeFilial: nomeFilialAtualizado } : {}),
      },
    });

    return {
      camposCorrigidos: resultado.camposConsolidados,
      statusFinal: status,
    };
  }

  // Fluxo "Completar Matriz ⇄ Filial" (docs/roadmap.md, item 9.9) — pro
  // caso so_matriz/so_filial: o CNPJ não existe do outro lado, então não
  // tem campo pra corrigir, tem que CRIAR o contato lá. Diferente de
  // `aplicarCorrecaoNoEgestor` (PUT), aqui não precisa buscar o registro
  // atual do destino antes (não existe ainda) — é só `POST` com os dados
  // do lado que já existe.
  async buscarParaCompletar(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<EgestorContatoConsolidado> {
    const row = await tx.egestorContatoConsolidado.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundException('Registro não encontrado.');
    if (
      row.status !== EgestorContatoStatus.so_matriz &&
      row.status !== EgestorContatoStatus.so_filial
    ) {
      throw new BadRequestException(
        'Este registro já existe nos dois lados — use "Corrigir" em vez de "Completar".',
      );
    }
    const dadosOrigem =
      row.status === EgestorContatoStatus.so_matriz
        ? row.dadosMatriz
        : row.dadosFilial;
    if (!dadosOrigem) {
      throw new BadRequestException(
        'Sem dado de origem pra completar o outro lado.',
      );
    }
    return row;
  }

  async completarNoEgestor(
    // Tipo mais permissivo que `EgestorContatoConsolidado` completo
    // (2026-08-13, mesmo racional de `aplicarCorrecaoNoEgestor` acima) —
    // permite chamar tanto com uma linha real do banco (tela "Completar
    // Matriz ⇄ Filial") quanto com uma linha calculada na hora (completar
    // automático disparado pelo webhook, ver
    // EgestorWebhookProcessingService).
    row: Pick<
      EgestorContatoConsolidado,
      'status' | 'dadosMatriz' | 'dadosFilial'
    >,
  ): Promise<CompletarResult> {
    const origemEhMatriz = row.status === EgestorContatoStatus.so_matriz;
    const destino: Estabelecimento = origemEhMatriz ? 'filial' : 'matriz';
    const dadosOrigem = (
      origemEhMatriz ? row.dadosMatriz : row.dadosFilial
    ) as EgestorContatoRaw;

    const accessToken = await this.auth.getAccessToken(destino);

    const payload: Record<string, unknown> = {};
    for (const campo of CAMPOS_CONTATO) {
      if (CAMPOS_IGNORADOS_NA_COMPARACAO.has(campo)) continue;
      const valor = dadosOrigem[campo];
      if (valor === undefined || valor === null || valor === '') continue;
      payload[campo] = normalizarCampoParaEnvio(campo, valor);
    }
    payload.indicadorIE = normalizarIndicadorIE(payload.indicadorIE);

    // Response minimalista (só codigo/nome, ver docs/api-egestor-
    // contatos.md) — o resto do registro novo é o próprio payload que
    // mandamos, não precisa de GET extra pra confirmar.
    const criado = await this.http.post<{
      codigo: number | string;
      nome?: string;
    }>(accessToken, '/v1/contatos', payload);

    const dadosNovo: EgestorContatoRaw = {
      ...payload,
      codigo: criado.codigo,
      nome: criado.nome ?? payload.nome,
    } as EgestorContatoRaw;

    return {
      codigoNovo: String(criado.codigo),
      dadosNovo,
      estabelecimentoEscrito: destino,
    };
  }

  async persistirCompletar(
    tx: TenantTx,
    id: string,
    row: EgestorContatoConsolidado,
    resultado: CompletarResult,
  ): Promise<PersistirCompletarResult> {
    await this.registrarEco(tx, row.workspaceId, [
      {
        estabelecimento: resultado.estabelecimentoEscrito,
        // Código NOVO (criado agora), não um dos já existentes na linha.
        codigo: resultado.codigoNovo,
      },
    ]);

    const origemEhMatriz = row.status === EgestorContatoStatus.so_matriz;
    const nomeNovo = resultado.dadosNovo.nome
      ? String(resultado.dadosNovo.nome)
      : undefined;

    await tx.egestorContatoConsolidado.update({
      where: { id },
      data: {
        status: EgestorContatoStatus.ambos_iguais,
        camposDiferentes: [],
        ...(origemEhMatriz
          ? {
              codigoFilial: resultado.codigoNovo,
              dadosFilial:
                resultado.dadosNovo as unknown as Prisma.InputJsonValue,
              ...(nomeNovo ? { nomeFilial: nomeNovo } : {}),
            }
          : {
              codigoMatriz: resultado.codigoNovo,
              dadosMatriz:
                resultado.dadosNovo as unknown as Prisma.InputJsonValue,
              ...(nomeNovo ? { nomeMatriz: nomeNovo } : {}),
            }),
      },
    });

    return { statusFinal: EgestorContatoStatus.ambos_iguais };
  }

  async persistirCorrecao(
    tx: TenantTx,
    id: string,
    workspaceId: string,
    direcao: CorrecaoDirecao,
    resultado: AplicarCorrecaoResult,
  ): Promise<PersistirCorrecaoResult> {
    await this.registrarEco(tx, workspaceId, [
      {
        estabelecimento: resultado.estabelecimentoEscrito,
        codigo: resultado.codigoEscrito,
      },
    ]);

    const nomeAtualizado = resultado.dadosDestinoAtualizados.nome
      ? String(resultado.dadosDestinoAtualizados.nome)
      : undefined;
    const ladoAtualizadoEhFilial = direcao === 'matriz_para_filial';

    await tx.egestorContatoConsolidado.update({
      where: { id },
      data: {
        status: EgestorContatoStatus.ambos_iguais,
        camposDiferentes: [],
        ...(ladoAtualizadoEhFilial
          ? {
              dadosFilial:
                resultado.dadosDestinoAtualizados as unknown as Prisma.InputJsonValue,
              ...(nomeAtualizado ? { nomeFilial: nomeAtualizado } : {}),
            }
          : {
              dadosMatriz:
                resultado.dadosDestinoAtualizados as unknown as Prisma.InputJsonValue,
              ...(nomeAtualizado ? { nomeMatriz: nomeAtualizado } : {}),
            }),
      },
    });

    return {
      camposCorrigidos: resultado.camposCorrigidos,
      statusFinal: EgestorContatoStatus.ambos_iguais,
    };
  }
}

// Resolve, campo a campo (todo campo coberto por `mapa`), o valor de uma
// fonte externa a Matriz/Filial (Receita/CnpjLookupResult — ver
// CAMPOS_SEFAZ) — usado por aplicarCorrecaoSefazNoEgestor. Campo com valor
// vazio/não-string na fonte fica de fora: consulta à Receita que volta sem
// um campo significa "a Receita não respondeu isso", nunca "apague o que
// está no eGestor". O CRM como fonte é o caso oposto e tem função própria
// (extrairValoresDoCrm). Não filtra mais por `row.camposDiferentes` (mudou
// em 2026-08-14) — ver comentário nos 2 call sites acima sobre por quê.
function extrairValoresDeFonte<T>(
  mapa: Partial<Record<string, keyof T>>,
  fonte: T,
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const campo of Object.keys(mapa)) {
    const chave = mapa[campo];
    if (!chave) continue;
    const bruto = fonte[chave];
    const valor = typeof bruto === 'string' ? bruto.trim() : undefined;
    if (!valor) continue;
    valores[campo] = valor;
  }
  return valores;
}

// Idem, com o CRM (Company) como fonte — separado de extrairValoresDeFonte
// justamente pelo tratamento do vazio. Regra 1.3 de
// docs/regras-de-negocio.md (decisão do usuário, 2026-08-14, implementada
// em 2026-08-20): escolhida a direção, os dois lados ficam iguais
// **inclusive quando isso significa apagar** — campo em branco na ficha da
// empresa passa a limpar o campo correspondente no eGestor, em vez de ser
// ignorado como era até aqui (o valor antigo do ERP sobrevivia a um campo
// apagado no CRM, e a divergência nem aparecia na tela).
//
// CAMPOS_CRM_SEM_APAGAR são a exceção — ali o branco continua significando
// "o CRM não sabe", e o campo fica fora da correção:
//   - `inscricaoEstadual`/`indicadorIE`: regra 4.1 do mesmo documento — o
//     CRM recebe campo fiscal do eGestor e guarda, mas nunca serve de
//     origem para um campo fiscal que ele não tem.
//   - `nome` (razão social): é a identidade do registro no ERP; contato
//     sem nome não é cadastro válido lá. Empresa sem razão social no CRM é
//     cadastro incompleto, não instrução pra apagar o nome no eGestor.
// `emails`/`fones` nem chegam aqui — são lista e ficam de fora de
// CAMPOS_CRM_ESCRITA (o caminho deles é "Consolidar").
function extrairValoresDoCrm(crm: CrmContatoFonte): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const campo of Object.keys(CAMPOS_CRM_ESCRITA)) {
    const chave = CAMPOS_CRM_ESCRITA[campo];
    if (!chave) continue;
    const bruto = crm[chave];
    const valor = typeof bruto === 'string' ? bruto.trim() : '';
    if (!valor && CAMPOS_CRM_SEM_APAGAR.has(campo)) continue;
    valores[campo] = valor;
  }
  return valores;
}

// Campos onde o CRM (Company) diverge de Matriz e/ou Filial — usado por
// listar() pra montar `crmCamposDivergentes` de cada linha do relatório
// (pedido do usuário, 2026-08-14: detectar mesmo quando Matriz e Filial
// JÁ SÃO IGUAIS entre si, caso que `camposDiferentes` sozinho não cobre).
// Função pura (sem chamada de rede/banco) só pra ficar testável sem mock
// de tx — `listar()` é quem já tem `row`/`crm` em mãos e chama isto.
// so_matriz/so_filial (falta um dos dois lados) sempre volta `[]` — essas
// linhas usam "Completar", não "Corrigir com CRM".
export function calcularCrmCamposDivergentes(
  row: Pick<
    EgestorContatoConsolidado,
    'status' | 'dadosMatriz' | 'dadosFilial'
  >,
  crm: CrmContatoFonte | null,
): string[] {
  if (
    !crm ||
    row.status === EgestorContatoStatus.so_matriz ||
    row.status === EgestorContatoStatus.so_filial ||
    !row.dadosMatriz ||
    !row.dadosFilial
  ) {
    return [];
  }

  const dadosMatriz = row.dadosMatriz as EgestorContatoRaw;
  const dadosFilial = row.dadosFilial as EgestorContatoRaw;
  const valoresCrm = extrairValoresDoCrm(crm);

  return Object.keys(valoresCrm).filter(
    (campo) =>
      normalizarParaComparacao(dadosMatriz[campo]) !==
        normalizarParaComparacao(valoresCrm[campo]) ||
      normalizarParaComparacao(dadosFilial[campo]) !==
        normalizarParaComparacao(valoresCrm[campo]),
  );
}

// Monta o corpo de um PUT só com o whitelist de CAMPOS_CONTATO (menos
// CAMPOS_IGNORADOS_NA_COMPARACAO: codigo/dtCad/cidade), a partir do
// registro atual e completo do destino — nunca espalha `atual` inteiro
// (`{...atual}`) direto no payload. Tentativa original fazia isso e
// espelhava de volta CADA campo que o GET devolve, inclusive o bloco
// inteiro "Entrega" (cidadeEntrega, cepEntrega, etc.), `suframa`,
// `inscricaoEstadualST`, `pais`... nenhum desses documentado nem usado em
// lugar nenhum do módulo. Confirmado contra a API real em 2026-08-11,
// dois campos rejeitados como somente-leitura ao serem reenviados:
// `dtCad` (1ª tentativa) e depois `cidadeEntrega` (2ª, mesma família
// "Entrega") — ambos 422, nada é gravado quando isso acontece (a API
// rejeita o corpo inteiro antes de persistir, não é patch parcial que
// aplica o resto). Restringe ao mesmo grupo de campos que o resto do
// módulo já rastreia/entende (mesmo grupo usado em completarNoEgestor),
// que bate com o exemplo de `PUT` da doc oficial
// (docs/api-egestor-contatos.md) — nenhum campo do bloco Entrega/
// suframa/inscricaoEstadualST/pais aparece lá. Compartilhado entre
// aplicarCorrecaoNoEgestor e aplicarConsolidacaoNoEgestor.
function montarPayloadWhitelist(
  atual: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const campo of CAMPOS_CONTATO) {
    if (CAMPOS_IGNORADOS_NA_COMPARACAO.has(campo)) continue;
    if (!(campo in atual)) continue;
    payload[campo] = normalizarCampoParaEnvio(campo, atual[campo]);
  }
  return payload;
}

// Une os valores dos dois lados de um campo-lista (emails/fones/tags/
// tipo) num array só, sem duplicata — normaliza cada lado pro formato de
// escrita primeiro (ex.: emails/fones do GET vêm como array de objeto,
// não de string, ver normalizarCampoParaEnvio) antes de mesclar.
// Dedupe case-insensitive (mais seguro pra e-mail — "Fulano@x.com" e
// "fulano@x.com" são o mesmo endereço na prática).
function mesclarCampoArray(
  campo: string,
  valorA: unknown,
  valorB: unknown,
): string[] {
  const arrA = normalizarCampoParaEnvio(campo, valorA);
  const arrB = normalizarCampoParaEnvio(campo, valorB);
  const combinados = [
    ...(Array.isArray(arrA) ? arrA : []),
    ...(Array.isArray(arrB) ? arrB : []),
  ];

  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const item of combinados) {
    const texto = String(item).trim();
    if (!texto) continue;
    const chave = texto.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(texto);
  }
  return resultado;
}

// Compara valor atual do eGestor (Matriz ou Filial) contra o valor da
// Receita Federal pra decidir se aquele lado precisa de PUT — trim +
// caixa alta + colapsa espaço duplo, pra não disparar correção por causa
// de diferença cosmética (espaço a mais, minúscula/maiúscula) entre o
// que está no eGestor e o texto oficial da Receita.
function normalizarParaComparacao(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

// Regra registrada em docs/api-egestor-contatos.md ("Perguntas em aberto"
// #6, script de referência da Gama): a API não documenta `0` como valor
// válido do enum indicadorIE (só 1/2/9) — nunca gravar 0.
//
// Coage string numérica pra número (2026-08-17): a doc manda `indicadorIE`
// como enum NUMÉRICO no corpo do POST/PUT (`"indicadorIE": 1`), e agora o
// campo também pode chegar do CRM (sanitizarIndicadorIE, que devolve string
// como todas as fontes externas) ou do espelho, onde o GET às vezes trouxe
// o valor como texto. Sem isso, mandaríamos `"1"` onde a API espera `1`.
function normalizarIndicadorIE(valor: unknown): unknown {
  if (valor === 0 || valor === '0') return 9;
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    return Number(valor.trim());
  }
  return valor;
}

// `customFields.indicador_ie` da ficha da empresa (select "Indicador de
// IE" no bloco "Dados estaduais", ver updateCustomFieldsAction em web/).
// Enum da doc oficial (docs/api-egestor-contatos.md): 1 = Contribuinte,
// 2 = Isento de IE, 9 = Não contribuinte.
//
// Só passa 1/2/9. `customFields` é jsonb livre — qualquer outro valor
// (lixo antigo, digitação por API, o `0` que a doc registra como inválido)
// vira `null`, ou seja, o CRM não opina e o campo fica de fora da
// correção. É o mesmo efeito da opção "Não informado" do select, e é
// deliberado: nunca deduzir um indicador que ninguém escolheu, porque
// isso sobrescreveria em massa um valor correto no ERP de produção.
function sanitizarIndicadorIE(valor: string | null): string | null {
  const texto = valor?.trim() ?? '';
  return texto === '1' || texto === '2' || texto === '9' ? texto : null;
}

// Normalização por campo antes de mandar de volta pro eGestor (PUT de
// correção ou POST de completar) — o valor cru salvo no espelho
// (`dadosMatriz`/`dadosFilial`) reflete o formato do GET, que nem sempre
// bate com o formato esperado de escrita (ver docs/api-egestor-
// contatos.md, "Formato real de emails/fones" e "Perguntas em aberto"
// #6).
function normalizarCampoParaEnvio(campo: string, valor: unknown): unknown {
  if (campo === 'emails')
    return extrairContatoArray(valor, ['email', 'valor', 'endereco']);
  if (campo === 'fones')
    return extrairContatoArray(valor, ['fone', 'telefone', 'numero', 'valor']);
  if (campo === 'indicadorIE') return normalizarIndicadorIE(valor);
  return valor;
}
