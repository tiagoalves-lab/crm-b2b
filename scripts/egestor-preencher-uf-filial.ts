// Script ad-hoc de escopo mínimo (pedido do usuário, 2026-08-11, depois de
// decidir NÃO rodar o lote completo de egestor-preencher-gaps.ts por
// segurança — eGestor tem outras integrações, pedido de venda/nota
// fiscal, risco alto demais em lote). Só copia UF da Matriz pra Filial
// quando a Filial está com UF em branco — 1 campo, 1 direção só, ~25
// casos (ver docs/egestor-preencher-gaps.csv, classificacao =
// preencher_filial_com_matriz, campo = uf).
//
// Mesmos 3 modos do script geral, mesma regra de segurança (default
// nunca grava, `--csv` é sempre só leitura mesmo que `--apply` venha
// junto por engano):
//
//   npx ts-node scripts/egestor-preencher-uf-filial.ts                      # dry-run no console
//   npx ts-node scripts/egestor-preencher-uf-filial.ts --csv=arquivo.csv    # dry-run, exporta CSV (só leitura)
//   npx ts-node scripts/egestor-preencher-uf-filial.ts --apply              # grava de verdade no eGestor (Filial) + espelho local
//
// Reaproveita EgestorContatoCorrectionService#aplicarCorrecaoNoEgestor
// (mesmo código testado, já em produção pela tela "Corrigir" e validado
// contra o contato #1180) — só que fixo em `campos: ['uf']` e direção
// `matriz_para_filial`.

import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { EgestorContatoStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { EgestorContatoCorrectionService } from '../src/integrations/egestor/egestor-contato-correction.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';

const WORKSPACE_SLUG = 'gama';
const CAMPO = 'uf';
const CSV_ARG = process.argv.find((arg) => arg.startsWith('--csv='));
const CSV_PATH = CSV_ARG ? CSV_ARG.slice('--csv='.length) : undefined;
// `--csv` é sempre só leitura, mesmo se `--apply` vier junto por engano.
const APLICAR = process.argv.includes('--apply') && !CSV_PATH;

function vazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'string') return valor.trim() === '';
  return false;
}

function csvEscape(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (/[",\n;]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
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
  const owner = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_workspace_id = '${workspace.id}'`,
    );
    return tx.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id, role: 'owner' },
    });
  });
  const ctx = { userId: owner.userId, workspaceId: workspace.id, role: owner.role };

  const rows = await tenantContext.run(ctx, (tx) =>
    tx.egestorContatoConsolidado.findMany({
      where: {
        workspaceId: workspace.id,
        status: EgestorContatoStatus.ambos_diferentes,
        camposDiferentes: { has: CAMPO },
      },
      orderBy: { cpfCnpj: 'asc' },
    }),
  );

  // Filtra só o caso exato: Matriz tem UF, Filial está em branco. Fora
  // disso (Filial tem UF diferente da Matriz, ou os dois em branco) é
  // conflito real ou situação estranha — não entra no escopo deste script.
  const alvos = rows.filter((row) => {
    if (!row.dadosMatriz || !row.dadosFilial) return false;
    const uMatriz = (row.dadosMatriz as Record<string, unknown>)[CAMPO];
    const uFilial = (row.dadosFilial as Record<string, unknown>)[CAMPO];
    return !vazio(uMatriz) && vazio(uFilial);
  });

  console.log(
    `${rows.length} linha(s) divergente(s) em "${CAMPO}", ${alvos.length} no escopo (Filial em branco, Matriz preenchida). Modo: ${
      CSV_PATH
        ? `EXPORT CSV (só leitura, nada é gravado) → ${CSV_PATH}`
        : APLICAR
          ? 'APLICAR (grava no eGestor de produção)'
          : 'SIMULAÇÃO (dry-run, nada é gravado)'
    }\n`,
  );

  if (CSV_PATH) {
    const linhasCsv = [
      ['cpf_cnpj', 'contato_id', 'codigo_matriz', 'codigo_filial', 'nome_matriz', 'nome_filial', 'uf_matriz', 'uf_filial_atual'].join(';'),
      ...alvos.map((row) =>
        [
          csvEscape(row.cpfCnpj),
          csvEscape(row.id),
          csvEscape(row.codigoMatriz),
          csvEscape(row.codigoFilial),
          csvEscape(row.nomeMatriz),
          csvEscape(row.nomeFilial),
          csvEscape((row.dadosMatriz as Record<string, unknown>)[CAMPO]),
          csvEscape((row.dadosFilial as Record<string, unknown>)[CAMPO]),
        ].join(';'),
      ),
    ];
    writeFileSync(CSV_PATH, linhasCsv.join('\n') + '\n', 'utf-8');
    console.log(`${alvos.length} linha(s) exportada(s) — nenhuma escrita no banco ou no eGestor.`);
    await app.close();
    return;
  }

  let sucesso = 0;
  let falhas = 0;

  for (const row of alvos) {
    const uMatriz = (row.dadosMatriz as Record<string, unknown>)[CAMPO];
    console.log(`${row.cpfCnpj}  Filial #${row.codigoFilial} ← Matriz #${row.codigoMatriz}: uf = "${uMatriz}"`);

    if (!APLICAR) continue;

    try {
      const resultado = await correction.aplicarCorrecaoNoEgestor(row, 'matriz_para_filial', [CAMPO]);
      const novoCamposDiferentes = row.camposDiferentes.filter((c) => c !== CAMPO);
      const status =
        novoCamposDiferentes.length === 0
          ? EgestorContatoStatus.ambos_iguais
          : EgestorContatoStatus.ambos_diferentes;

      await tenantContext.run(ctx, (tx) =>
        tx.egestorContatoConsolidado.update({
          where: { id: row.id },
          data: {
            status,
            camposDiferentes: novoCamposDiferentes,
            dadosFilial: resultado.dadosDestinoAtualizados as Prisma.InputJsonValue,
          },
        }),
      );
      sucesso++;
      console.log('  ✓ gravado no eGestor (Filial) e no espelho local');
    } catch (err) {
      falhas++;
      console.error(`  ✗ erro: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    APLICAR
      ? `\n${sucesso} UF preenchida(s) com sucesso, ${falhas} falha(s), de ${alvos.length} no escopo.`
      : `\n${alvos.length} UF de Filial seriam preenchidas. Rode de novo com --apply pra gravar de verdade no eGestor.`,
  );

  await app.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
