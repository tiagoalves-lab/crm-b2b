// Carga inicial do histórico de vendas do eGestor (raia "Vendas
// histórico" do roadmap) — mesmo caminho de código do botão "Sincronizar
// vendas" da tela Integração eGestor, só que disparado da linha de
// comando, sem precisar de um login owner/admin no navegador.
//
// Existe porque a primeira carga é uma operação de mão única feita uma
// vez: as rodadas seguintes acontecem sozinhas pelo webhook de vendas, e
// o botão da tela cobre o caso de reconciliar tudo de novo.
//
// Precisa do MESMO ambiente do backend em produção (Railway) — em especial
// SUPABASE_SERVICE_ROLE_KEY, que é o que permite casar vendedor do eGestor
// com membro do CRM (identidade vive em auth.users, ver
// SupabaseUserService). Por isso a forma correta de rodar é através do
// Railway, que injeta as variáveis sem nunca imprimi-las:
//
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/carregar-vendas-egestor.ts
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/carregar-vendas-egestor.ts --apply
//
// Sem --apply é SIMULAÇÃO: consulta as duas contas do eGestor e imprime o
// que entraria, sem escrever nada no banco (mesmo padrão de
// scripts/sanitizar-cadastros-cnpj.ts).
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { EgestorVendaSyncService } from '../src/integrations/egestor/egestor-venda-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import { EgestorInteractionLogService } from '../src/integrations/egestor/egestor-interaction-log.service';

const WORKSPACE_SLUG = 'gama';
// Mesmo ator "sistema" que o webhook usa quando não há membership real
// por trás da escrita (ver EgestorWebhookService).
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

async function main() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const tenantContext = app.get(TenantContextService);
    const vendas = app.get(EgestorVendaSyncService);
    const interactionLog = app.get(EgestorInteractionLogService);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId: workspace.id,
      role: 'owner' as const,
    };

    const membroUserIds = await tenantContext.run(ctx, (tx) =>
      tx.membership
        .findMany({
          where: { workspaceId: workspace.id },
          select: { userId: true },
        })
        .then((ms) => ms.map((m) => m.userId)),
    );
    console.log(`Membros do CRM considerados no de-para: ${membroUserIds.length}`);

    console.log('Consultando o eGestor (Matriz e Filial)…');
    const fetched = await vendas.fetch(membroUserIds);
    console.log(
      `Vendas retornadas — Matriz: ${fetched.totalMatriz}, Filial: ${fetched.totalFilial}, descartadas por falta de dado: ${fetched.descartadas}`,
    );
    if (fetched.vendedoresSemMembro.length > 0) {
      console.log(
        `Vendedores sem membro correspondente no CRM: ${fetched.vendedoresSemMembro.join(', ')}`,
      );
    }
    const comVinculo = fetched.vendas.filter((v) => v.vendedorUserId).length;
    console.log(
      `Vendas com vendedor já vinculado a um membro do CRM: ${comVinculo} de ${fetched.vendas.length}`,
    );
    let itens = 0;
    let servicos = 0;
    for (const lista of fetched.itensPorVenda.values()) {
      itens += lista.length;
      servicos += lista.filter((i) => i.tipo === 'servico').length;
    }
    console.log(
      `Itens vendidos: ${itens} (${itens - servicos} produto(s), ${servicos} serviço(s)); ${fetched.itensIgnorados} ignorado(s) por tipo desconhecido`,
    );

    if (!apply) {
      console.log('\nSIMULAÇÃO — nada foi gravado. Rode de novo com --apply.');
      return;
    }

    const resumo = await tenantContext.run(
      ctx,
      async (tx) => {
        const r = await vendas.persist(tx, workspace.id, fetched);
        await interactionLog.registrar(tx, workspace.id, {
          origin: 'crm',
          action: 'sincronizar_vendas',
          summary: `Carga inicial do histórico de vendas executada — ${fetched.totalMatriz} venda(s) na Matriz e ${fetched.totalFilial} na Filial consultadas via API; tabela sales_history gravada com ${r.gravadas} venda(s) de ${r.empresasComVenda} empresa(s) e ${r.itensGravados} item(ns) de produto/serviço${r.orfas > 0 ? `; ${r.orfas} cliente(s) do eGestor ainda sem empresa correspondente no CRM tiveram as vendas ignoradas` : ''}${r.semVendedorVinculado > 0 ? `; ${r.semVendedorVinculado} venda(s) sem vendedor vinculado a membro do CRM` : ''}.`,
        });
        return r;
      },
      { timeoutMs: 120_000 },
    );

    console.log('\nGravado:');
    console.log(`  vendas no histórico: ${resumo.gravadas}`);
    console.log(`  itens de produto/serviço: ${resumo.itensGravados}`);
    console.log(`  empresas com compra: ${resumo.empresasComVenda}`);
    console.log(`  novas nesta rodada: ${resumo.novas}`);
    console.log(`  sumiram do eGestor: ${resumo.removidas}`);
    console.log(`  clientes sem empresa no CRM (vendas fora): ${resumo.orfas}`);
    console.log(`  vendas sem vendedor vinculado: ${resumo.semVendedorVinculado}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
