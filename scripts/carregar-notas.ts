// Carga das notas do eGestor (NF-e e NFS-e emitidas e NF-e recebidas,
// Matriz e Filial) pro console fiscal — mesmo código do botão "Atualizar notas" da tela, só que
// disparado da linha de comando e esperando terminar (a primeira carga leva
// ~15 min: o eGestor libera uma chamada por segundo e cada NF-e é um XML).
// Ver docs/console-fiscal.md.
//
//   node_modules\.bin\ts-node scripts/carregar-notas.ts
//   node_modules\.bin\ts-node scripts/carregar-notas.ts --desde=2026-01-01
//   node_modules\.bin\ts-node scripts/carregar-notas.ts --so-recebidas --desde=2026-09-01
//
// --so-recebidas roda a mesma conferência de hora em hora do agendador
// (só NF-e recebidas, mais as antigas que ainda estão só em resumo).
//
// Incremental: rodar de novo só baixa nota nova ou que mudou de situação.
//
// Sobe só os módulos da carga, não o AppModule inteiro: o AppModule liga o
// agendador do resumo diário por e-mail (cron a cada minuto), que não tem
// nada que rodar dentro de um script.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../src/config/configuration';
import { validate } from '../src/config/env.validation';
import { FiscalNotasSyncService } from '../src/fiscal/fiscal-notas-sync.service';
import { FiscalModule } from '../src/fiscal/fiscal.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const WORKSPACE_SLUG = 'gama';
// Mesmo ator "sistema" da carga de vendas e do webhook do eGestor.
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', load: [configuration], validate }),
    PrismaModule,
    FiscalModule,
  ],
})
class CargaNotasModule {}

async function main() {
  const desdeArg = process.argv.find((a) => a.startsWith('--desde='))?.slice('--desde='.length);
  const desde = desdeArg ?? '2025-01-01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error('--desde deve ser AAAA-MM-DD');

  const app = await NestFactory.createApplicationContext(CargaNotasModule, {
    logger: ['error', 'warn', 'log'],
  });

  const sync = app.get(FiscalNotasSyncService);
  const progresso = setInterval(() => {
    const s = sync.status();
    if (s.emAndamento) console.log(`  ${s.etapa}: ${s.processadas}/${s.total}`);
  }, 30_000);

  try {
    const prisma = app.get(PrismaService);
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });

    const ctx = { userId: SYSTEM_ACTOR_USER_ID, workspaceId: workspace.id, role: 'owner' as const };

    if (process.argv.includes('--so-recebidas')) {
      const r = await sync.conferirRecebidas(ctx, { desde });
      console.log(`\nConferência das NF-e recebidas de ${r.desde} a ${r.ate} concluída.`);
      for (const [est, x] of Object.entries(r.porEstabelecimento)) {
        console.log(
          `  ${est}: ${x.recebidasListadas} listada(s) (${x.recebidasGravadas} gravada(s), ${x.recebidasInalteradas} sem mudança, ${x.recebidasSemXml} só resumo)`,
        );
      }
      console.log(`  falhas: ${r.falhas.length}`);
      return;
    }

    const r = await sync.executar(ctx, { desde });

    console.log(`\nCarga de ${r.desde} a ${r.ate} concluída.`);
    for (const [est, x] of Object.entries(r.porEstabelecimento)) {
      console.log(
        `  ${est}: NF-e emitidas ${x.nfeListadas} (${x.nfeGravadas} gravada(s), ${x.nfeInalteradas} sem mudança) | NFS-e ${x.nfseListadas} (${x.nfseGravadas} gravada(s)) | NF-e recebidas ${x.recebidasListadas} (${x.recebidasGravadas} gravada(s), ${x.recebidasInalteradas} sem mudança, ${x.recebidasSemXml} só resumo)`,
      );
    }
    console.log(`  falhas: ${r.falhas.length}`);
    for (const f of r.falhas) {
      console.log(`    ${f.estabelecimento} ${f.tipo} cód ${f.codEgestor} nº ${f.numero ?? '?'}: ${f.motivo.slice(0, 160)}`);
    }
  } finally {
    clearInterval(progresso);
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
