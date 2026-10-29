// Revisão das tags de clientes, prospects e leads convertidos (pedido do
// usuário, 2026-10-29): exporta uma planilha com as tags de hoje e uma
// coluna "Tags novas" em branco; o usuário preenche e a mesma planilha
// volta pro banco.
//
//   node_modules\.bin\ts-node scripts/tags-revisao.ts exportar <saida.xlsx> [nomes.json]
//
// nomes.json é opcional ({ "<user_id>": "Nome" }) — o nome do representante
// vive no Supabase Auth, fora do alcance da role do backend.
//
// Universo (régua de cliente da decisão 6.23, src/companies/cliente-regra.ts):
//   Clientes          → empresa que já comprou (pedido no eGestor ou
//                       oportunidade ganha), uma linha por empresa.
//   Prospects         → lead em triagem (status novo) cuja empresa não
//                       comprou, uma linha por lead.
//   Leads convertidos → lead convertido (status aprovado) cuja empresa não
//                       comprou, uma linha por lead.
// Descartados ficam de fora.
//
// "Tags atuais" junta as tags do lead com as da empresa dele, sem os
// marcadores de sistema ("lead-triagem" e "cliente"), que o código usa e
// nenhuma revisão mexe.
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { readFileSync } from 'fs';

const WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';
export const TAGS_SISTEMA = ['lead-triagem', 'cliente'];

const ETAPA_ROTULO: Record<string, string> = {
  entrada: 'Entrada',
  andamento: 'Andamento',
  reuniao: 'Reunião',
  qualificado: 'Qualificado',
  negociacao: 'Negociação',
};

type Linha = {
  id: string;
  empresa: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  owner: string | null;
  etapa: string | null;
  fonte: string | null;
  segmento: string | null;
  curva: string | null;
  tags: string[];
};

function tagsDeUsuario(tags: string[]): string[] {
  const vistas = new Set<string>();
  return tags
    .map((t) => t.trim())
    .filter((t) => t && !TAGS_SISTEMA.includes(t))
    .filter((t) => (vistas.has(t.toLowerCase()) ? false : vistas.add(t.toLowerCase())))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function exportar(saida: string, arquivoNomes?: string) {
  const nomes: Record<string, string> = arquivoNomes
    ? JSON.parse(readFileSync(arquivoNomes, 'utf8'))
    : {};
  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });
    const { clientes, prospects, convertidos } = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT
          set_config('app.current_user_id', ${SYSTEM_ACTOR_USER_ID}, true),
          set_config('app.current_workspace_id', ${workspace.id}, true),
          set_config('app.current_role', 'owner', true)`;

        const compra = `
          SELECT company_id FROM sales_history WHERE workspace_id = $1::uuid
          UNION SELECT company_id FROM opportunities WHERE workspace_id = $1::uuid AND status = 'won'`;

        const clientes = await tx.$queryRawUnsafe<Linha[]>(
          `SELECT c.id::text,
                  COALESCE(NULLIF(c.fantasia, ''), c.razao_social, '(sem nome)') AS empresa,
                  c.cpf_cnpj AS cnpj, c.cidade, c.uf::text AS uf,
                  c.owner_user_id::text AS owner, NULL AS etapa, NULL AS fonte,
                  NULL AS segmento, c.curva_abc::text AS curva,
                  c.tags || COALESCE((SELECT array_agg(t) FROM raw_leads r, unnest(r.tags) t
                                       WHERE r.promoted_company_id = c.id), '{}') AS tags
             FROM companies c
            WHERE c.workspace_id = $1::uuid AND c.deleted_at IS NULL
              AND c.id IN (${compra})
            ORDER BY 2`,
          workspace.id,
        );

        const leads = (status: string) =>
          tx.$queryRawUnsafe<Linha[]>(
            `SELECT r.id::text,
                    COALESCE(NULLIF(c.fantasia, ''), c.razao_social, r.razao_social) AS empresa,
                    COALESCE(r.cnpj, c.cpf_cnpj) AS cnpj,
                    COALESCE(r.municipio, c.cidade) AS cidade,
                    COALESCE(r.uf, c.uf)::text AS uf,
                    r.owner_user_id::text AS owner, r.etapa::text AS etapa,
                    r.fonte::text AS fonte, r.segmento, NULL AS curva,
                    r.tags || COALESCE(c.tags, '{}') AS tags
               FROM raw_leads r
               LEFT JOIN companies c ON c.id = r.promoted_company_id
              WHERE r.workspace_id = $1::uuid AND r.status = '${status}'
                AND (r.promoted_company_id IS NULL
                     OR r.promoted_company_id NOT IN (${compra}))
              ORDER BY 2`,
            workspace.id,
          );

        return {
          clientes,
          prospects: await leads('novo'),
          convertidos: await leads('aprovado'),
        };
      },
      { timeout: 120_000 },
    );

    const wb = new ExcelJS.Workbook();
    const leia = wb.addWorksheet('Como preencher');
    const abas: [string, Linha[], 'cliente' | 'lead'][] = [
      ['Clientes', clientes, 'cliente'],
      ['Prospects', prospects, 'lead'],
      ['Leads convertidos', convertidos, 'lead'],
    ];
    const contagem = new Map<string, Record<string, number>>();

    for (const [nome, linhas, tipo] of abas) {
      const ws = wb.addWorksheet(nome, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      const meio =
        tipo === 'cliente'
          ? [{ header: 'Curva ABC', key: 'curva', width: 10 }]
          : [
              { header: 'Etapa', key: 'etapa', width: 13 },
              { header: 'Origem', key: 'fonte', width: 12 },
              { header: 'Segmento', key: 'segmento', width: 22 },
            ];
      ws.columns = [
        { header: 'Empresa', key: 'empresa', width: 42 },
        { header: 'CNPJ', key: 'cnpj', width: 20 },
        { header: 'Cidade', key: 'cidade', width: 22 },
        { header: 'UF', key: 'uf', width: 5 },
        { header: 'Representante', key: 'owner', width: 20 },
        ...meio,
        { header: 'Tags atuais', key: 'tags', width: 45 },
        { header: 'Tags novas', key: 'novas', width: 45 },
        { header: 'ID (não mexer)', key: 'id', width: 38 },
      ];
      for (const l of linhas) {
        const tags = tagsDeUsuario(l.tags ?? []);
        for (const t of tags) {
          const c = contagem.get(t) ?? {};
          c[nome] = (c[nome] ?? 0) + 1;
          contagem.set(t, c);
        }
        ws.addRow({
          ...l,
          owner: l.owner ? (nomes[l.owner] ?? 'sem nome') : 'sem dono',
          etapa: l.etapa ? (ETAPA_ROTULO[l.etapa] ?? l.etapa) : null,
          tags: tags.join('; '),
          novas: '',
        });
      }
      const cab = ws.getRow(1);
      cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cab.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
      });
      const colNovas = ws.getColumn('novas');
      colNovas.eachCell((cell, n) => {
        if (n === 1) return;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6D5' } };
      });
      ws.getCell(1, colNovas.number).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFB7791F' },
      };
      ws.getColumn('id').font = { color: { argb: 'FF9AA3AE' }, size: 9 };
      ws.getCell(1, ws.getColumn('id').number).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    }

    const resumo = wb.addWorksheet('Resumo das tags', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    resumo.columns = [
      { header: 'Tag', key: 'tag', width: 34 },
      ...abas.map(([n]) => ({ header: n, key: n, width: 18 })),
      { header: 'Total', key: 'total', width: 10 },
      { header: 'Vira (sugestão de troca)', key: 'vira', width: 34 },
    ];
    const ordenadas = [...contagem.entries()]
      .map(([tag, c]) => ({ tag, ...c, total: Object.values(c).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);
    for (const r of ordenadas) resumo.addRow(r);
    resumo.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    resumo.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    });

    leia.getColumn(1).width = 110;
    [
      'COMO PREENCHER',
      '',
      '• Escreva as tags na coluna amarela "Tags novas", separadas por ponto e vírgula. Ex.: Feira 2025; Serra Gaúcha',
      '• A coluna "Tags novas" SUBSTITUI as tags atuais da linha inteira (o que não estiver lá some).',
      '• Linha com "Tags novas" em branco fica como está. Para apagar todas as tags da linha, escreva: (limpar)',
      '• Atalho: na aba "Resumo das tags", a coluna "Vira" troca uma tag por outra em TODAS as linhas de uma vez.',
      '  Ex.: tag "Região A" → Vira "Serra Gaúcha". Para eliminar a tag em todo lugar, escreva: (apagar)',
      '  Se a linha também tiver "Tags novas" preenchida, vale o que estiver na linha.',
      '• Não mexa na coluna "ID" nem renomeie as abas.',
      '• Marcadores internos do sistema (lead-triagem e cliente do eGestor) não aparecem aqui e são preservados.',
    ].forEach((t, i) => {
      const row = leia.addRow([t]);
      if (i === 0) row.font = { bold: true, size: 13 };
    });

    await wb.xlsx.writeFile(saida);
    console.log(
      `Clientes: ${clientes.length} | Prospects: ${prospects.length} | Leads convertidos: ${convertidos.length} | Tags distintas: ${contagem.size}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const [modo, ...args] = process.argv.slice(2);
  if (modo === 'exportar' && args[0]) return exportar(args[0], args[1]);
  console.error('Uso: tags-revisao.ts exportar <saida.xlsx> [nomes.json]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
