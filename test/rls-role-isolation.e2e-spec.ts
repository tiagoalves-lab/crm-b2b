import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// Prova, direto no Postgres (sem passar pelo NestJS/PolicyService), que
// as policies de RLS por papel de SPEC-CRM-GAMA.md §7.5 realmente
// restringem o que um sales_rep enxerga — mesmo raciocínio de
// rls-isolation.e2e-spec.ts, mas pra ownership dentro do MESMO
// workspace em vez de isolamento ENTRE workspaces.
//
// Setup necessário: esta migration só faz sentido depois que
// TenantContextService injeta app.current_user_id/app.current_role em
// toda transação (ver src/tenancy/tenant-context.service.ts) — pré-
// requisito não-negociável do próprio spec, já confirmado rodando a
// suíte e2e inteira ANTES de aplicar a migration de policy.

const prisma = new PrismaClient();

describe('RLS — isolamento por papel dentro do mesmo workspace (SPEC-CRM-GAMA.md §7.5)', () => {
  let workspace: { id: string };
  let admin: { id: string; userId: string };
  let operador: { id: string; userId: string };
  let outroOperador: { id: string; userId: string };
  let pipeline: { id: string };
  let stage: { id: string };

  function asMember(
    member: { userId: string },
    role: string,
    fn: (
      tx: Omit<
        PrismaClient,
        | '$connect'
        | '$disconnect'
        | '$on'
        | '$transaction'
        | '$use'
        | '$extends'
      >,
    ) => Promise<unknown>,
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_workspace_id = '${workspace.id}'`,
      );
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_user_id = '${member.userId}'`,
      );
      await tx.$executeRawUnsafe(`SET LOCAL "app.current_role" = '${role}'`);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace papéis (teste)',
        slug: `role-rls-test-${Date.now()}`,
      },
    });

    const adminUserId = randomUUID();
    const operadorUserId = randomUUID();
    const outroOperadorUserId = randomUUID();

    // Cria os memberships como owner (bypassa a checagem de papel — é só
    // fixture) e depois ajusta os papéis reais via SQL direto, pra não
    // depender de nenhuma regra de app aqui (este arquivo testa só RLS).
    admin = (await asMember({ userId: adminUserId }, 'owner', (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: adminUserId,
          role: 'admin',
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    )) as { id: string; userId: string };
    operador = (await asMember({ userId: operadorUserId }, 'owner', (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: operadorUserId,
          role: 'sales_rep',
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    )) as { id: string; userId: string };
    outroOperador = (await asMember(
      { userId: outroOperadorUserId },
      'owner',
      (tx) =>
        tx.membership.create({
          data: {
            workspaceId: workspace.id,
            userId: outroOperadorUserId,
            role: 'sales_rep',
            status: 'active',
            joinedAt: new Date(),
          },
        }),
    )) as { id: string; userId: string };

    pipeline = (await asMember(admin, 'admin', (tx) =>
      tx.pipeline.create({
        data: {
          workspaceId: workspace.id,
          name: 'Funil (teste papéis)',
          isDefault: false,
        },
      }),
    )) as { id: string };
    stage = (await asMember(admin, 'admin', (tx) =>
      tx.stage.create({
        data: {
          pipelineId: pipeline.id,
          name: 'Etapa única',
          order: 1,
          probability: 50,
        },
      }),
    )) as { id: string };
  }, 30000);

  afterAll(async () => {
    await asMember(admin, 'admin', (tx) =>
      tx.rawLead.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await asMember(admin, 'admin', (tx) =>
      tx.opportunity.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await asMember(admin, 'admin', (tx) =>
      tx.task.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await asMember(admin, 'admin', (tx) =>
      tx.company.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await asMember(admin, 'admin', (tx) =>
      tx.stage.deleteMany({ where: { pipelineId: pipeline.id } }),
    );
    await asMember(admin, 'admin', (tx) =>
      tx.pipeline.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await asMember(admin, 'admin', (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }, 20000);

  it('CRÍTICO: sales_rep só enxerga as próprias oportunidades, não as de outro operador', async () => {
    const company = (await asMember(admin, 'admin', (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, razaoSocial: 'Empresa papéis' },
      }),
    )) as { id: string };

    const oppDoOperador = (await asMember(admin, 'admin', (tx) =>
      tx.opportunity.create({
        data: {
          workspaceId: workspace.id,
          companyId: company.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerUserId: operador.userId,
          amount: 1000,
          currency: 'BRL',
        },
      }),
    )) as { id: string };
    const oppDoOutro = (await asMember(admin, 'admin', (tx) =>
      tx.opportunity.create({
        data: {
          workspaceId: workspace.id,
          companyId: company.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerUserId: outroOperador.userId,
          amount: 2000,
          currency: 'BRL',
        },
      }),
    )) as { id: string };

    const vistasOperador = (await asMember(operador, 'sales_rep', (tx) =>
      tx.opportunity.findMany({ where: { workspaceId: workspace.id } }),
    )) as Array<{ id: string }>;
    expect(vistasOperador.map((o) => o.id)).toContain(oppDoOperador.id);
    expect(vistasOperador.map((o) => o.id)).not.toContain(oppDoOutro.id);

    const vistasAdmin = (await asMember(admin, 'admin', (tx) =>
      tx.opportunity.findMany({ where: { workspaceId: workspace.id } }),
    )) as Array<{ id: string }>;
    expect(vistasAdmin.map((o) => o.id)).toEqual(
      expect.arrayContaining([oppDoOperador.id, oppDoOutro.id]),
    );
  }, 15000);

  it('CRÍTICO: sales_rep só enxerga as próprias tarefas, não as de outro operador', async () => {
    const company = (await asMember(admin, 'admin', (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, razaoSocial: 'Empresa tarefas' },
      }),
    )) as { id: string };

    const taskDoOperador = (await asMember(admin, 'admin', (tx) =>
      tx.task.create({
        data: {
          workspaceId: workspace.id,
          title: 'Tarefa do operador',
          assigneeUserId: operador.userId,
          createdBy: admin.userId,
          companyId: company.id,
        },
      }),
    )) as { id: string };
    const taskDoOutro = (await asMember(admin, 'admin', (tx) =>
      tx.task.create({
        data: {
          workspaceId: workspace.id,
          title: 'Tarefa de outro operador',
          assigneeUserId: outroOperador.userId,
          createdBy: admin.userId,
          companyId: company.id,
        },
      }),
    )) as { id: string };

    const vistasOperador = (await asMember(operador, 'sales_rep', (tx) =>
      tx.task.findMany({ where: { workspaceId: workspace.id } }),
    )) as Array<{ id: string }>;
    expect(vistasOperador.map((t) => t.id)).toContain(taskDoOperador.id);
    expect(vistasOperador.map((t) => t.id)).not.toContain(taskDoOutro.id);
  }, 15000);

  it('CRÍTICO: sales_rep só enxerga company ligada a uma oportunidade sua', async () => {
    const companyDoOperador = (await asMember(admin, 'admin', (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, razaoSocial: 'Empresa do operador' },
      }),
    )) as { id: string };
    const companySemVinculo = (await asMember(admin, 'admin', (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, razaoSocial: 'Empresa sem vínculo' },
      }),
    )) as { id: string };

    await asMember(admin, 'admin', (tx) =>
      tx.opportunity.create({
        data: {
          workspaceId: workspace.id,
          companyId: companyDoOperador.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerUserId: operador.userId,
          amount: 500,
          currency: 'BRL',
        },
      }),
    );

    const vistasOperador = (await asMember(operador, 'sales_rep', (tx) =>
      tx.company.findMany({ where: { workspaceId: workspace.id } }),
    )) as Array<{ id: string }>;
    expect(vistasOperador.map((c) => c.id)).toContain(companyDoOperador.id);
    expect(vistasOperador.map((c) => c.id)).not.toContain(companySemVinculo.id);

    const vistasAdmin = (await asMember(admin, 'admin', (tx) =>
      tx.company.findMany({ where: { workspaceId: workspace.id } }),
    )) as Array<{ id: string }>;
    expect(vistasAdmin.map((c) => c.id)).toEqual(
      expect.arrayContaining([companyDoOperador.id, companySemVinculo.id]),
    );
  }, 15000);

  // Carteira por representante na Prospecção — pedido direto do usuário,
  // 2026-08-06 (bug real: um sales_rep enxergava lead importado por outro
  // membro). Mesmo padrão dos testes de oportunidade/tarefa acima.
  it('CRÍTICO: sales_rep só enxerga os próprios raw_leads, não os de outro operador', async () => {
    const leadDoOperador = (await asMember(admin, 'admin', (tx) =>
      tx.rawLead.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Lead do operador',
          ownerUserId: operador.userId,
        },
      }),
    )) as { id: string };
    const leadDoOutro = (await asMember(admin, 'admin', (tx) =>
      tx.rawLead.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Lead de outro operador',
          ownerUserId: outroOperador.userId,
        },
      }),
    )) as { id: string };

    const vistasOperador = (await asMember(operador, 'sales_rep', (tx) =>
      tx.rawLead.findMany({ where: { workspaceId: workspace.id } }),
    )) as Array<{ id: string }>;
    expect(vistasOperador.map((l) => l.id)).toContain(leadDoOperador.id);
    expect(vistasOperador.map((l) => l.id)).not.toContain(leadDoOutro.id);

    const vistasAdmin = (await asMember(admin, 'admin', (tx) =>
      tx.rawLead.findMany({ where: { workspaceId: workspace.id } }),
    )) as Array<{ id: string }>;
    expect(vistasAdmin.map((l) => l.id)).toEqual(
      expect.arrayContaining([leadDoOperador.id, leadDoOutro.id]),
    );
  }, 15000);

  it('escrita continua workspace-scoped (não owner-scoped) — RLS de INSERT não bloqueia operador criando pra si', async () => {
    const company = (await asMember(admin, 'admin', (tx) =>
      tx.company.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Empresa insert operador',
        },
      }),
    )) as { id: string };

    const created = (await asMember(operador, 'sales_rep', (tx) =>
      tx.opportunity.create({
        data: {
          workspaceId: workspace.id,
          companyId: company.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerUserId: operador.userId,
          amount: 300,
          currency: 'BRL',
        },
      }),
    )) as { id: string };
    expect(created.id).toBeTruthy();
  }, 15000);
});
