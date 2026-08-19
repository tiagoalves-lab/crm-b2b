// Script ad-hoc (pedido do usuário, 2026-08-11): preenche automaticamente
// campos divergentes onde só um lado (Matriz OU Filial) tem dado e o outro
// está em branco — ex.: UF preenchida na Matriz e vazia na Filial. Não
// mexe em divergência de verdade (os dois lados com dado, só diferente) —
// essas continuam precisando do "Corrigir" manual na tela (Integração
// eGestor), porque exigem julgamento de qual lado está certo.
//
// Levantamento prévio (SQL read-only via Supabase, 2026-08-11): 86 linhas
// `ambos_diferentes`, 42 têm pelo menos 1 campo-lacuna (52 campos no
// total), 28 ficam 100% resolvidas só com isso, 14 continuam parcialmente
// divergentes (mistura de lacuna + conflito real), 44 são só conflito
// real (não têm lacuna nenhuma, ficam de fora).
//
// Sempre roda em modo SIMULAÇÃO por padrão — só imprime o que faria. Só
// grava de verdade no eGestor de produção com `--apply` explícito.
//
//   npx ts-node scripts/egestor-preencher-gaps.ts                       # dry-run no console
//   npx ts-node scripts/egestor-preencher-gaps.ts --csv=saida.csv       # dry-run, exporta CSV (só leitura, nunca grava)
//   npx ts-node scripts/egestor-preencher-gaps.ts --apply                # grava de verdade
//
// Decisão do usuário em 2026-08-11: risco alto demais pra automatizar em
// lote (eGestor tem outras integrações — pedido de venda, nota fiscal —
// que um PUT em massa poderia afetar de um jeito não previsto aqui). Modo
// `--apply` fica no script só de referência; o fluxo real passou a ser
// revisão manual campo a campo via `--csv`, tratando um registro por vez
// na tela (Integração eGestor → Corrigir).
//
// Reaproveita EgestorContatoCorrectionService#aplicarCorrecaoNoEgestor
// (mesmo código testado e já em produção pela tela) — só decide, campo a
// campo, qual direção usar, em vez do usuário escolher uma direção única
// pra linha inteira.

import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { EgestorContatoConsolidado, Prisma } from '@prisma/client';
import { EgestorContatoStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { EgestorContatoCorrectionService } from '../src/integrations/egestor/egestor-contato-correction.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';

const WORKSPACE_SLUG = 'gama';
const CSV_ARG = process.argv.find((arg) => arg.startsWith('--csv='));
const CSV_PATH = CSV_ARG ? CSV_ARG.slice('--csv='.length) : undefined;
// `--csv` é sempre só leitura, mesmo se alguém colar `--apply` junto por
// engano — nunca combina export com escrita no mesmo comando.
const APLICAR = process.argv.includes('--apply') && !CSV_PATH;

function csvEscape(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = Array.isArray(valor) ? JSON.stringify(valor) : String(valor);
  if (/[",\n;]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function vazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'string') return valor.trim() === '';
  if (Array.isArray(valor)) return valor.length === 0;
  return false;
}

interface Classificacao {
  paraFilial: string[]; // Matriz tem dado, Filial vazia → copia Matriz → Filial
  paraMatriz: string[]; // Filial tem dado, Matriz vazia → copia Filial → Matriz
  conflitosReais: string[]; // os dois lados têm dado (só diferente) — fica de fora
}

function classificar(row: EgestorContatoConsolidado): Classificacao {
  const dadosMatriz = (row.dadosMatriz ?? {}) as Record<string, unknown>;
  const dadosFilial = (row.dadosFilial ?? {}) as Record<string, unknown>;
  const paraFilial: string[] = [];
  const paraMatriz: string[] = [];
  const conflitosReais: string[] = [];

  for (const campo of row.camposDiferentes) {
    const matrizVazia = vazio(dadosMatriz[campo]);
    const filialVazia = vazio(dadosFilial[campo]);
    if (filialVazia && !matrizVazia) paraFilial.push(campo);
    else if (matrizVazia && !filialVazia) paraMatriz.push(campo);
    else conflitosReais.push(campo);
  }

  return { paraFilial, paraMatriz, conflitosReais };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const tenantContext = app.get(TenantContextService);
  const correction = app.get(EgestorContatoCorrectionService);

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { slug: WORKSPACE_SLUG },
  });
  // `memberships` também tem RLS por workspace (só falta `userId`, que é
  // exatamente o que este passo busca) — abre uma transação avulsa só pra
  // isso, igual ao helper `withWorkspace()` de prisma/seed.ts.
  const owner = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_workspace_id = '${workspace.id}'`,
    );
    return tx.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id, role: 'owner' },
    });
  });
  const ctx = {
    userId: owner.userId,
    workspaceId: workspace.id,
    role: owner.role,
  };

  const rows = await tenantContext.run(ctx, (tx) =>
    tx.egestorContatoConsolidado.findMany({
      where: {
        workspaceId: workspace.id,
        status: EgestorContatoStatus.ambos_diferentes,
      },
      orderBy: { cpfCnpj: 'asc' },
    }),
  );

  console.log(
    `${rows.length} linha(s) "ambos_diferentes" encontrada(s). Modo: ${
      CSV_PATH
        ? `EXPORT CSV (só leitura, nada é gravado) → ${CSV_PATH}`
        : APLICAR
          ? 'APLICAR (grava no eGestor de produção)'
          : 'SIMULAÇÃO (dry-run, nada é gravado)'
    }\n`,
  );

  if (CSV_PATH) {
    const linhasCsv: string[] = [
      [
        'cpf_cnpj',
        'contato_id',
        'codigo_matriz',
        'codigo_filial',
        'nome_matriz',
        'nome_filial',
        'campo',
        'valor_matriz',
        'valor_filial',
        'classificacao',
      ].join(';'),
    ];

    for (const row of rows) {
      if (!row.dadosMatriz || !row.dadosFilial) continue;
      const { paraFilial, paraMatriz } = classificar(row);
      const dadosMatriz = row.dadosMatriz as Record<string, unknown>;
      const dadosFilial = row.dadosFilial as Record<string, unknown>;

      for (const campo of row.camposDiferentes) {
        const classificacao = paraFilial.includes(campo)
          ? 'preencher_filial_com_matriz'
          : paraMatriz.includes(campo)
            ? 'preencher_matriz_com_filial'
            : 'conflito_real_revisar';
        linhasCsv.push(
          [
            csvEscape(row.cpfCnpj),
            csvEscape(row.id),
            csvEscape(row.codigoMatriz),
            csvEscape(row.codigoFilial),
            csvEscape(row.nomeMatriz),
            csvEscape(row.nomeFilial),
            csvEscape(campo),
            csvEscape(dadosMatriz[campo]),
            csvEscape(dadosFilial[campo]),
            classificacao,
          ].join(';'),
        );
      }
    }

    writeFileSync(CSV_PATH, linhasCsv.join('\n') + '\n', 'utf-8');
    console.log(`${linhasCsv.length - 1} linha(s) de campo divergente exportada(s) — nenhuma escrita no banco ou no eGestor.`);
    await app.close();
    return;
  }

  let linhasComLacuna = 0;
  let camposPrevistos = 0; // previsto (dry-run) OU realmente enviado (apply, contado antes do resultado)
  let linhasQueFicariamResolvidas = 0; // previsão, calculada sempre
  let linhasResolvidasComSucesso = 0; // só em --apply, só depois do update confirmar
  let falhas = 0;

  for (const row of rows) {
    if (!row.codigoMatriz || !row.codigoFilial || !row.dadosMatriz || !row.dadosFilial) {
      continue; // mesma validação de buscarParaCorrecao — não deveria acontecer em ambos_diferentes
    }

    const { paraFilial, paraMatriz, conflitosReais } = classificar(row);
    if (paraFilial.length === 0 && paraMatriz.length === 0) continue; // só conflito real, fora do escopo

    linhasComLacuna++;
    console.log(`${row.cpfCnpj} (Matriz #${row.codigoMatriz} / Filial #${row.codigoFilial})`);
    if (paraFilial.length > 0) console.log(`  Filial ← Matriz: ${paraFilial.join(', ')}`);
    if (paraMatriz.length > 0) console.log(`  Matriz ← Filial: ${paraMatriz.join(', ')}`);
    if (conflitosReais.length > 0) {
      console.log(`  (conflito real, fica divergente): ${conflitosReais.join(', ')}`);
    }

    // Previsão pro resumo — vale pros dois modos, é o que este script
    // pretende fazer nesta linha (em dry-run, é só isso mesmo).
    camposPrevistos += paraFilial.length + paraMatriz.length;
    if (conflitosReais.length === 0) linhasQueFicariamResolvidas++;

    if (!APLICAR) continue;

    try {
      let dadosFilialAtualizados = row.dadosFilial as Prisma.InputJsonValue;
      let dadosMatrizAtualizados = row.dadosMatriz as Prisma.InputJsonValue;
      let nomeFilial = row.nomeFilial;
      let nomeMatriz = row.nomeMatriz;

      if (paraFilial.length > 0) {
        const resultado = await correction.aplicarCorrecaoNoEgestor(
          row,
          'matriz_para_filial',
          paraFilial,
        );
        dadosFilialAtualizados = resultado.dadosDestinoAtualizados as Prisma.InputJsonValue;
        nomeFilial = resultado.dadosDestinoAtualizados.nome
          ? String(resultado.dadosDestinoAtualizados.nome)
          : nomeFilial;
      }
      if (paraMatriz.length > 0) {
        const resultado = await correction.aplicarCorrecaoNoEgestor(
          row,
          'filial_para_matriz',
          paraMatriz,
        );
        dadosMatrizAtualizados = resultado.dadosDestinoAtualizados as Prisma.InputJsonValue;
        nomeMatriz = resultado.dadosDestinoAtualizados.nome
          ? String(resultado.dadosDestinoAtualizados.nome)
          : nomeMatriz;
      }

      const status =
        conflitosReais.length === 0
          ? EgestorContatoStatus.ambos_iguais
          : EgestorContatoStatus.ambos_diferentes;

      await tenantContext.run(ctx, (tx) =>
        tx.egestorContatoConsolidado.update({
          where: { id: row.id },
          data: {
            status,
            camposDiferentes: conflitosReais,
            dadosMatriz: dadosMatrizAtualizados as Prisma.InputJsonValue,
            dadosFilial: dadosFilialAtualizados as Prisma.InputJsonValue,
            nomeMatriz,
            nomeFilial,
          },
        }),
      );
      if (status === EgestorContatoStatus.ambos_iguais) linhasResolvidasComSucesso++;
      console.log('  ✓ gravado no eGestor e no espelho local');
    } catch (err) {
      falhas++;
      console.error(`  ✗ erro: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    APLICAR
      ? `\n${linhasComLacuna} linha(s) com lacuna, ${linhasResolvidasComSucesso} linha(s) totalmente resolvida(s) com sucesso, ${falhas} falha(s).`
      : `\n${linhasComLacuna} linha(s) com lacuna preenchível, ${camposPrevistos} campo(s) que seriam preenchidos, ${linhasQueFicariamResolvidas} linha(s) ficariam totalmente resolvidas.`,
  );
  if (!APLICAR) {
    console.log('Simulação apenas — rode de novo com --apply pra gravar de verdade no eGestor.');
  }

  await app.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
