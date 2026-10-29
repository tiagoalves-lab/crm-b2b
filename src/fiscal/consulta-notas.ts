import { Prisma } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { ConsultaNotasQueryDto } from './dto/fiscal-query.dto';

// Consultar notas (pedido do usuário, 2026-10-28): pesquisa livre em toda
// a base fiscal — NF-e emitidas, NF-e recebidas e NFS-e — com o resultado
// por nota, por item ou agrupado (empresa, CFOP, mês).
//
// Mesmas regras das outras telas do console: o CFOP é o do item (decisão
// 3.2) e, na recebida, é o do fornecedor como está no XML (2.3); a
// direção (entrada/saída) vem do XML, lida do lado da Gama; a nota cancelada aparece na lista
// mas não soma (7.2); a NFS-e não tem ICMS nem IPI (fica null → "—").

const MAX_LINHAS = 5000;

// Situações que somam: a NFS-e com cancelamento pedido segue valendo até a
// prefeitura confirmar (mesmo critério do Resumo de notas emitidas).
const VALEM = ['autorizada', 'cancelamento_pendente'];

// Rascunho e nota recusada não são documento fiscal: ficam de fora.
const FORA = ['rejeitada', 'pendente'];

const COLUNA_MARCA: Record<string, string> = {
  receita: 'c.receita',
  remessa: 'c.remessa',
  'exige-retorno': 'c.exige_retorno',
  retorno: 'c.retorno',
  transferencia: 'c.transferencia',
  importacao: 'c.importacao',
  'dev-venda': 'c.dev_venda',
  'dev-compra': 'c.dev_compra',
  'sem-cadastro': '(c.codigo IS NULL AND i.cfop IS NOT NULL)',
};

const COLUNA_IMPOSTO: Record<string, string> = {
  icms: 'n.v_icms',
  st: 'n.v_st',
  ipi: 'n.v_ipi',
  difal: 'n.v_difal',
  iss: 'n.v_iss',
  retencao: 'n.v_ret',
};

// Busca sem acento e sem caixa dos dois lados (o banco não tem unaccent).
const ACENTOS = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
const SEM_ACENTOS = 'aaaaaeeeeiiiiooooouuuucn';
function semAcentoSql(coluna: string): Prisma.Sql {
  return Prisma.sql`translate(lower(${Prisma.raw(coluna)}), ${ACENTOS}, ${SEM_ACENTOS})`;
}
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}

function e(condicoes: Prisma.Sql[]): Prisma.Sql {
  return condicoes.length ? Prisma.join(condicoes, ' AND ') : Prisma.sql`true`;
}

// Uma linha por nota, das três tabelas, no mesmo formato. "empresa" é quem
// está do outro lado: o destinatário na nota que a Gama emite, o emitente
// na que ela recebe.
function cteNotas(ws: string): Prisma.Sql {
  return Prisma.sql`
    notas AS (
      SELECT n.id, 'nfe'::text AS doc, 'gama'::text AS emitente, n.estabelecimento::text AS estabelecimento,
             n.chave, n.numero, n.serie::text AS serie, n.data_emissao, n.situacao,
             false AS resumo, n.sentido, n.natureza_operacao AS natureza,
             n.dest_nome AS empresa, n.dest_cpf_cnpj AS documento, n.dest_uf AS uf,
             n.v_nf AS total, n.v_icms, n.v_st, n.v_ipi, n.v_pis, n.v_cofins,
             NULL::numeric AS v_iss, n.v_icms_uf_dest AS v_difal, NULL::numeric AS v_ret,
             -- Transferência (2.3.2): mesma raiz de CNPJ dos dois lados; o
             -- CNPJ de quem emitiu está dentro da chave (posições 7 a 20).
             COALESCE(left(n.dest_cpf_cnpj, 8) = substr(n.chave, 7, 8), false) AS transferencia
        FROM fiscal_nfe_emitida n
       WHERE n.workspace_id = ${ws}::uuid
      UNION ALL
      SELECT r.id, 'nfe', 'terceiro', r.estabelecimento::text,
             r.chave, r.numero, r.serie::text, r.data_emissao, r.situacao,
             -- Origem do ponto de vista da Gama: a venda do fornecedor
             -- (saída dele) é entrada aqui. A tabela guarda como está no
             -- XML (decisão 2.3); só esta tela inverte, pra leitura.
             r.xml IS NULL,
             CASE r.sentido WHEN 'saida' THEN 'entrada' WHEN 'entrada' THEN 'saida' END,
             r.natureza_operacao,
             r.emit_nome, r.emit_cpf_cnpj, r.emit_uf,
             r.v_nf, r.v_icms, r.v_st, r.v_ipi, r.v_pis, r.v_cofins,
             NULL, r.v_icms_uf_dest, NULL,
             COALESCE(left(r.emit_cpf_cnpj, 8) = left(r.dest_cpf_cnpj, 8), false)
        FROM fiscal_nfe_recebida r
       WHERE r.workspace_id = ${ws}::uuid
      UNION ALL
      SELECT s.id, 'nfse', 'gama', s.estabelecimento::text,
             NULL, COALESCE(s.numero_nfse, s.numero_rps), s.serie, s.data_emissao, s.situacao,
             false, 'saida', 'Prestação de serviço',
             s.tomador_nome, s.tomador_cpf_cnpj, NULL,
             s.valor_bruto, NULL, NULL, NULL, s.v_pis, s.v_cofins,
             s.v_iss, NULL, NULLIF(COALESCE(s.v_irrf, 0) + COALESCE(s.v_inss, 0) + COALESCE(s.v_csll, 0), 0),
             false
        FROM fiscal_nfse_emitida s
       WHERE s.workspace_id = ${ws}::uuid
    )`;
}

// Uma linha por item. A NFS-e guarda os itens em JSON (o eGestor não dá o
// arquivo) e não tem CFOP, NCM, ICMS nem IPI.
function cteItens(ws: string): Prisma.Sql {
  const colunas = Prisma.raw(`i.nfe_id AS nota_id, i.n_item, i.c_prod, i.x_prod, i.ncm, i.cfop, NULL::text AS servico,
             i.q_com, i.v_prod, i.orig_icms, i.cst_icms, i.v_bc_icms, i.p_icms, i.v_icms, i.p_ipi, i.v_ipi`);
  return Prisma.sql`
    itens AS (
      SELECT ${colunas} FROM fiscal_nfe_emitida_item i WHERE i.workspace_id = ${ws}::uuid
      UNION ALL
      SELECT ${colunas} FROM fiscal_nfe_recebida_item i WHERE i.workspace_id = ${ws}::uuid
      UNION ALL
      SELECT s.id, x.ord::int, NULL, x.item->>'servico', NULL, NULL, x.item->>'codListaServico',
             (x.item->>'quant')::numeric, (x.item->>'total')::numeric,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL
        FROM fiscal_nfse_emitida s
       CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.itens) = 'array' THEN s.itens ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS x(item, ord)
       WHERE s.workspace_id = ${ws}::uuid
    )`;
}

export interface ResumoConsulta {
  notas: number;
  // Listadas que não somam (cancelada, denegada, inutilizada).
  foraDaSoma: number;
  notasSaida: number;
  saida: string;
  notasEntrada: number;
  entrada: string;
  vIcms: string;
  vIpi: string;
  vPis: string;
  vCofins: string;
  total: string;
}

export async function consultarNotas(tx: TenantTx, ws: string, q: ConsultaNotasQueryDto) {
  const [inicio, fim] = q.inicio <= q.fim ? [q.inicio, q.fim] : [q.fim, q.inicio];
  const ver = q.ver ?? 'nota';

  // ---------- Filtros da nota ----------
  const nota: Prisma.Sql[] = [
    Prisma.sql`n.data_emissao BETWEEN ${inicio}::date AND ${fim}::date`,
    Prisma.sql`n.situacao <> ALL(${FORA}::text[])`,
  ];
  const empresa = q.empresa?.trim();
  if (empresa) {
    const digitos = empresa.replace(/[.\-/\s]/g, '');
    if (/^\d{3,14}$/.test(digitos)) {
      nota.push(Prisma.sql`n.documento LIKE ${digitos + '%'}`);
    } else {
      nota.push(Prisma.sql`${semAcentoSql('n.empresa')} LIKE ${'%' + escaparLike(semAcento(empresa)) + '%'}`);
    }
  }
  if (q.numero) nota.push(Prisma.sql`n.numero = ${Number(q.numero)}`);
  if (q.doc) nota.push(Prisma.sql`n.doc = ${q.doc}`);
  if (q.situacao === 'resumo') nota.push(Prisma.sql`n.resumo`);
  else if (q.situacao === 'autorizada') nota.push(Prisma.sql`n.situacao = ANY(${VALEM}::text[]) AND NOT n.resumo`);
  else if (q.situacao) nota.push(Prisma.sql`n.situacao = ${q.situacao}`);
  if (q.serie) nota.push(Prisma.sql`ltrim(n.serie, '0') = ${q.serie.replace(/^0+/, '')}`);
  if (q.chave) nota.push(Prisma.sql`n.chave LIKE ${q.chave + '%'}`);
  if (q.sentido) nota.push(Prisma.sql`n.sentido = ${q.sentido}`);
  if (q.emitente) nota.push(Prisma.sql`n.emitente = ${q.emitente}`);
  if (q.estabelecimento) nota.push(Prisma.sql`n.estabelecimento = ${q.estabelecimento}`);
  if (q.transferencia === 'excluir') nota.push(Prisma.sql`NOT n.transferencia`);
  if (q.transferencia === 'so') nota.push(Prisma.sql`n.transferencia`);
  if (q.uf) nota.push(Prisma.sql`n.uf = ${q.uf}`);
  if (q.vNotaMin) nota.push(Prisma.sql`n.total >= ${q.vNotaMin}::numeric`);
  if (q.vNotaMax) nota.push(Prisma.sql`n.total <= ${q.vNotaMax}::numeric`);
  for (const imposto of q.impostos?.split(',') ?? []) {
    nota.push(Prisma.sql`COALESCE(${Prisma.raw(COLUNA_IMPOSTO[imposto])}, 0) > 0`);
  }

  // ---------- Filtros do item ----------
  // Com algum deles ligado, a nota só entra se tiver item que passe, e a
  // visão por item mostra só os itens que passam.
  const item: Prisma.Sql[] = [];
  const termo = q.item?.trim();
  if (termo) {
    item.push(Prisma.sql`(${semAcentoSql('i.x_prod')} LIKE ${'%' + escaparLike(semAcento(termo)) + '%'}
      OR lower(i.c_prod) LIKE ${escaparLike(termo.toLowerCase()) + '%'})`);
  }
  if (q.ncm) item.push(Prisma.sql`i.ncm LIKE ${q.ncm + '%'}`);
  if (q.servico) item.push(Prisma.sql`i.servico LIKE ${escaparLike(q.servico) + '%'}`);
  if (q.cfop) {
    const padroes = q.cfop.split(',').map((c) => c.replace(/x/g, '_'));
    item.push(Prisma.sql`i.cfop LIKE ANY(${padroes}::text[])`);
  }
  if (q.marcas) {
    const ou = q.marcas.split(',').map((m) => Prisma.raw(`COALESCE(${COLUNA_MARCA[m]}, false)`));
    item.push(Prisma.sql`(${Prisma.join(ou, ' OR ')})`);
  }
  if (q.vItemMin) item.push(Prisma.sql`i.v_prod >= ${q.vItemMin}::numeric`);
  if (q.vItemMax) item.push(Prisma.sql`i.v_prod <= ${q.vItemMax}::numeric`);
  if (q.classe === 'sem') {
    // "Sem classificação" só faz sentido nas notas de entrada (decisão 7.8).
    item.push(Prisma.sql`(n.emitente = 'terceiro' OR n.sentido = 'entrada') AND cl.classe IS NULL`);
  } else if (q.classe) {
    item.push(Prisma.sql`cl.classe = ${q.classe}`);
  }
  const filtraItem = item.length > 0;

  // Com o filtro de situação pedindo cancelada/denegada/inutilizada, os
  // totais somam o que foi pedido (mesma regra do Resumo de notas
  // emitidas); senão, só o que vale.
  const conta =
    q.situacao && !['autorizada', 'resumo'].includes(q.situacao)
      ? Prisma.sql`true`
      : Prisma.sql`n.situacao = ANY(${VALEM}::text[])`;

  const base = Prisma.sql`
    WITH ${cteNotas(ws)},
    ${cteItens(ws)},
    notas_f AS (SELECT * FROM notas n WHERE ${e(nota)}),
    itens_f AS (
      SELECT i.*, c.descricao AS cfop_descricao
        FROM itens i
        JOIN notas_f n ON n.id = i.nota_id
        LEFT JOIN fiscal_cfop c ON c.workspace_id = ${ws}::uuid AND c.codigo = i.cfop
        LEFT JOIN LATERAL (
          SELECT ec.classe
            FROM fiscal_entrada_classificacao ec
           WHERE ec.workspace_id = ${ws}::uuid AND ec.chave = n.chave AND ec.n_item = i.n_item
           ORDER BY ec.created_at DESC
           LIMIT 1
        ) cl ON true
       WHERE ${e(item)}
    ),
    notas_ok AS (
      SELECT * FROM notas_f n
       WHERE NOT ${filtraItem}::boolean OR EXISTS (SELECT 1 FROM itens_f i WHERE i.nota_id = n.id)
    )`;

  const [resumo] = await tx.$queryRaw<ResumoConsulta[]>`
    ${base}
    SELECT count(*)::int AS notas,
           (count(*) FILTER (WHERE NOT (${conta})))::int AS "foraDaSoma",
           (count(*) FILTER (WHERE ${conta} AND n.sentido = 'saida'))::int AS "notasSaida",
           COALESCE(sum(n.total) FILTER (WHERE ${conta} AND n.sentido = 'saida'), 0)::text AS saida,
           (count(*) FILTER (WHERE ${conta} AND n.sentido = 'entrada'))::int AS "notasEntrada",
           COALESCE(sum(n.total) FILTER (WHERE ${conta} AND n.sentido = 'entrada'), 0)::text AS entrada,
           COALESCE(sum(n.v_icms) FILTER (WHERE ${conta}), 0)::text AS "vIcms",
           COALESCE(sum(n.v_ipi) FILTER (WHERE ${conta}), 0)::text AS "vIpi",
           COALESCE(sum(n.v_pis) FILTER (WHERE ${conta}), 0)::text AS "vPis",
           COALESCE(sum(n.v_cofins) FILTER (WHERE ${conta}), 0)::text AS "vCofins",
           COALESCE(sum(n.total) FILTER (WHERE ${conta}), 0)::text AS total
      FROM notas_ok n`;

  const limite = MAX_LINHAS + 1;
  let rows: unknown[];
  let totalItens: Record<string, string> | null = null;

  if (ver === 'item') {
    rows = await tx.$queryRaw<unknown[]>`
      ${base}
      SELECT n.id::text AS "notaId", n.doc, n.emitente, n.estabelecimento, n.numero,
             to_char(n.data_emissao, 'YYYY-MM-DD') AS "dataEmissao", n.situacao, n.sentido,
             n.empresa, n.documento, i.n_item AS "nItem", i.c_prod AS codigo, i.x_prod AS descricao,
             i.ncm, i.servico, i.cfop, i.cfop_descricao AS "cfopDescricao",
             i.orig_icms AS origem, i.cst_icms AS cst, i.q_com::text AS quantidade, i.v_prod::text AS valor,
             i.v_bc_icms::text AS "bcIcms", i.p_icms::text AS "pIcms", i.v_icms::text AS "vIcms",
             i.p_ipi::text AS "pIpi", i.v_ipi::text AS "vIpi"
        FROM itens_f i
        JOIN notas_ok n ON n.id = i.nota_id
       ORDER BY n.data_emissao DESC, n.numero DESC NULLS LAST, i.n_item
       LIMIT ${limite}`;
    [totalItens] = await tx.$queryRaw<Record<string, string>[]>`
      ${base}
      SELECT count(*)::text AS itens,
             COALESCE(sum(i.v_prod), 0)::text AS valor,
             COALESCE(sum(i.v_bc_icms), 0)::text AS "bcIcms",
             COALESCE(sum(i.v_icms), 0)::text AS "vIcms",
             COALESCE(sum(i.v_ipi), 0)::text AS "vIpi"
        FROM itens_f i
        JOIN notas_ok n ON n.id = i.nota_id
       WHERE ${conta}`;
  } else if (ver === 'empresa') {
    rows = await tx.$queryRaw<unknown[]>`
      ${base}
      SELECT max(n.empresa) AS empresa, max(n.documento) AS documento, max(n.uf) AS uf,
             count(*)::int AS notas,
             COALESCE(sum(n.total) FILTER (WHERE n.sentido = 'saida'), 0)::text AS saida,
             COALESCE(sum(n.total) FILTER (WHERE n.sentido = 'entrada'), 0)::text AS entrada,
             sum(n.v_icms)::text AS "vIcms", sum(n.v_ipi)::text AS "vIpi",
             COALESCE(sum(n.v_pis), 0)::text AS "vPis", COALESCE(sum(n.v_cofins), 0)::text AS "vCofins"
        FROM notas_ok n
       WHERE ${conta}
       GROUP BY COALESCE(n.documento, upper(n.empresa), '')
       ORDER BY sum(n.total) DESC NULLS LAST
       LIMIT ${limite}`;
  } else if (ver === 'mes') {
    rows = await tx.$queryRaw<unknown[]>`
      ${base}
      SELECT to_char(n.data_emissao, 'YYYY-MM') AS mes,
             count(*)::int AS notas,
             COALESCE(sum(n.total) FILTER (WHERE n.sentido = 'saida'), 0)::text AS saida,
             COALESCE(sum(n.total) FILTER (WHERE n.sentido = 'entrada'), 0)::text AS entrada,
             sum(n.v_icms)::text AS "vIcms", sum(n.v_ipi)::text AS "vIpi",
             COALESCE(sum(n.v_pis), 0)::text AS "vPis", COALESCE(sum(n.v_cofins), 0)::text AS "vCofins"
        FROM notas_ok n
       WHERE ${conta}
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT ${limite}`;
  } else if (ver === 'cfop') {
    rows = await tx.$queryRaw<unknown[]>`
      ${base}
      SELECT i.cfop, max(i.cfop_descricao) AS descricao,
             count(DISTINCT i.nota_id)::int AS notas, count(*)::int AS itens,
             COALESCE(sum(i.v_prod), 0)::text AS valor,
             sum(i.v_icms)::text AS "vIcms", sum(i.v_ipi)::text AS "vIpi"
        FROM itens_f i
        JOIN notas_ok n ON n.id = i.nota_id
       WHERE ${conta}
       GROUP BY i.cfop
       ORDER BY sum(i.v_prod) DESC NULLS LAST
       LIMIT ${limite}`;
  } else {
    rows = await tx.$queryRaw<unknown[]>`
      ${base},
      agg AS (
        SELECT i.nota_id,
               string_agg(DISTINCT i.cfop, ', ') AS cfops,
               count(*)::int AS itens,
               (array_agg(i.x_prod ORDER BY i.n_item))[1] AS primeiro
          FROM itens i
         WHERE i.nota_id IN (SELECT id FROM notas_ok)
         GROUP BY i.nota_id
      )
      SELECT n.id::text AS id, n.doc, n.emitente, n.estabelecimento, n.chave, n.numero, n.serie,
             to_char(n.data_emissao, 'YYYY-MM-DD') AS "dataEmissao", n.situacao, n.resumo, n.sentido,
             n.natureza, n.empresa, n.documento, n.uf, n.transferencia,
             a.cfops, COALESCE(a.itens, 0) AS itens, a.primeiro AS "primeiroItem",
             n.total::text AS total, n.v_icms::text AS "vIcms", n.v_ipi::text AS "vIpi",
             n.v_pis::text AS "vPis", n.v_cofins::text AS "vCofins", n.v_iss::text AS "vIss"
        FROM notas_ok n
        LEFT JOIN agg a ON a.nota_id = n.id
       ORDER BY n.data_emissao DESC, n.numero DESC NULLS LAST
       LIMIT ${limite}`;
  }

  const truncado = rows.length > MAX_LINHAS;
  return {
    inicio,
    fim,
    ver,
    resumo,
    totalItens,
    truncado,
    rows: truncado ? rows.slice(0, MAX_LINHAS) : rows,
  };
}
