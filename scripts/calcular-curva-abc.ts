// Roda a curva ABC de clientes pela linha de comando — mesmo caminho de
// código do botão "Calcular curva ABC" da tela Empresas, só que sem
// precisar de um login owner/admin no navegador. Existe pro primeiro
// cálculo (a coluna Classe nasceria vazia sem ele) e pra quando for
// preciso recalcular fora do horário de uso.
//
// Precisa do ambiente do backend em produção — rodar sempre pelo Railway,
// que injeta as variáveis sem nunca imprimi-las:
//
//   node_modules\.bin\railway run -- node node_modules\ts-node\dist\bin.js scripts/calcular-curva-abc.ts
//   node_modules\.bin\railway run -- node node_modules\ts-node\dist\bin.js scripts/calcular-curva-abc.ts --apply
//
// Sem --apply é SIMULAÇÃO: mostra como ficaria a divisão A/B/C sem gravar
// nada (mesmo padrão de scripts/carregar-vendas-egestor.ts).
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CompanyAbcService } from '../src/companies/company-abc.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';

const WORKSPACE_SLUG = 'gama';
// Mesmo ator "sistema" usado pelo webhook quando não há membership real
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
    const abc = app.get(CompanyAbcService);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId: workspace.id,
      role: 'owner' as const,
    };
    const membership = {
      id: SYSTEM_ACTOR_USER_ID,
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId: workspace.id,
      role: 'owner',
      status: 'active',
    } as MembershipContext;

    const resumo = await tenantContext.run(
      ctx,
      async (tx) => {
        const r = await abc.calcular(tx, membership);
        // Simulação: desfaz a escrita abortando a transação, depois de já
        // ter os números na mão. Mais honesto que um "modo dry-run" no
        // serviço — o que roda aqui é exatamente o mesmo código do botão.
        if (!apply) throw new SimulacaoConcluida(r);
        return r;
      },
      { timeoutMs: 60_000 },
    ).catch((err) => {
      if (err instanceof SimulacaoConcluida) return err.resumo;
      throw err;
    });

    console.log(`Clientes classificados: ${resumo.classificadas}`);
    console.log(`  classe A: ${resumo.a}`);
    console.log(`  classe B: ${resumo.b}`);
    console.log(`  classe C: ${resumo.c}`);
    console.log(`Empresas sem compra (ficam sem classe): ${resumo.semCompra}`);
    console.log(`Faturamento considerado: R$ ${resumo.faturamentoTotal}`);
    if (!apply) {
      console.log('\nSIMULAÇÃO — nada foi gravado. Rode de novo com --apply.');
    }
  } finally {
    await app.close();
  }
}

class SimulacaoConcluida extends Error {
  constructor(readonly resumo: Awaited<ReturnType<CompanyAbcService['calcular']>>) {
    super('simulação');
  }
}

main().catch((err) => {
  console.error('Falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
