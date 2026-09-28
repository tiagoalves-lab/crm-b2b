// Aplica retroativamente a regra 1 da equipe de vendas (pedido do
// usuário, 2026-09-21): "o prospect herda o login do representante e seu
// supervisor". A partir de agora isso acontece sozinho no cadastro (ver
// src/companies/equipe-de-vendas.ts); este script cobre o que já estava
// no banco antes, pra aba não mostrar a empresa antiga com a equipe
// incompleta.
//
// NÃO muda acesso de ninguém na prática: supervisor é gerente, e gerente
// já enxerga toda empresa do workspace pelo cargo (PolicyService.
// companyReadFilter). O efeito é a aba "Equipe de vendas" passar a
// mostrar quem de fato responde por aquela empresa.
//
// Ignora empresa excluída, empresa sem responsável e representante sem
// supervisor cadastrado.
//
// Roda em modo relatório por padrão; grava só com --apply:
//
//   node_modules\.bin\ts-node scripts/preencher-equipe-supervisor.ts
//   node_modules\.bin\ts-node scripts/preencher-equipe-supervisor.ts --apply
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import { temAcessoAutomatico } from '../src/companies/equipe-de-vendas';

const WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

async function main() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const tenantContext = app.get(TenantContextService);
    const [workspace] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM workspaces WHERE slug = ${WORKSPACE_SLUG}
    `;
    if (!workspace) throw new Error(`Workspace "${WORKSPACE_SLUG}" não existe.`);

    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId: workspace.id,
      role: 'owner' as const,
    };

    const resultado = await tenantContext.run(ctx, async (tx) => {
      const membros = await tx.membership.findMany({
        where: { workspaceId: workspace.id },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          managerId: true,
        },
      });
      const porId = new Map(membros.map((m) => [m.id, m]));
      const porUserId = new Map(membros.map((m) => [m.userId, m]));

      // userId do representante → userId do supervisor a conceder.
      const supervisorDe = new Map<string, string>();
      let semSupervisor = 0;
      for (const m of membros) {
        if (!m.managerId) {
          if (m.role === 'sales_rep') semSupervisor++;
          continue;
        }
        const sup = porId.get(m.managerId);
        if (
          !sup ||
          sup.status !== 'active' ||
          sup.userId === m.userId ||
          temAcessoAutomatico(sup.role)
        ) {
          continue;
        }
        supervisorDe.set(m.userId, sup.userId);
      }

      const empresas = await tx.company.findMany({
        where: {
          workspaceId: workspace.id,
          deletedAt: null,
          ownerUserId: { not: null },
        },
        select: { id: true, ownerUserId: true },
      });

      const alvos: Array<{ companyId: string; userId: string }> = [];
      for (const empresa of empresas) {
        const dono = empresa.ownerUserId!;
        if (!porUserId.has(dono)) continue;
        const supervisor = supervisorDe.get(dono);
        if (supervisor) alvos.push({ companyId: empresa.id, userId: supervisor });
      }

      const jaExistem = await tx.companyAccess.findMany({
        where: { workspaceId: workspace.id },
        select: { companyId: true, userId: true },
      });
      const chave = (c: string, u: string) => `${c}|${u}`;
      const existentes = new Set(
        jaExistem.map((g) => chave(g.companyId, g.userId)),
      );
      const faltando = alvos.filter(
        (a) => !existentes.has(chave(a.companyId, a.userId)),
      );

      let gravados = 0;
      if (apply) {
        for (const alvo of faltando) {
          await tx.companyAccess.upsert({
            where: {
              companyId_userId: {
                companyId: alvo.companyId,
                userId: alvo.userId,
              },
            },
            create: {
              workspaceId: workspace.id,
              companyId: alvo.companyId,
              userId: alvo.userId,
            },
            update: {},
          });
          gravados++;
        }
      }

      return {
        empresas: empresas.length,
        comSupervisor: alvos.length,
        faltando: faltando.length,
        gravados,
        repsSemSupervisor: semSupervisor,
      };
    });

    console.log(`Empresas com responsável ativo: ${resultado.empresas}`);
    console.log(`Com supervisor a registrar:     ${resultado.comSupervisor}`);
    console.log(`Faltando no banco:              ${resultado.faltando}`);
    console.log(
      `Representantes SEM supervisor:  ${resultado.repsSemSupervisor} (cadastrar na tela de Membros)`,
    );
    console.log(
      apply
        ? `Gravados agora:                 ${resultado.gravados}`
        : 'Modo relatório — rode com --apply para gravar.',
    );
  } finally {
    await app.close();
  }
}

void main();
