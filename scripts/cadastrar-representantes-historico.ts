// Cadastro dos representantes que aparecem no histórico de cotações
// (planilha "Cotações", jul–set/2025) e ainda não tinham membro no CRM —
// pré-requisito do import das oportunidades históricas: oportunidade
// exige dono (ownerUserId), e sem membro o histórico entraria sem
// representante e o funil por representante nunca fecharia.
//
// Pedido do usuário (2026-09-18): "cadastre os novos membros
// representantes sem e-mail por enquanto". Dá certo porque login neste
// projeto é texto livre, não e-mail (ver SupabaseUserService) — o e-mail
// de contato é campo separado e opcional, e fica vazio até ele passar os
// endereços.
//
// Nasce ATIVO e marcado como Vendedor, que é o que faz o nome aparecer na
// lista "Representante" do card de oportunidade (decisão 5.17 de
// docs/regras-de-negocio.md).
//
// Roda pelo Railway, que injeta o ambiente do backend (precisa da
// SUPABASE_SERVICE_ROLE_KEY pra criar o login via Admin API):
//
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/cadastrar-representantes-historico.ts
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/cadastrar-representantes-historico.ts --apply
//
// Sem --apply é SIMULAÇÃO (mesmo padrão de
// scripts/carregar-vendas-egestor.ts). A senha inicial é sorteada aqui e
// NUNCA é impressa: quem for usar o CRM de verdade troca por "Redefinir
// senha" na tela de Membros — até lá o login existe só pra carregar o
// histórico.
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MembershipService } from '../src/memberships/membership.service';
import { SupabaseUserService } from '../src/memberships/supabase-user.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';

const WORKSPACE_SLUG = 'gama';
// Mesmo ator "sistema" que os outros scripts usam pra abrir o contexto de
// leitura antes de saber quem é o owner (ver carregar-vendas-egestor.ts).
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

// Nome como aparece na planilha (é o que o import vai casar) + login
// sugerido. Lauro, Maiquel e Darlã já existem no CRM e ficam de fora.
const REPRESENTANTES = [
  { nome: 'Lucas Makinodan', login: 'lucas.makinodan' },
  { nome: 'Levi Gomes', login: 'levi.gomes' },
  { nome: 'Edilson Gonçalves', login: 'edilson.goncalves' },
  { nome: 'Rodrigo Vascotto', login: 'rodrigo.vascotto' },
  { nome: 'Gustavo Hainzenreder', login: 'gustavo.hainzenreder' },
  { nome: 'Rafael Ferracini', login: 'rafael.ferracini' },
  { nome: 'Gilmar Oliveira', login: 'gilmar.oliveira' },
];

async function main() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const tenantContext = app.get(TenantContextService);
    const memberships = app.get(MembershipService);
    const supabaseUser = app.get(SupabaseUserService);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });

    // Ator do cadastro: o owner real do workspace. MembershipService#create
    // checa papel (só owner/admin/gerente cadastram) e capa permissões
    // contra o ator — usar o owner mantém a mesma régua da tela, em vez de
    // furar a política com um contexto sintético.
    // A leitura passa pelo tenantContext porque memberships tem RLS por
    // workspace da sessão: prisma cru, fora do contexto, devolve vazio.
    const owner = await tenantContext.run(
      {
        userId: SYSTEM_ACTOR_USER_ID,
        workspaceId: workspace.id,
        role: 'owner' as const,
      },
      (tx) =>
        tx.membership.findFirstOrThrow({
          where: { workspaceId: workspace.id, role: 'owner', status: 'active' },
          select: {
            id: true,
            userId: true,
            role: true,
            status: true,
            permissions: true,
          },
        }),
    );
    const actor = { ...owner, workspaceId: workspace.id };
    const ctx = { userId: owner.userId, workspaceId: workspace.id, role: owner.role };

    // Mesmo caminho do GET /memberships: linhas no Postgres + nome/login
    // no Supabase Auth (identidade não é coluna de Membership).
    const jaExistem = await tenantContext.run(ctx, (tx) =>
      memberships.findAll(tx, actor as never),
    );
    const identidades = await supabaseUser.getIdentities(
      jaExistem.map((m) => m.userId),
    );
    const nomesExistentes = new Set(
      [...identidades.values()]
        .map((i) => i.name?.trim().toLowerCase())
        .filter((n): n is string => !!n),
    );

    const pendentes = REPRESENTANTES.filter(
      (r) => !nomesExistentes.has(r.nome.trim().toLowerCase()),
    );

    console.log(`Membros hoje no workspace: ${jaExistem.length}`);
    console.log(`Representantes a cadastrar: ${pendentes.length} de ${REPRESENTANTES.length}`);
    for (const r of pendentes) {
      console.log(`  - ${r.nome} (login ${r.login}, sem e-mail, marcado como Vendedor)`);
    }
    if (pendentes.length === 0) {
      console.log('Nada a fazer.');
      return;
    }

    if (!apply) {
      console.log('\nSIMULAÇÃO — nada foi gravado. Rode de novo com --apply.');
      return;
    }

    for (const r of pendentes) {
      const senha = randomBytes(18).toString('base64url');
      await tenantContext.run(ctx, (tx) =>
        memberships.create(tx, actor as never, {
          name: r.nome,
          login: r.login,
          password: senha,
          role: 'sales_rep',
          vendedor: true,
        }),
      );
      console.log(`Cadastrado: ${r.nome}`);
    }

    console.log('\nPronto. Senha inicial sorteada e não exibida de propósito.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
