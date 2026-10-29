// Carga da classificação das notas de entrada controlada em planilha
// (docs/console-fiscal.md, decisão 7.8) pro Console fiscal. Lê os CSV do
// controle mensal (coluna "Aplicação" por item), acha cada nota no CRM e
// grava a classificação de cada item no histórico, com origem "planilha".
//
//   node_modules\.bin\ts-node scripts/importar-classificacao-entradas.ts "C:\...\Entradas 02-2026.csv" ...
//   node_modules\.bin\ts-node scripts/importar-classificacao-entradas.ts --aplicar "C:\...\Entradas 02-2026.csv"
//
// Sem --aplicar só confere e mostra o que faria. Aceita os dois formatos de
// planilha que existem: o antigo ("Número Nota;Razão social;...;APLICAÇÃO",
// itens na ordem da nota) e o do relatório do eGestor ("estabelecimento;
// tp_nf;numero_nfe;...;item_n;...;Aplicação"). A nota é achada pelo número
// e pela data (e pelo estabelecimento, quando a planilha traz); o item,
// pelo número do item ou pela ordem, e o CFOP tem que bater. Rodar de novo
// não duplica: item que já está com a mesma classe fica como está.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { basename } from 'path';
import * as iconv from 'iconv-lite';

const WORKSPACE_SLUG = 'gama';
// Mesmo ator "sistema" da carga das notas.
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

// Rótulo da planilha (sem acento, minúsculo) → código gravado no banco.
const CLASSES: Record<string, string> = {
  revenda: 'revenda',
  industrializacao: 'industrializacao',
  'mat.aplic.servico': 'mat-aplic-servico',
  imobilizado: 'imobilizado',
  'uso e consumo': 'uso-consumo',
  viagem: 'viagem',
  remessa: 'remessa',
  retorno: 'retorno',
  transferencia: 'transferencia',
  devolucao: 'devolucao',
  icms: 'icms',
  cancelada: 'cancelada',
  desconhecimento: 'desconhecimento',
};

interface LinhaPlanilha {
  arquivo: string;
  linha: number;
  estabelecimento: string | null;
  numero: number;
  data: string;
  nItem: number | null;
  cfop: string;
  descricao: string;
  classe: string;
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// O Excel salva CSV em codificações diferentes conforme a opção escolhida;
// vale a que lê o cabeçalho da coluna de aplicação direito.
function lerTexto(caminho: string): string {
  const bruto = readFileSync(caminho);
  for (const codificacao of ['utf8', 'cp850', 'win1252']) {
    const texto = iconv.decode(bruto, codificacao).replace(/^\uFEFF/, '');
    if (/APLICA[ÇC][ÃA]O/i.test(texto)) return texto;
  }
  throw new Error(`${basename(caminho)}: não achei a coluna "Aplicação".`);
}

// Quebra o CSV em registros respeitando aspas (a natureza da operação às
// vezes tem quebra de linha dentro).
function registros(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n') {
      linha.push(campo.replace(/\r$/, ''));
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo || linha.length) linhas.push([...linha, campo]);
  return linhas;
}

function lerPlanilha(caminho: string): LinhaPlanilha[] {
  const arquivo = basename(caminho);
  const linhas = registros(lerTexto(caminho));
  const iCabecalho = linhas.findIndex((l) =>
    l.some((c) => /^(N.mero Nota|numero_nfe)$/i.test(c.trim())),
  );
  if (iCabecalho < 0) throw new Error(`${arquivo}: não achei o cabeçalho.`);
  const cab = linhas[iCabecalho].map((c) => semAcento(c.trim()).toLowerCase());
  const col = (...nomes: string[]) => cab.findIndex((c) => nomes.includes(c));
  const formatoEgestor = cab.includes('numero_nfe');
  const c = {
    estabelecimento: col('estabelecimento'),
    numero: col('numero nota', 'numero_nfe'),
    data: col('data nf', 'dhemi'),
    nItem: col('item_n'),
    cfop: col('cfop'),
    descricao: col('descricao do item', 'item_xprod'),
    classe: col('aplicacao'),
  };
  if ([c.numero, c.data, c.cfop, c.classe].some((i) => i < 0)) {
    throw new Error(
      `${arquivo}: faltam colunas (número, data, CFOP ou aplicação).`,
    );
  }

  const saida: LinhaPlanilha[] = [];
  linhas.slice(iCabecalho + 1).forEach((l, i) => {
    if (!l.some((x) => x.trim())) return;
    const [dia, mes, ano] = (l[c.data] ?? '').trim().split('/');
    saida.push({
      arquivo,
      linha: iCabecalho + i + 2,
      estabelecimento: formatoEgestor
        ? (l[c.estabelecimento] ?? '').trim().toLowerCase() || null
        : null,
      numero: Number((l[c.numero] ?? '').trim()),
      data: `${ano}-${mes}-${dia}`,
      nItem: formatoEgestor ? Number((l[c.nItem] ?? '').trim()) || null : null,
      cfop: (l[c.cfop] ?? '').trim(),
      descricao: (l[c.descricao] ?? '').trim(),
      classe: (l[c.classe] ?? '').trim(),
    });
  });
  return saida;
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const arquivos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (arquivos.length === 0)
    throw new Error('Informe os CSV da planilha de controle.');

  const linhas = arquivos.flatMap(lerPlanilha);
  const problemas: string[] = [];

  // Agrupa por nota, mantendo a ordem dos itens da planilha.
  const notas = new Map<string, LinhaPlanilha[]>();
  for (const l of linhas) {
    const classe = CLASSES[semAcento(l.classe).toLowerCase()];
    if (!classe) {
      problemas.push(
        `${l.arquivo}:${l.linha} NF ${l.numero} — aplicação desconhecida "${l.classe}"`,
      );
      continue;
    }
    const chave = `${l.estabelecimento ?? ''}|${l.numero}|${l.data}`;
    notas.set(chave, [...(notas.get(chave) ?? []), { ...l, classe }]);
  }

  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });

    const resultado = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT
          set_config('app.current_user_id', ${SYSTEM_ACTOR_USER_ID}, true),
          set_config('app.current_workspace_id', ${workspace.id}, true),
          set_config('app.current_role', 'owner', true)`;

        // Notas de entrada do CRM nas datas da planilha — o mesmo universo
        // da tela (recebida autorizada e NF-e de entrada própria).
        const datas = [...new Set(linhas.map((l) => l.data))];
        const doCrm = await tx.$queryRaw<
          {
            chave: string;
            estabelecimento: string;
            numero: number;
            data: string;
            nItem: number;
            cfop: string | null;
          }[]
        >`
          WITH notas AS (
            SELECT n.id, n.chave, n.estabelecimento::text AS estabelecimento, n.numero, n.data_emissao
              FROM fiscal_nfe_recebida n
             WHERE n.situacao = 'autorizada' AND n.data_emissao = ANY(${datas}::date[])
            UNION ALL
            SELECT e.id, e.chave, e.estabelecimento::text, e.numero, e.data_emissao
              FROM fiscal_nfe_emitida e
             WHERE e.situacao = 'autorizada' AND e.sentido = 'entrada' AND e.chave IS NOT NULL
               AND e.data_emissao = ANY(${datas}::date[])
          )
          SELECT n.chave, n.estabelecimento, n.numero, to_char(n.data_emissao, 'YYYY-MM-DD') AS data,
                 i.n_item AS "nItem", i.cfop
            FROM notas n
            JOIN (SELECT nfe_id, n_item, cfop FROM fiscal_nfe_recebida_item
                  UNION ALL SELECT nfe_id, n_item, cfop FROM fiscal_nfe_emitida_item) i ON i.nfe_id = n.id
           ORDER BY n.chave, i.n_item`;
        const porNota = new Map<string, typeof doCrm>();
        for (const x of doCrm)
          porNota.set(x.chave, [...(porNota.get(x.chave) ?? []), x]);

        const atuais = await tx.$queryRaw<
          { chave: string; nItem: number; classe: string | null }[]
        >`
          SELECT DISTINCT ON (chave, n_item) chave, n_item AS "nItem", classe
            FROM fiscal_entrada_classificacao
           ORDER BY chave, n_item, created_at DESC`;
        const atual = new Map(
          atuais.map((a) => [`${a.chave}|${a.nItem}`, a.classe]),
        );

        const gravar: { chave: string; nItem: number; classe: string }[] = [];
        let iguais = 0;
        let notasCasadas = 0;
        for (const itensPlanilha of notas.values()) {
          const p = itensPlanilha[0];
          const ref = `${p.arquivo}:${p.linha} NF ${p.numero} de ${p.data}`;
          const candidatas = [...porNota.values()].filter(
            (itens) =>
              itens[0].numero === p.numero &&
              itens[0].data === p.data &&
              (!p.estabelecimento ||
                itens[0].estabelecimento === p.estabelecimento),
          );
          if (candidatas.length !== 1) {
            problemas.push(
              `${ref} — ${candidatas.length === 0 ? 'não está no CRM' : 'mais de uma nota com esse número e data'}`,
            );
            continue;
          }
          const itensCrm = candidatas[0];
          if (!p.nItem && itensCrm.length !== itensPlanilha.length) {
            problemas.push(
              `${ref} — a planilha tem ${itensPlanilha.length} item(ns) e a nota tem ${itensCrm.length}`,
            );
            continue;
          }
          const pares = itensPlanilha.map((l, i) => ({
            l,
            crm: l.nItem
              ? itensCrm.find((x) => x.nItem === l.nItem)
              : itensCrm[i],
          }));
          const errado = pares.find(
            ({ l, crm }) => !crm || (l.cfop !== '' && crm.cfop !== l.cfop),
          );
          if (errado) {
            problemas.push(
              `${ref} — item ${errado.l.nItem ?? pares.indexOf(errado) + 1} não confere (CFOP ${errado.l.cfop} na planilha, ${errado.crm?.cfop ?? 'sem item'} na nota)`,
            );
            continue;
          }
          notasCasadas++;
          for (const { l, crm } of pares) {
            if (atual.get(`${crm!.chave}|${crm!.nItem}`) === l.classe) iguais++;
            else
              gravar.push({
                chave: crm!.chave,
                nItem: crm!.nItem,
                classe: l.classe,
              });
          }
        }

        if (aplicar && gravar.length > 0) {
          await tx.fiscalEntradaClassificacao.createMany({
            data: gravar.map((g) => ({
              workspaceId: workspace.id,
              chave: g.chave,
              nItem: g.nItem,
              classe: g.classe,
              origem: 'planilha',
              userId: SYSTEM_ACTOR_USER_ID,
            })),
          });
        }
        return { notasCasadas, gravar: gravar.length, iguais };
      },
      { timeout: 60_000 },
    );

    console.log(
      `\n${linhas.length} linha(s) de ${arquivos.length} planilha(s), ${notas.size} nota(s).`,
    );
    console.log(`  notas encontradas no CRM: ${resultado.notasCasadas}`);
    console.log(
      `  itens ${aplicar ? 'gravados' : 'a gravar'}: ${resultado.gravar}`,
    );
    console.log(
      `  itens que já estavam com a mesma classificação: ${resultado.iguais}`,
    );
    console.log(`  problemas: ${problemas.length}`);
    for (const p of problemas) console.log(`    ${p}`);
    if (!aplicar) console.log('\nNada foi gravado (rode com --aplicar).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
