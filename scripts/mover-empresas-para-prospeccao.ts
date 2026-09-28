// Leva pra Prospecção as empresas que ficaram sem tela nenhuma depois de
// Empresas passar a listar só cliente (decisão 6.6 de
// docs/regras-de-negocio.md, pedido do usuário em 2026-09-18).
//
// Quem entra: empresa não excluída que NUNCA COMPROU (sem pedido no
// eGestor e sem oportunidade ganha — decisão 6.11), SEM a tag
// "lead-triagem" (ou seja, ainda não é lead) e SEM oportunidade no
// Pipeline (com proposta ela já aparece em "Leads convertidos").
//
// A 2ª rodada (2026-09-18) pegou os 145 cadastros que o eGestor marca como
// cliente mas que nunca emitiram pedido: cadastro no ERP não é compra.
//
// Como "mover": o modelo do projeto é que todo lead JÁ TEM uma Company
// própria marcada com a tag "lead-triagem", e aprovar o lead só remove
// esse marcador (ver RawLead no schema e RawLeadService#approve). Então
// mover é criar o RawLead apontando pra empresa que já existe
// (promotedCompanyId) e marcar a empresa como em triagem — nada é
// duplicado, nada é apagado.
//
// Registros de TESTE ficam de fora: a suíte e2e roda contra o banco de
// produção (não existe banco de teste) e deixou empresas como "Empresa
// E2E", "Empresa Modelo" e "Empresa do sales_rep (contatos)". Elas não são
// prospecção de ninguém — o script lista pra decisão do usuário e não
// toca nelas.
//
// Roda pelo Railway:
//
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/mover-empresas-para-prospeccao.ts
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/mover-empresas-para-prospeccao.ts --apply
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';

const WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

// Sobra de teste automatizado, não empresa de verdade.
const PADROES_DE_TESTE = [/\bE2E\b/i, /^Empresa Modelo$/i, /^Empresa do sales_rep/i, /^Empresa Já Limpa/i];

function pareceTeste(nome: string | null): boolean {
  if (!nome || !nome.trim()) return true; // empresa sem nome nenhum
  return PADROES_DE_TESTE.some((re) => re.test(nome.trim()));
}

async function main() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const tenantContext = app.get(TenantContextService);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId: workspace.id,
      role: 'owner' as const,
    };

    const candidatas = await tenantContext.run(ctx, (tx) =>
      tx.company.findMany({
        where: {
          workspaceId: workspace.id,
          deletedAt: null,
          NOT: { tags: { has: 'lead-triagem' } },
          opportunities: { none: { deletedAt: null } },
          // Nunca comprou — mesma régua de src/companies/cliente-regra.ts.
          salesHistory: { none: {} },
        },
        select: {
          id: true,
          razaoSocial: true,
          fantasia: true,
          nomeParaContato: true,
          cpfCnpj: true,
          cidade: true,
          uf: true,
          tags: true,
          ownerUserId: true,
          emRecuperacaoJudicial: true,
          industry: true,
        },
      }),
    );

    // Empresa que já tem lead apontando pra ela não entra de novo
    // (idempotência do script).
    const jaTemLead = new Set(
      (
        await tenantContext.run(ctx, (tx) =>
          tx.rawLead.findMany({
            where: { workspaceId: workspace.id, promotedCompanyId: { not: null } },
            select: { promotedCompanyId: true },
          }),
        )
      ).map((l) => l.promotedCompanyId as string),
    );

    const testes = candidatas.filter((c) => pareceTeste(c.razaoSocial));
    const mover = candidatas.filter((c) => !pareceTeste(c.razaoSocial) && !jaTemLead.has(c.id));

    console.log(`Empresas fora de Empresas e fora da Prospecção: ${candidatas.length}`);
    console.log(`  - a mover pra Prospecção: ${mover.length}`);
    console.log(`  - sobra de teste automatizado (NÃO tocadas): ${testes.length}`);
    for (const t of testes) console.log(`      ${t.razaoSocial ?? '(sem nome)'}`);
    console.log(`  - já tinham lead: ${candidatas.length - mover.length - testes.length}`);

    if (!apply) {
      console.log('\nSIMULAÇÃO — nada foi gravado. Rode de novo com --apply.');
      return;
    }
    if (mover.length === 0) return;

    await tenantContext.run(
      ctx,
      async (tx) => {
        for (const c of mover) {
          const nome = (c.razaoSocial ?? c.fantasia ?? c.nomeParaContato ?? '').trim();
          await tx.rawLead.create({
            data: {
              workspaceId: workspace.id,
              // Prospecção é toda em caixa alta (decisão de padronização de
              // 2026-08-10) — o nome vem da empresa, que já segue a regra.
              razaoSocial: nome.toLocaleUpperCase('pt-BR'),
              cnpj: c.cpfCnpj,
              uf: c.uf,
              municipio: c.cidade,
              segmento: c.industry,
              emRecuperacaoJudicial: c.emRecuperacaoJudicial,
              // Sem classificação de propósito: é justamente o trabalho do
              // SDR (decisão 6.2) — elas nascem como Prospects.
              status: 'novo',
              fonte: 'manual',
              promotedCompanyId: c.id,
              ownerUserId: c.ownerUserId,
            },
          });
          await tx.company.update({
            where: { id: c.id },
            data: { tags: [...c.tags, 'lead-triagem'] },
          });
        }
      },
      { timeoutMs: 300_000 },
    );

    console.log(`\nMovidas: ${mover.length} empresa(s) agora aparecem na Prospecção como Prospects.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
