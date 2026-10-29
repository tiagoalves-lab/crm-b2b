import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseUserService } from '../memberships/supabase-user.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type {
  AlertaRemessaDto,
  ClasseEntrada,
  ClassificarEntradaDto,
  EntradasQueryDto,
  RelatorioReceitaQueryDto,
  RemessasQueryDto,
  VinculoRemessaDto,
} from './dto/fiscal-query.dto';

// Leitura do console fiscal (docs/console-fiscal.md, seção 7): relatório
// de notas emitidas (base do PIS/COFINS) e controle de remessas.

export interface LinhaReceita {
  id: string;
  estabelecimento: string;
  tipo: 'produto' | 'servico';
  numero: number | null;
  destinatario: string | null;
  dataEmissao: string;
  situacao: string;
  // Natureza da operação da NF-e; NFS-e não tem, vai OPERACAO_SERVICO.
  operacao: string | null;
  total: string | null;
  vIcms: string | null;
  vIpi: string | null;
  // Só NFS-e.
  vIss: string | null;
  vPis: string | null;
  vCofins: string | null;
  // NF-e com item de CFOP de receita e item de outro CFOP: o total da
  // nota passa da receita, precisa de conferência à mão.
  cfopMisto: boolean;
}

export interface TotalReceita {
  // null = total geral (produto + serviço)
  tipo: 'produto' | 'servico' | null;
  notas: number;
  total: string;
  // null = o imposto não se aplica a nenhuma nota somada (ex.: ISS só de
  // produto).
  vIcms: string | null;
  vIpi: string | null;
  vIss: string | null;
  vPis: string;
  vCofins: string;
}

// Teto de linhas do relatório — um ano inteiro tem ~1.000 notas. Os
// totais são somados no banco e valem para o período inteiro mesmo quando
// a lista é cortada.
const RELATORIO_MAX_LINHAS = 5000;

export interface RetornoDaRemessa {
  chave: string;
  numero: number | null;
  dataEmissao: string;
  cfops: string[];
  // Itens do CFOP de retorno, na ordem da nota ("2 × PRODUTO").
  itens: string[];
  valor: string;
  // nota = o próprio retorno cita a remessa no XML (refNFe); manual =
  // alguém ligou no Controle de remessas (fiscal_remessa_vinculo).
  origem: 'nota' | 'manual';
  // false = entrou pela descrição, o CFOP não é de retorno (decisão 7.6).
  cfopConfere: boolean;
  // CNPJ/CPF de quem está do outro lado da nota.
  documento: string | null;
}

export interface LinhaRemessa {
  id: string;
  chave: string;
  // enviada = a Gama mandou e tem que voltar; recebida = terceiro mandou
  // pra Gama e a Gama tem que devolver.
  lado: 'enviada' | 'recebida';
  estabelecimento: string;
  numero: number | null;
  dataEmissao: string;
  contraparte: string | null;
  documento: string | null;
  // false = entrou pela descrição, o CFOP não é de remessa (decisão 7.6).
  cfopConfere: boolean;
  // Nota da Gama com CFOP que conta como receita (PIS/COFINS).
  receita: boolean;
  cfops: string[];
  natureza: string | null;
  // Itens do CFOP que exige retorno, na ordem da nota ("2 × PRODUTO").
  itens: string[];
  // Soma dos itens com CFOP que exige retorno.
  valor: string;
  valorRetornado: string;
  retorno: 'retornada' | 'parcial' | 'aberta';
  diasEmAberto: number | null;
  retornos: RetornoDaRemessa[];
}

export interface ResumoRemessas {
  lado: 'enviada' | 'recebida';
  retorno: LinhaRemessa['retorno'];
  remessas: number;
  valor: string;
}

// Nota de retorno pra arrastar até a remessa (coluna da direita da tela).
export interface RetornoDisponivel {
  chave: string;
  // Que lado de remessa ela fecha (ver o CTE `ret`).
  fecha: 'enviada' | 'recebida';
  estabelecimento: string;
  numero: number | null;
  dataEmissao: string;
  contraparte: string | null;
  documento: string | null;
  cfopConfere: boolean;
  cfops: string[];
  itens: string[];
  // Soma dos itens com CFOP de retorno.
  valor: string;
  // Quantas remessas ela já fecha — um retorno pode cobrir várias.
  vinculos: number;
}

// Registro do log de alertas do Controle de remessas (decisão 7.7).
export interface RegistroAlerta {
  remessaChave: string;
  regra: string;
  acao: 'tratar' | 'reabrir';
  observacao: string | null;
  // Nome de quem fez, do Supabase Auth.
  autor: string;
  criadoEm: string;
}

// Notas de entrada (decisão 7.8): NF-e recebidas de terceiros e as NF-e
// de entrada que a própria Gama emite (importação, devolução, retorno),
// com a classificação de cada item.
export interface ItemEntrada {
  nItem: number;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  quantidade: string | null;
  valor: string | null;
  bcIcms: string | null;
  pIcms: string | null;
  vIcms: string | null;
  pIpi: string | null;
  vIpi: string | null;
  // Último registro do log do item; null = sem classificação.
  classe: ClasseEntrada | null;
  // Sugestão pra quem ainda não classificou: pelo CFOP do item ou pelo que
  // já se usou nas notas do mesmo fornecedor.
  sugestao: ClasseEntrada | null;
  sugestaoMotivo: 'cfop' | 'fornecedor' | null;
}

export interface NotaEntrada {
  chave: string;
  // recebida = NF-e de terceiro contra a Gama; propria = NF-e de entrada
  // emitida pela Gama.
  fonte: 'recebida' | 'propria';
  estabelecimento: string;
  numero: number | null;
  dataEmissao: string;
  natureza: string | null;
  fornecedor: string | null;
  documento: string | null;
  uf: string | null;
  valor: string | null;
  vIcms: string | null;
  vIpi: string | null;
  // sim/nao = lançada como compra no eGestor (temCompra); propria = nota
  // emitida pelo próprio eGestor.
  lancamento: 'sim' | 'nao' | 'propria';
  itens: ItemEntrada[];
}

export interface RegistroClassificacao {
  chave: string;
  nItem: number;
  classe: ClasseEntrada | null;
  observacao: string | null;
  origem: 'tela' | 'planilha';
  autor: string;
  criadoEm: string;
}

// Teto de notas da tela de entradas — um mês tem ~100.
const ENTRADAS_MAX = 3000;

// Notas que entram na tela de entradas: recebida autorizada e NF-e de
// entrada própria autorizada (com chave).
function cteNotasEntrada(workspaceId: string) {
  return Prisma.sql`
    notas AS (
      SELECT 'recebida' AS fonte, n.id, n.chave, n.estabelecimento::text AS estabelecimento, n.numero,
             n.data_emissao, n.natureza_operacao, n.emit_nome AS fornecedor, n.emit_cpf_cnpj AS documento,
             n.emit_uf AS uf, n.v_nf, n.v_icms, n.v_ipi,
             CASE WHEN n.lancada_compra THEN 'sim' ELSE 'nao' END AS lancamento
        FROM fiscal_nfe_recebida n
       WHERE n.workspace_id = ${workspaceId}::uuid AND n.situacao = 'autorizada'
      UNION ALL
      SELECT 'propria', e.id, e.chave, e.estabelecimento::text, e.numero,
             e.data_emissao, e.natureza_operacao, e.dest_nome, e.dest_cpf_cnpj,
             e.dest_uf, e.v_nf, e.v_icms, e.v_ipi, 'propria'
        FROM fiscal_nfe_emitida e
       WHERE e.workspace_id = ${workspaceId}::uuid AND e.situacao = 'autorizada'
         AND e.sentido = 'entrada' AND e.chave IS NOT NULL
    )`;
}

// Classificação sugerida pelo CFOP do item (marcações da tabela de CFOP).
const SUGESTAO_CFOP = Prisma.sql`
  CASE WHEN i.cfop IN ('5601', '6601') THEN 'icms'
       WHEN c.transferencia THEN 'transferencia'
       WHEN c.devolucao OR c.dev_venda OR c.dev_compra THEN 'devolucao'
       WHEN c.retorno THEN 'retorno'
       WHEN c.remessa THEN 'remessa'
  END`;

// Teto da lista de retornos da coluna da direita.
const RETORNOS_MAX = 2000;

// Descrição dos itens da nota que contam (os do CFOP de remessa ou de
// retorno), na ordem da nota, com a quantidade na frente quando não é 1.
const ITENS = Prisma.sql`array_agg(
  CASE WHEN i.q_com IS NULL OR i.q_com = 1 THEN COALESCE(i.x_prod, 'Item sem descrição')
       ELSE trim_scale(i.q_com)::text || ' × ' || COALESCE(i.x_prod, 'Item sem descrição') END
  ORDER BY i.n_item)`;

// Nota que entra no controle pela descrição (decisão 7.6): o CFOP não é de
// remessa com retorno (ou de retorno), mas a natureza da operação diz que
// é — "Remessa ... p/ demonstração" emitida com CFOP de venda, "Retorno de
// remessa ... comodato" com CFOP de entrada em comodato. Só os tipos que
// voltam; bonificação, amostra e garantia ficam de fora.
const TIPOS_QUE_VOLTAM = '(demonstra|conserto|reparo|comodato|exposi|feira|industrializa|consigna)';
const NATUREZA_REMESSA = `^\\s*rem(essa)?\\M.*${TIPOS_QUE_VOLTAM}`;
const NATUREZA_RETORNO = `^\\s*ret(orno)?\\M.*${TIPOS_QUE_VOLTAM}`;

// Itens que contam numa nota: os do CFOP marcado (exige retorno, ou
// retorno); na nota que entrou pela descrição, todos. Nota com algum CFOP
// de remessa ou de retorno não entra pela descrição — senão a mesma nota
// podia ser remessa e retorno ao mesmo tempo.
function itemConta(marca: 'exige_retorno' | 'retorno', tabelaItem: string, natureza: string): Prisma.Sql {
  return Prisma.sql`(COALESCE(${Prisma.raw(`c.${marca}`)}, false)
    OR (n.natureza_operacao ~* ${natureza}
        AND NOT EXISTS (
              SELECT 1
                FROM ${Prisma.raw(tabelaItem)} i2
                JOIN fiscal_cfop c2 ON c2.workspace_id = i2.workspace_id AND c2.codigo = i2.cfop
               WHERE i2.nfe_id = n.id AND (c2.exige_retorno OR c2.retorno))))`;
}

// Remessas que exigem retorno e notas de retorno, nos dois sentidos
// (decisão 7.4), e o vínculo que vale entre elas (decisão 7.5): o
// automático — o retorno cita a remessa no XML — menos o que alguém
// desfez, mais o que alguém ligou à mão. A nota é identificada pela chave
// de acesso, que vale igual pra emitida e recebida. `cfop_confere`,
// `receita` e `documento` alimentam os alertas da tela (decisão 7.6).
function ctesRemessa(workspaceId: string): Prisma.Sql {
  return Prisma.sql`
    rem AS (
      SELECT 'enviada'::text AS lado, n.id, n.chave, n.estabelecimento::text AS estabelecimento,
             n.numero, n.data_emissao, n.dest_nome AS contraparte, n.dest_cpf_cnpj AS documento,
             n.natureza_operacao AS natureza_nota,
             bool_or(COALESCE(c.exige_retorno, false)) AS cfop_confere,
             bool_or(COALESCE(c.receita, false)) AS receita,
             array_agg(DISTINCT i.cfop ORDER BY i.cfop) AS cfops,
             SUM(i.v_prod) AS valor, ${ITENS} AS itens
        FROM fiscal_nfe_emitida n
        JOIN fiscal_nfe_emitida_item i ON i.nfe_id = n.id
        LEFT JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
       WHERE n.workspace_id = ${workspaceId}::uuid AND n.situacao = 'autorizada'
         AND n.chave IS NOT NULL
         AND ${itemConta('exige_retorno', 'fiscal_nfe_emitida_item', NATUREZA_REMESSA)}
       GROUP BY n.id
      UNION ALL
      -- Receita só vale na nota da Gama: CFOP de venda de terceiro é a
      -- venda dele.
      SELECT 'recebida', n.id, n.chave, n.estabelecimento::text, n.numero, n.data_emissao,
             n.emit_nome, n.emit_cpf_cnpj, n.natureza_operacao,
             bool_or(COALESCE(c.exige_retorno, false)), false,
             array_agg(DISTINCT i.cfop ORDER BY i.cfop), SUM(i.v_prod), ${ITENS}
        FROM fiscal_nfe_recebida n
        JOIN fiscal_nfe_recebida_item i ON i.nfe_id = n.id
        LEFT JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
       WHERE n.workspace_id = ${workspaceId}::uuid AND n.situacao = 'autorizada'
         AND ${itemConta('exige_retorno', 'fiscal_nfe_recebida_item', NATUREZA_REMESSA)}
       GROUP BY n.id
    ),
    ret AS (
      -- Retorno emitido pela Gama: o de entrada fecha remessa enviada (a
      -- Gama registra a volta do que mandou), o de saída fecha remessa
      -- recebida (a Gama devolve o que era de terceiro).
      SELECT CASE WHEN n.sentido = 'entrada' THEN 'enviada' ELSE 'recebida' END AS fecha,
             n.chave, n.estabelecimento::text AS estabelecimento, n.numero, n.data_emissao,
             n.ref_chaves, n.dest_nome AS contraparte, n.dest_cpf_cnpj AS documento,
             bool_or(COALESCE(c.retorno, false)) AS cfop_confere,
             array_agg(DISTINCT i.cfop ORDER BY i.cfop) AS cfops, SUM(i.v_prod) AS valor, ${ITENS} AS itens
        FROM fiscal_nfe_emitida n
        JOIN fiscal_nfe_emitida_item i ON i.nfe_id = n.id
        LEFT JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
       WHERE n.workspace_id = ${workspaceId}::uuid AND n.situacao = 'autorizada'
         AND n.chave IS NOT NULL
         AND ${itemConta('retorno', 'fiscal_nfe_emitida_item', NATUREZA_RETORNO)}
       GROUP BY n.id
      UNION ALL
      -- Retorno emitido por terceiro: o de saída fecha remessa enviada (o
      -- cliente devolve o que a Gama mandou); o de entrada fecha remessa
      -- recebida — o dono registra a volta do que mandou pra Gama, no
      -- lugar da nota de saída da Gama (ex.: CFOP 2916).
      SELECT CASE WHEN n.sentido = 'entrada' THEN 'recebida' ELSE 'enviada' END,
             n.chave, n.estabelecimento::text, n.numero, n.data_emissao,
             n.ref_chaves, n.emit_nome, n.emit_cpf_cnpj, bool_or(COALESCE(c.retorno, false)),
             array_agg(DISTINCT i.cfop ORDER BY i.cfop), SUM(i.v_prod), ${ITENS}
        FROM fiscal_nfe_recebida n
        JOIN fiscal_nfe_recebida_item i ON i.nfe_id = n.id
        LEFT JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
       WHERE n.workspace_id = ${workspaceId}::uuid AND n.situacao = 'autorizada'
         AND ${itemConta('retorno', 'fiscal_nfe_recebida_item', NATUREZA_RETORNO)}
       GROUP BY n.id
    ),
    auto AS (
      SELECT r.lado, r.chave AS rem_chave, x.chave AS ret_chave
        FROM rem r
        JOIN ret x ON x.fecha = r.lado AND r.chave = ANY(x.ref_chaves)
    ),
    decisao AS (
      SELECT remessa_chave, retorno_chave, acao
        FROM fiscal_remessa_vinculo
       WHERE workspace_id = ${workspaceId}::uuid
    ),
    vinc AS (
      SELECT a.lado, a.rem_chave, a.ret_chave, 'nota'::text AS origem
        FROM auto a
       WHERE NOT EXISTS (
               SELECT 1 FROM decisao d
                WHERE d.remessa_chave = a.rem_chave AND d.retorno_chave = a.ret_chave
                  AND d.acao = 'desvincular')
      UNION
      SELECT r.lado, d.remessa_chave, d.retorno_chave, 'manual'
        FROM decisao d
        JOIN rem r ON r.chave = d.remessa_chave
        JOIN ret x ON x.chave = d.retorno_chave AND x.fecha = r.lado
       WHERE d.acao = 'vincular'
         AND NOT EXISTS (
               SELECT 1 FROM auto a
                WHERE a.rem_chave = d.remessa_chave AND a.ret_chave = d.retorno_chave)
    )`;
}

// Situações que valem como receita: a NFS-e com cancelamento pedido segue
// valendo até a prefeitura confirmar.
const VALEM = ['autorizada', 'cancelamento_pendente'];

// A NFS-e não traz natureza da operação; no relatório de notas emitidas
// ela aparece (e filtra) com este rótulo.
const OPERACAO_SERVICO = 'Prestação de serviço';

@Injectable()
export class FiscalService {
  constructor(private readonly supabaseUsers: SupabaseUserService) {}

  // Relatório "Resumo de notas emitidas" (pedido do usuário, 2026-10-21,
  // no molde do "Resumo NFe" do eGestor): NF-e com pelo menos um item de
  // CFOP marcado Receita, junto com as NFS-e (serviço é sempre receita),
  // base do PIS e da COFINS. Autorizadas e canceladas aparecem, como no
  // eGestor; os totais somam só as que valem (autorizada e NFS-e com
  // cancelamento ainda pendente na prefeitura) — ou só as canceladas,
  // quando o filtro de situação pede canceladas. Os valores são os do
  // total da nota. Com notas=todas entra toda NF-e emitida, como na lista
  // do eGestor (transferência, remessa, retorno, importação...).
  async relatorioReceita(tx: TenantTx, workspaceId: string, query: RelatorioReceitaQueryDto) {
    const [inicio, fim] = query.inicio <= query.fim ? [query.inicio, query.fim] : [query.fim, query.inicio];
    const estabelecimento = query.estabelecimento ?? null;
    const tipo = query.tipo ?? null;
    const situacoes =
      query.situacao === 'cancelada' ? ['cancelada'] : query.situacao === 'autorizada' ? VALEM : [...VALEM, 'cancelada'];
    const situacoesTotal = query.situacao === 'cancelada' ? ['cancelada'] : VALEM;
    const operacao = query.operacao?.trim() || null;
    const todas = query.notas === 'todas';

    const notas = Prisma.sql`
      SELECT n.id::text AS id,
             n.estabelecimento::text AS estabelecimento,
             'produto' AS tipo,
             n.numero,
             n.dest_nome AS destinatario,
             n.data_emissao,
             n.situacao,
             n.natureza_operacao AS operacao,
             n.v_nf AS total,
             n.v_icms,
             n.v_ipi,
             NULL::numeric AS v_iss,
             n.v_pis,
             n.v_cofins,
             EXISTS (
               SELECT 1
                 FROM fiscal_nfe_emitida_item i
                 LEFT JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
                WHERE i.nfe_id = n.id AND NOT COALESCE(c.receita, false)
             ) AND EXISTS (
               SELECT 1
                 FROM fiscal_nfe_emitida_item i
                 JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
                WHERE i.nfe_id = n.id AND c.receita
             ) AS cfop_misto
        FROM fiscal_nfe_emitida n
       WHERE n.workspace_id = ${workspaceId}::uuid
         AND n.data_emissao BETWEEN ${inicio}::date AND ${fim}::date
         AND n.situacao IN ('autorizada', 'cancelada')
         AND (${todas}::boolean OR EXISTS (
               SELECT 1
                 FROM fiscal_nfe_emitida_item i
                 JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
                WHERE i.nfe_id = n.id AND c.receita
             ))
      UNION ALL
      SELECT s.id::text,
             s.estabelecimento::text,
             'servico',
             COALESCE(s.numero_nfse, s.numero_rps),
             s.tomador_nome,
             s.data_emissao,
             s.situacao,
             ${OPERACAO_SERVICO}::text,
             s.valor_bruto,
             NULL,
             NULL,
             s.v_iss,
             s.v_pis,
             s.v_cofins,
             false
        FROM fiscal_nfse_emitida s
       WHERE s.workspace_id = ${workspaceId}::uuid
         AND s.data_emissao BETWEEN ${inicio}::date AND ${fim}::date
         AND s.situacao IN ('autorizada', 'cancelamento_pendente', 'cancelada')`;

    // O de operação fica à parte: a lista de operações do filtro da tela
    // sai das notas com os outros filtros, sem ele.
    const filtroSemOperacao = Prisma.sql`
      (${estabelecimento}::text IS NULL OR estabelecimento = ${estabelecimento}::text)
      AND (${tipo}::text IS NULL OR tipo = ${tipo}::text)
      AND situacao = ANY(${situacoes}::text[])`;
    const filtro = Prisma.sql`${filtroSemOperacao}
      AND (${operacao}::text IS NULL OR operacao = ${operacao}::text)`;

    const linhas = await tx.$queryRaw<LinhaReceita[]>`
      WITH notas AS (${notas})
      SELECT id,
             estabelecimento,
             tipo,
             numero,
             destinatario,
             to_char(data_emissao, 'YYYY-MM-DD') AS "dataEmissao",
             situacao,
             operacao,
             total::text    AS total,
             v_icms::text   AS "vIcms",
             v_ipi::text    AS "vIpi",
             v_iss::text    AS "vIss",
             v_pis::text    AS "vPis",
             v_cofins::text AS "vCofins",
             cfop_misto     AS "cfopMisto"
        FROM notas
       WHERE ${filtro}
       ORDER BY data_emissao, tipo, estabelecimento, numero
       LIMIT ${RELATORIO_MAX_LINHAS + 1}`;

    const totais = await tx.$queryRaw<TotalReceita[]>`
      WITH notas AS (${notas})
      SELECT tipo,
             COUNT(*)::int AS notas,
             COALESCE(SUM(total), 0)::text    AS total,
             -- Sem COALESCE: soma só de nota onde o imposto não se aplica
             -- (ICMS/IPI de serviço, ISS de produto) fica null, e a tela
             -- mostra "—" em vez de R$ 0,00.
             SUM(v_icms)::text AS "vIcms",
             SUM(v_ipi)::text  AS "vIpi",
             SUM(v_iss)::text  AS "vIss",
             COALESCE(SUM(v_pis), 0)::text    AS "vPis",
             COALESCE(SUM(v_cofins), 0)::text AS "vCofins"
        FROM notas
       WHERE ${filtro}
         AND situacao = ANY(${situacoesTotal}::text[])
       GROUP BY GROUPING SETS ((tipo), ())
       ORDER BY tipo NULLS LAST`;

    const operacoes = await tx.$queryRaw<{ operacao: string }[]>`
      WITH notas AS (${notas})
      SELECT DISTINCT operacao
        FROM notas
       WHERE ${filtroSemOperacao}
         AND operacao IS NOT NULL
       ORDER BY operacao`;

    return {
      inicio,
      fim,
      rows: linhas.slice(0, RELATORIO_MAX_LINHAS),
      truncado: linhas.length > RELATORIO_MAX_LINHAS,
      totais,
      operacoes: operacoes.map((o) => o.operacao),
    };
  }

  // Controle de remessas (pedido do usuário, 2026-10-21; decisões 7.4 e
  // 7.5). Remessa é nota com item de CFOP marcado "Exige retorno", nos dois
  // sentidos: a que a Gama emitiu (enviada — tem que voltar) e a que a
  // Gama recebeu de terceiro (recebida — a Gama tem que devolver; o CFOP
  // da recebida é o do remetente, e a tabela de CFOP vale igual pra ele).
  //
  // Retorno é nota com item de CFOP marcado "Retorno". Liga com a remessa
  // sozinho quando cita a chave dela (refNFe) — na carga de 2026-10-21, 54
  // remessas casaram assim —, e à mão, arrastando na tela, quando não cita.
  // Um retorno pode fechar várias remessas e uma remessa pode voltar em
  // várias notas.
  //
  // Situação: retornada (os retornos ligados cobrem o valor), parcial (não
  // cobrem) ou em aberto. A coluna da direita traz as notas de retorno a
  // partir do início do período (o retorno vem depois da remessa).
  async remessas(tx: TenantTx, workspaceId: string, query: RemessasQueryDto) {
    const [inicio, fim] = query.inicio <= query.fim ? [query.inicio, query.fim] : [query.fim, query.inicio];
    const estabelecimento = query.estabelecimento ?? null;
    const lado = query.lado ?? null;
    const retorno = query.retorno ?? null;

    const base = Prisma.sql`
      WITH ${ctesRemessa(workspaceId)},
      s AS (
        SELECT r.lado,
               r.id::text AS id,
               r.chave,
               r.estabelecimento,
               r.numero,
               r.data_emissao,
               r.contraparte,
               r.documento,
               r.natureza_nota,
               r.cfop_confere,
               r.receita,
               r.cfops,
               r.itens,
               r.valor,
               COALESCE(SUM(x.valor), 0) AS valor_retornado,
               CASE
                 WHEN COUNT(x.chave) = 0 THEN 'aberta'
                 WHEN COALESCE(SUM(x.valor), 0) >= r.valor - 0.01 THEN 'retornada'
                 ELSE 'parcial'
               END AS retorno,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'chave', x.chave,
                     'numero', x.numero,
                     'dataEmissao', to_char(x.data_emissao, 'YYYY-MM-DD'),
                     'cfops', x.cfops,
                     'itens', x.itens,
                     'valor', x.valor::text,
                     'origem', v.origem,
                     'cfopConfere', x.cfop_confere,
                     'documento', x.documento
                   ) ORDER BY x.data_emissao, x.numero
                 ) FILTER (WHERE x.chave IS NOT NULL),
                 '[]'
               ) AS retornos
          FROM rem r
          LEFT JOIN vinc v ON v.rem_chave = r.chave AND v.lado = r.lado
          LEFT JOIN ret x ON x.chave = v.ret_chave AND x.fecha = r.lado
         WHERE r.data_emissao BETWEEN ${inicio}::date AND ${fim}::date
           AND (${estabelecimento}::text IS NULL OR r.estabelecimento = ${estabelecimento}::text)
           AND (${lado}::text IS NULL OR r.lado = ${lado}::text)
         GROUP BY r.lado, r.id, r.chave, r.estabelecimento, r.numero, r.data_emissao, r.contraparte, r.documento,
                  r.natureza_nota, r.cfop_confere, r.receita, r.cfops, r.itens, r.valor
      )`;

    const linhas = await tx.$queryRaw<LinhaRemessa[]>`
      ${base}
      SELECT s.id,
             s.chave,
             s.lado,
             s.estabelecimento,
             s.numero,
             to_char(s.data_emissao, 'YYYY-MM-DD') AS "dataEmissao",
             s.contraparte,
             s.documento,
             s.cfop_confere AS "cfopConfere",
             s.receita,
             s.cfops,
             s.itens,
             -- Nota que entrou pela descrição: o CFOP é de outra operação,
             -- então a operação vem da própria nota.
             CASE WHEN s.cfop_confere
                  THEN (SELECT c.descricao
                          FROM fiscal_cfop c
                         WHERE c.workspace_id = ${workspaceId}::uuid AND c.codigo = s.cfops[1])
                  ELSE s.natureza_nota
             END AS natureza,
             s.valor::text AS valor,
             s.valor_retornado::text AS "valorRetornado",
             s.retorno,
             CASE
               WHEN s.retorno <> 'retornada'
               THEN ((now() AT TIME ZONE 'America/Sao_Paulo')::date - s.data_emissao)
             END AS "diasEmAberto",
             s.retornos
        FROM s
       WHERE ${retorno}::text IS NULL
          OR (${retorno}::text = 'retornada' AND s.retorno = 'retornada')
          OR (${retorno}::text = 'pendente' AND s.retorno <> 'retornada')
       ORDER BY s.data_emissao, s.numero
       LIMIT ${RELATORIO_MAX_LINHAS + 1}`;

    // Contagem por situação do período inteiro, sem o filtro de situação —
    // é o quadro de cima da tela.
    const resumo = await tx.$queryRaw<ResumoRemessas[]>`
      ${base}
      SELECT lado, retorno, COUNT(*)::int AS remessas, SUM(valor)::text AS valor
        FROM s
       GROUP BY lado, retorno
       ORDER BY lado, retorno`;

    const retornos = await tx.$queryRaw<RetornoDisponivel[]>`
      WITH ${ctesRemessa(workspaceId)}
      SELECT x.chave,
             x.fecha,
             x.estabelecimento,
             x.numero,
             to_char(x.data_emissao, 'YYYY-MM-DD') AS "dataEmissao",
             x.contraparte,
             x.documento,
             x.cfop_confere AS "cfopConfere",
             x.cfops,
             x.itens,
             x.valor::text AS valor,
             (SELECT COUNT(*)::int FROM vinc v WHERE v.ret_chave = x.chave AND v.lado = x.fecha) AS vinculos
        FROM ret x
       WHERE x.data_emissao >= ${inicio}::date
         AND (${estabelecimento}::text IS NULL OR x.estabelecimento = ${estabelecimento}::text)
         AND (${lado}::text IS NULL OR x.fecha = ${lado}::text)
       ORDER BY x.data_emissao DESC, x.numero DESC
       LIMIT ${RETORNOS_MAX}`;

    const rows = linhas.slice(0, RELATORIO_MAX_LINHAS);
    return {
      inicio,
      fim,
      rows,
      truncado: linhas.length > RELATORIO_MAX_LINHAS,
      resumo,
      retornos,
      alertasLog: await this.logDosAlertas(
        tx,
        rows.map((r) => r.chave),
      ),
    };
  }

  // Log dos alertas das remessas da tela (decisão 7.7), do mais antigo pro
  // mais novo — o último registro de cada remessa + regra é o que vale.
  private async logDosAlertas(tx: TenantTx, chaves: string[]): Promise<RegistroAlerta[]> {
    if (chaves.length === 0) return [];
    const registros = await tx.fiscalRemessaAlertaLog.findMany({
      where: { remessaChave: { in: chaves } },
      orderBy: { createdAt: 'asc' },
    });
    const identidades = await this.supabaseUsers.getIdentities([...new Set(registros.map((r) => r.userId))]);
    return registros.map((r) => {
      const quem = identidades.get(r.userId);
      return {
        remessaChave: r.remessaChave,
        regra: r.regra,
        acao: r.acao as RegistroAlerta['acao'],
        observacao: r.observacao,
        autor: quem?.name ?? quem?.login ?? 'Membro removido',
        criadoEm: r.createdAt.toISOString(),
      };
    });
  }

  // Marca um alerta como tratado ou o reabre (decisão 7.7). Só acrescenta
  // no log — o estado é o último registro. Tratar exige observação.
  async registrarAlerta(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
    dto: AlertaRemessaDto,
    acao: RegistroAlerta['acao'],
  ): Promise<{ ok: true }> {
    const observacao = dto.observacao?.trim() || null;
    if (acao === 'tratar' && !observacao) {
      throw new BadRequestException('Escreva o que foi feito para tratar o alerta.');
    }
    const [conferencia] = await tx.$queryRaw<{ existe: boolean }[]>`
      WITH ${ctesRemessa(workspaceId)}
      SELECT EXISTS (SELECT 1 FROM rem WHERE chave = ${dto.remessaChave}) AS existe`;
    if (!conferencia.existe) {
      throw new NotFoundException('Remessa não encontrada no Console fiscal.');
    }
    await tx.fiscalRemessaAlertaLog.create({
      data: { workspaceId, remessaChave: dto.remessaChave, regra: dto.regra, acao, observacao, userId },
    });
    return { ok: true };
  }

  // Liga (ou desfaz) à mão um retorno a uma remessa (decisão 7.5). Grava a
  // decisão da pessoa, não o vínculo pronto: desfazer um vínculo que a
  // própria nota faz (o retorno cita a remessa) também fica registrado,
  // senão ele voltaria na próxima leitura. Só liga retorno do sentido
  // certo — o de remessa recebida não fecha remessa enviada.
  async decidirVinculo(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
    dto: VinculoRemessaDto,
    acao: 'vincular' | 'desvincular',
  ): Promise<{ ok: true }> {
    const [conferencia] = await tx.$queryRaw<
      { remessaExiste: boolean; retornoExiste: boolean; compativel: boolean }[]
    >`
      WITH ${ctesRemessa(workspaceId)}
      SELECT EXISTS (SELECT 1 FROM rem WHERE chave = ${dto.remessaChave}) AS "remessaExiste",
             EXISTS (SELECT 1 FROM ret WHERE chave = ${dto.retornoChave}) AS "retornoExiste",
             EXISTS (
               SELECT 1 FROM rem r JOIN ret x ON x.fecha = r.lado
                WHERE r.chave = ${dto.remessaChave} AND x.chave = ${dto.retornoChave}
             ) AS compativel`;

    if (!conferencia.remessaExiste) {
      throw new NotFoundException('Remessa não encontrada no Console fiscal.');
    }
    if (!conferencia.retornoExiste) {
      throw new NotFoundException('Nota de retorno não encontrada no Console fiscal.');
    }
    if (acao === 'vincular' && !conferencia.compativel) {
      throw new BadRequestException(
        'Essa nota não devolve esse tipo de remessa: a remessa que a Gama enviou volta com nota de entrada da Gama ou com a nota do cliente, e a que a Gama recebeu volta com nota de saída da Gama.',
      );
    }

    await tx.fiscalRemessaVinculo.upsert({
      where: {
        workspaceId_remessaChave_retornoChave: {
          workspaceId,
          remessaChave: dto.remessaChave,
          retornoChave: dto.retornoChave,
        },
      },
      create: {
        workspaceId,
        remessaChave: dto.remessaChave,
        retornoChave: dto.retornoChave,
        acao,
        alteradoPorUserId: userId,
      },
      update: { acao, alteradoPorUserId: userId },
    });
    return { ok: true };
  }

  // Notas de entrada do período (decisão 7.8), com os itens, a
  // classificação atual de cada item, a sugestão pra quem não tem e o
  // histórico das classificações.
  async entradas(tx: TenantTx, workspaceId: string, query: EntradasQueryDto) {
    const [inicio, fim] = query.inicio <= query.fim ? [query.inicio, query.fim] : [query.fim, query.inicio];
    const estabelecimento = query.estabelecimento ?? null;

    const notas = await tx.$queryRaw<(Omit<NotaEntrada, 'itens'> & { id: string })[]>`
      WITH ${cteNotasEntrada(workspaceId)}
      SELECT n.id::text AS id, n.fonte, n.chave, n.estabelecimento, n.numero,
             to_char(n.data_emissao, 'YYYY-MM-DD') AS "dataEmissao",
             n.natureza_operacao AS natureza, n.fornecedor, n.documento, n.uf,
             n.v_nf::text AS valor, n.v_icms::text AS "vIcms", n.v_ipi::text AS "vIpi", n.lancamento
        FROM notas n
       WHERE n.data_emissao BETWEEN ${inicio}::date AND ${fim}::date
         AND (${estabelecimento}::text IS NULL OR n.estabelecimento = ${estabelecimento}::text)
       ORDER BY n.data_emissao DESC, n.numero DESC
       LIMIT ${ENTRADAS_MAX + 1}`;
    const truncado = notas.length > ENTRADAS_MAX;
    if (truncado) notas.length = ENTRADAS_MAX;
    if (notas.length === 0) {
      return { inicio, fim, truncado, rows: [] as NotaEntrada[], historico: [] as RegistroClassificacao[] };
    }

    const ids = notas.map((n) => n.id);
    const chaves = notas.map((n) => n.chave);
    const fornecedores = [...new Set(notas.map((n) => chaveFornecedor(n)))];

    const itens = await tx.$queryRaw<
      (Omit<ItemEntrada, 'classe' | 'sugestao' | 'sugestaoMotivo'> & {
        nfeId: string;
        sugestaoCfop: ClasseEntrada | null;
      })[]
    >`
      SELECT i.nfe_id::text AS "nfeId", i.n_item AS "nItem", i.x_prod AS descricao, i.ncm, i.cfop,
             i.q_com::text AS quantidade, i.v_prod::text AS valor, i.v_bc_icms::text AS "bcIcms",
             i.p_icms::text AS "pIcms", i.v_icms::text AS "vIcms", i.p_ipi::text AS "pIpi",
             i.v_ipi::text AS "vIpi", ${SUGESTAO_CFOP} AS "sugestaoCfop"
        FROM (
          SELECT nfe_id, n_item, x_prod, ncm, cfop, q_com, v_prod, v_bc_icms, p_icms, v_icms, p_ipi, v_ipi, workspace_id
            FROM fiscal_nfe_recebida_item WHERE nfe_id = ANY(${ids}::uuid[])
          UNION ALL
          SELECT nfe_id, n_item, x_prod, ncm, cfop, q_com, v_prod, v_bc_icms, p_icms, v_icms, p_ipi, v_ipi, workspace_id
            FROM fiscal_nfe_emitida_item WHERE nfe_id = ANY(${ids}::uuid[])
        ) i
        LEFT JOIN fiscal_cfop c ON c.workspace_id = i.workspace_id AND c.codigo = i.cfop
       ORDER BY i.nfe_id, i.n_item`;

    // Classe mais usada nas notas de cada fornecedor (empate: a mais
    // recente), olhando o histórico inteiro, não só o período da tela.
    const porFornecedor = await tx.$queryRaw<{ fornecedor: string; classe: ClasseEntrada }[]>`
      WITH ${cteNotasEntrada(workspaceId)},
      ult AS (
        SELECT DISTINCT ON (chave, n_item) chave, classe, created_at
          FROM fiscal_entrada_classificacao
         ORDER BY chave, n_item, created_at DESC
      ),
      contagem AS (
        SELECT COALESCE(n.documento, upper(n.fornecedor)) AS fornecedor, u.classe,
               count(*) AS vezes, max(u.created_at) AS ultima
          FROM ult u JOIN notas n ON n.chave = u.chave
         WHERE u.classe IS NOT NULL
         GROUP BY 1, 2
      )
      SELECT DISTINCT ON (fornecedor) fornecedor, classe
        FROM contagem
       WHERE fornecedor = ANY(${fornecedores}::text[])
       ORDER BY fornecedor, vezes DESC, ultima DESC`;
    const sugestaoFornecedor = new Map(porFornecedor.map((x) => [x.fornecedor, x.classe]));

    const registros = await tx.fiscalEntradaClassificacao.findMany({
      where: { chave: { in: chaves } },
      orderBy: { createdAt: 'asc' },
    });
    const atual = new Map<string, ClasseEntrada | null>();
    for (const r of registros) atual.set(`${r.chave}|${r.nItem}`, r.classe as ClasseEntrada | null);

    const itensPorNota = new Map<string, ItemEntrada[]>();
    for (const { nfeId, sugestaoCfop, ...item } of itens) {
      const lista = itensPorNota.get(nfeId) ?? [];
      lista.push({ ...item, classe: null, sugestao: sugestaoCfop, sugestaoMotivo: sugestaoCfop ? 'cfop' : null });
      itensPorNota.set(nfeId, lista);
    }

    const rows: NotaEntrada[] = notas.map(({ id, ...nota }) => {
      const doFornecedor = sugestaoFornecedor.get(chaveFornecedor(nota)) ?? null;
      const lista = (itensPorNota.get(id) ?? []).map((item): ItemEntrada => {
        const classe = atual.get(`${nota.chave}|${item.nItem}`) ?? null;
        if (item.sugestao || !doFornecedor) return { ...item, classe };
        return { ...item, classe, sugestao: doFornecedor, sugestaoMotivo: 'fornecedor' };
      });
      return { ...nota, itens: lista };
    });

    const identidades = await this.supabaseUsers.getIdentities([
      ...new Set(registros.filter((r) => r.origem === 'tela').map((r) => r.userId)),
    ]);
    const historico: RegistroClassificacao[] = registros.map((r) => {
      const quem = identidades.get(r.userId);
      return {
        chave: r.chave,
        nItem: r.nItem,
        classe: r.classe as ClasseEntrada | null,
        observacao: r.observacao,
        origem: r.origem as RegistroClassificacao['origem'],
        autor: r.origem === 'planilha' ? 'Planilha de controle' : (quem?.name ?? quem?.login ?? 'Membro removido'),
        criadoEm: r.createdAt.toISOString(),
      };
    });

    return { inicio, fim, truncado, rows, historico };
  }

  // Classifica itens de uma nota de entrada (decisão 7.8). Só acrescenta no
  // log, e só pros itens cuja classe muda (ou quando vem observação).
  async classificarEntrada(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
    dto: ClassificarEntradaDto,
  ): Promise<{ ok: true; alterados: number }> {
    const existentes = await tx.$queryRaw<{ nItem: number }[]>`
      WITH ${cteNotasEntrada(workspaceId)}
      SELECT i.n_item AS "nItem"
        FROM notas n
        JOIN (SELECT nfe_id, n_item FROM fiscal_nfe_recebida_item
              UNION ALL SELECT nfe_id, n_item FROM fiscal_nfe_emitida_item) i ON i.nfe_id = n.id
       WHERE n.chave = ${dto.chave}`;
    if (existentes.length === 0) {
      throw new NotFoundException('Nota de entrada não encontrada no Console fiscal (ou ainda sem itens).');
    }
    const daNota = new Set(existentes.map((x) => x.nItem));
    const alvo = dto.itens?.length ? [...new Set(dto.itens)] : [...daNota];
    if (alvo.some((n) => !daNota.has(n))) {
      throw new NotFoundException('Item não encontrado nessa nota.');
    }

    const classe = dto.classe ?? null;
    const observacao = dto.observacao?.trim() || null;
    const registros = await tx.fiscalEntradaClassificacao.findMany({
      where: { chave: dto.chave, nItem: { in: alvo } },
      orderBy: { createdAt: 'asc' },
      select: { nItem: true, classe: true },
    });
    const atual = new Map<number, string | null>();
    for (const r of registros) atual.set(r.nItem, r.classe);
    const mudam = alvo.filter((n) => observacao || (atual.get(n) ?? null) !== classe);
    if (mudam.length > 0) {
      await tx.fiscalEntradaClassificacao.createMany({
        data: mudam.map((nItem) => ({ workspaceId, chave: dto.chave, nItem, classe, observacao, userId })),
      });
    }
    return { ok: true, alterados: mudam.length };
  }
}

// Fornecedor da nota pra sugestão: o CNPJ/CPF, ou o nome quando não tem
// documento (fornecedor estrangeiro na nota de importação).
function chaveFornecedor(nota: { documento: string | null; fornecedor: string | null }): string {
  return nota.documento ?? (nota.fornecedor ?? '').toUpperCase();
}
