import { PrismaClient } from '@prisma/client';

// Teste crítico exigido pela Fase 1 do roadmap: prova que RLS isola dado
// entre workspaces antes de qualquer API ser construída em cima do
// schema. Ver docs/arquitetura-dados.md (seção 1) e
// docs/seguranca.md (seção 3).
//
// Não bootstrapa o NestJS — vai direto no Postgres via Prisma, porque é
// o próprio banco que precisa provar o isolamento, não uma camada de
// aplicação por cima dele.

const prisma = new PrismaClient();

describe('RLS — isolamento entre workspaces', () => {
  let workspaceA: { id: string };
  let workspaceB: { id: string };

  beforeAll(async () => {
    // Guarda de segurança: se a conexão usa um papel que ignora RLS
    // (superusuário, ou qualquer role com BYPASSRLS), este teste passaria
    // mesmo com RLS quebrado — o que seria pior que não ter o teste, dá
    // falsa confiança. Falha alto e explica o porquê.
    const rows = await prisma.$queryRaw<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (rows[0]?.rolbypassrls) {
      throw new Error(
        'DATABASE_URL está conectando com um papel que ignora RLS ' +
          '(rolbypassrls = true) — provavelmente o papel `postgres` ' +
          '(superuser) do Supabase. Este teste não prova isolamento ' +
          'nenhum rodando assim. Use o papel `app_runtime` criado em ' +
          'prisma/migrations/20260724120001_app_runtime_role — ver ' +
          'docs/seguranca.md, seção "Papel do Postgres usado pela aplicação".',
      );
    }

    workspaceA = await prisma.workspace.create({
      data: {
        name: 'Workspace A (teste RLS)',
        slug: `rls-test-a-${Date.now()}`,
      },
    });
    workspaceB = await prisma.workspace.create({
      data: {
        name: 'Workspace B (teste RLS)',
        slug: `rls-test-b-${Date.now()}`,
      },
    });
  }, 15000);

  afterAll(async () => {
    // Limpeza roda dentro do contexto de cada workspace — as tabelas têm
    // RLS, então um deleteMany sem `SET LOCAL` não enxergaria nada pra
    // apagar (o que é exatamente o comportamento que este arquivo testa).
    // task_checklist_items/task_comments somem em cascata com o task.
    // ORDEM IMPORTA: apagar a company antes da task violaria a CHECK
    // "tasks_exactly_one_relation" — o FK company_id é ON DELETE SET
    // NULL, e a task deste arquivo só tem companyId preenchido
    // (opportunity_id já é null), então zerar company_id deixaria os dois
    // null ao mesmo tempo. Task sempre primeiro.
    await withWorkspace(workspaceA.id, (tx) =>
      tx.task.deleteMany({ where: { workspaceId: workspaceA.id } }),
    );
    // Oportunidade (opportunity_items some em cascata) antes de stage/
    // pipeline/company, que ela referencia.
    await withWorkspace(workspaceA.id, (tx) =>
      tx.opportunity.deleteMany({ where: { workspaceId: workspaceA.id } }),
    );
    await withWorkspace(workspaceA.id, (tx) =>
      tx.stage.deleteMany({
        where: { pipeline: { workspaceId: workspaceA.id } },
      }),
    );
    await withWorkspace(workspaceA.id, (tx) =>
      tx.pipeline.deleteMany({ where: { workspaceId: workspaceA.id } }),
    );
    await withWorkspace(workspaceA.id, (tx) =>
      tx.company.deleteMany({ where: { workspaceId: workspaceA.id } }),
    );
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceA.id, workspaceB.id] } },
    });
    await prisma.$disconnect();
  }, 15000);

  /**
   * Roda `fn` dentro de uma transação com `app.current_workspace_id`
   * setado via SET LOCAL — escopado à transação, nunca vaza pra outras
   * conexões do pool (diferente de um `SET` simples, que persistiria na
   * sessão e poderia contaminar a próxima query servida por essa mesma
   * conexão pooled).
   */
  function withWorkspace<T>(
    workspaceId: string | null,
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
    ) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      if (workspaceId) {
        await tx.$executeRawUnsafe(
          `SET LOCAL app.current_workspace_id = '${workspaceId}'`,
        );
        // 'owner' bypassa a checagem de papel de SPEC-CRM-GAMA.md §7.5 —
        // este arquivo testa isolamento de WORKSPACE (Fase 1), não
        // ownership dentro do workspace (isso é
        // test/rls-role-isolation.e2e-spec.ts); sem isso, toda escrita
        // via Prisma (que usa RETURNING) falharia por não bater com
        // nenhuma condição de dono da policy de papel.
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_role" = 'owner'`);
      }
      return fn(tx);
    });
  }

  it('sem app.current_workspace_id setado, nenhuma linha é visível (fail-closed)', async () => {
    const companies = await withWorkspace(null, (tx) => tx.company.findMany());
    expect(companies).toHaveLength(0);
  });

  it('lê a própria empresa dentro do workspace correto', async () => {
    const created = await withWorkspace(workspaceA.id, (tx) =>
      tx.company.create({
        data: { workspaceId: workspaceA.id, razaoSocial: 'Empresa A' },
      }),
    );

    const found = await withWorkspace(workspaceA.id, (tx) =>
      tx.company.findUnique({ where: { id: created.id } }),
    );

    expect(found).not.toBeNull();
    expect(found?.razaoSocial).toBe('Empresa A');
  });

  it('CRÍTICO: empresa do workspace A não vaza pro workspace B', async () => {
    const created = await withWorkspace(workspaceA.id, (tx) =>
      tx.company.create({
        data: { workspaceId: workspaceA.id, razaoSocial: 'Empresa Secreta A' },
      }),
    );

    const foundInB = await withWorkspace(workspaceB.id, (tx) =>
      tx.company.findUnique({ where: { id: created.id } }),
    );
    expect(foundInB).toBeNull();

    const listInB = await withWorkspace(workspaceB.id, (tx) =>
      tx.company.findMany(),
    );
    expect(listInB.find((c) => c.id === created.id)).toBeUndefined();
  });

  it('CRÍTICO: não permite inserir linha com workspace_id diferente do contexto da sessão', async () => {
    await expect(
      withWorkspace(workspaceA.id, (tx) =>
        tx.company.create({
          data: {
            workspaceId: workspaceB.id,
            razaoSocial: 'Tentativa cruzada',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('CHECK constraint: Task exige exatamente um de company/opportunity', async () => {
    await expect(
      withWorkspace(workspaceA.id, (tx) =>
        tx.task.create({
          data: {
            workspaceId: workspaceA.id,
            assigneeUserId: '00000000-0000-0000-0000-000000000001',
            createdBy: '00000000-0000-0000-0000-000000000001',
            title: 'Task sem nenhuma relação preenchida — deve falhar',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('CRÍTICO: task_checklist_items/task_comments (RLS via subquery em task_id) não vazam pro workspace B', async () => {
    const company = await withWorkspace(workspaceA.id, (tx) =>
      tx.company.create({
        data: {
          workspaceId: workspaceA.id,
          razaoSocial: 'Empresa pra checklist',
        },
      }),
    );
    const task = await withWorkspace(workspaceA.id, (tx) =>
      tx.task.create({
        data: {
          workspaceId: workspaceA.id,
          assigneeUserId: '00000000-0000-0000-0000-000000000001',
          createdBy: '00000000-0000-0000-0000-000000000001',
          companyId: company.id,
          title: 'Task com checklist e comentário',
        },
      }),
    );
    const item = await withWorkspace(workspaceA.id, (tx) =>
      tx.taskChecklistItem.create({
        data: { taskId: task.id, text: 'Item secreto' },
      }),
    );
    const comment = await withWorkspace(workspaceA.id, (tx) =>
      tx.taskComment.create({
        data: {
          taskId: task.id,
          authorUserId: '00000000-0000-0000-0000-000000000001',
          body: 'Comentário secreto',
        },
      }),
    );

    const itemInB = await withWorkspace(workspaceB.id, (tx) =>
      tx.taskChecklistItem.findUnique({ where: { id: item.id } }),
    );
    expect(itemInB).toBeNull();

    const commentInB = await withWorkspace(workspaceB.id, (tx) =>
      tx.taskComment.findUnique({ where: { id: comment.id } }),
    );
    expect(commentInB).toBeNull();
  }, 15000);

  // 2026-09-04: lista lateral de itens do card de Oportunidade — mesma
  // policy por subquery (opportunity_id -> opportunities.workspace_id) de
  // opportunity_comments/opportunity_attachments.
  it('CRÍTICO: opportunity_items (RLS via subquery em opportunity_id) não vazam pro workspace B', async () => {
    const company = await withWorkspace(workspaceA.id, (tx) =>
      tx.company.create({
        data: {
          workspaceId: workspaceA.id,
          razaoSocial: 'Empresa pra itens de oportunidade',
        },
      }),
    );
    const pipeline = await withWorkspace(workspaceA.id, (tx) =>
      tx.pipeline.create({
        data: {
          workspaceId: workspaceA.id,
          name: 'Pipeline do teste de itens',
          stages: { create: [{ name: 'Etapa 1', order: 1, probability: 10 }] },
        },
        include: { stages: true },
      }),
    );
    const opportunity = await withWorkspace(workspaceA.id, (tx) =>
      tx.opportunity.create({
        data: {
          workspaceId: workspaceA.id,
          companyId: company.id,
          pipelineId: pipeline.id,
          stageId: pipeline.stages[0].id,
          ownerUserId: '00000000-0000-0000-0000-000000000001',
          amount: 100,
          currency: 'BRL',
        },
      }),
    );
    const item = await withWorkspace(workspaceA.id, (tx) =>
      tx.opportunityItem.create({
        data: { opportunityId: opportunity.id, name: 'Item secreto' },
      }),
    );

    const itemInA = await withWorkspace(workspaceA.id, (tx) =>
      tx.opportunityItem.findUnique({ where: { id: item.id } }),
    );
    expect(itemInA?.name).toBe('Item secreto');

    const itemInB = await withWorkspace(workspaceB.id, (tx) =>
      tx.opportunityItem.findUnique({ where: { id: item.id } }),
    );
    expect(itemInB).toBeNull();

    // WITH CHECK: B também não consegue pendurar item numa oportunidade de A.
    await expect(
      withWorkspace(workspaceB.id, (tx) =>
        tx.opportunityItem.create({
          data: { opportunityId: opportunity.id, name: 'Intruso' },
        }),
      ),
    ).rejects.toThrow();
  }, 20000);
});
