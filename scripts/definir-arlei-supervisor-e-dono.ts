// "Coloque o Arlei" (pedido do usuário, 2026-09-21), duas frentes:
//
// 1. **Supervisor** — todo representante ativo sem supervisor cadastrado
//    passa a ter o Arlei como supervisor. É o que faz a regra 1 da equipe
//    de vendas valer pra eles (prospect novo nasce com o representante e
//    o supervisor dele — ver src/companies/equipe-de-vendas.ts).
//
// 2. **Responsável** — prospect em triagem sem ninguém responsável (199
//    em 2026-09-21, herdados da migração de empresas do eGestor pra
//    Prospecção) passa a ter o Arlei como responsável, no lead e na
//    empresa dele. A equipe de vendas nunca pode ficar vazia (regra do
//    usuário na mesma data).
//
// NÃO toca na base de clientes: empresa sem lead em Prospecção continua
// sem dono, como manda a decisão 3.7 de docs/regras-de-negocio.md ("as
// empresas trazidas do eGestor ficam sem dono de propósito"). E não abre
// acesso pra ninguém: Arlei é gerente, e gerente já enxerga todas as
// empresas do workspace pelo cargo.
//
// Relatório por padrão; grava só com --apply:
//
//   node_modules\.bin\ts-node scripts/definir-arlei-supervisor-e-dono.ts
//   node_modules\.bin\ts-node scripts/definir-arlei-supervisor-e-dono.ts --apply
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';

const WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';
// Gerente comercial — o mesmo já configurado como dono padrão dos leads
// do Meta (META_LEADS_DEFAULT_OWNER_USER_ID).
const ARLEI_USER_ID = 'cdf42f7f-f34d-4617-9e47-333c06e13cf9';

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
      const arlei = await tx.membership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: ARLEI_USER_ID,
          },
        },
        select: { id: true, status: true, role: true },
      });
      if (!arlei || arlei.status !== 'active') {
        throw new Error('Arlei não é um membro ativo deste workspace.');
      }

      // ── 1. supervisor dos representantes ──────────────────────────
      const semSupervisor = await tx.membership.findMany({
        where: {
          workspaceId: workspace.id,
          status: 'active',
          role: 'sales_rep',
          managerId: null,
        },
        select: { id: true, userId: true },
      });
      let supervisoresGravados = 0;
      if (apply && semSupervisor.length > 0) {
        const r = await tx.membership.updateMany({
          where: { id: { in: semSupervisor.map((m) => m.id) } },
          data: { managerId: arlei.id },
        });
        supervisoresGravados = r.count;
      }

      // ── 2. responsável dos prospects órfãos ───────────────────────
      const leadsSemDono = await tx.rawLead.findMany({
        where: { workspaceId: workspace.id, ownerUserId: null },
        select: { id: true, promotedCompanyId: true },
      });
      const empresasDosLeads = leadsSemDono
        .map((l) => l.promotedCompanyId)
        .filter((id): id is string => id !== null);
      const empresasSemDono = await tx.company.findMany({
        where: {
          workspaceId: workspace.id,
          id: { in: empresasDosLeads },
          ownerUserId: null,
          deletedAt: null,
        },
        select: { id: true },
      });

      let leadsGravados = 0;
      let empresasGravadas = 0;
      if (apply) {
        if (leadsSemDono.length > 0) {
          const r = await tx.rawLead.updateMany({
            where: { id: { in: leadsSemDono.map((l) => l.id) } },
            data: { ownerUserId: ARLEI_USER_ID },
          });
          leadsGravados = r.count;
        }
        if (empresasSemDono.length > 0) {
          const r = await tx.company.updateMany({
            where: { id: { in: empresasSemDono.map((c) => c.id) } },
            data: { ownerUserId: ARLEI_USER_ID },
          });
          empresasGravadas = r.count;
        }
      }

      return {
        representantesSemSupervisor: semSupervisor.length,
        supervisoresGravados,
        leadsSemDono: leadsSemDono.length,
        leadsGravados,
        empresasSemDono: empresasSemDono.length,
        empresasGravadas,
      };
    });

    console.log(
      `Representantes sem supervisor: ${resultado.representantesSemSupervisor}` +
        (apply ? ` → gravados ${resultado.supervisoresGravados}` : ''),
    );
    console.log(
      `Prospects sem responsável:     ${resultado.leadsSemDono}` +
        (apply ? ` → gravados ${resultado.leadsGravados}` : ''),
    );
    console.log(
      `Empresas desses prospects:     ${resultado.empresasSemDono}` +
        (apply ? ` → gravadas ${resultado.empresasGravadas}` : ''),
    );
    if (!apply) console.log('Modo relatório — rode com --apply para gravar.');
  } finally {
    await app.close();
  }
}

void main();
