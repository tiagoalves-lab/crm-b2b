import { PrismaClient } from '@prisma/client';

// Seed de desenvolvimento — critério de saída da Fase 1 (roadmap.md):
// "consegue criar um workspace, um usuário, logar, e inserir/consultar
// Company via query direta respeitando RLS".
//
// Não cria o usuário — identidade vem do Supabase Auth (ver
// web/README.md, seção 1: criar um usuário manualmente no painel antes
// de rodar isto). DEV_USER_ID é o uuid desse usuário.

const prisma = new PrismaClient();

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function withWorkspace<T>(
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_workspace_id = '${workspaceId}'`,
    );
    return fn(tx);
  });
}

async function main() {
  const devUserId = process.env.DEV_USER_ID;
  if (!devUserId) {
    throw new Error(
      'DEV_USER_ID não definido. Crie um usuário no painel do Supabase ' +
        '(Authentication → Users → Add user — ver web/README.md, seção 1), ' +
        'copie o uuid dele e rode: DEV_USER_ID=<uuid> npm run prisma:seed',
    );
  }

  // Workspace não tem RLS (ver comentário na migration) — cria fora do
  // contexto de sessão.
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'gama-brasil-dev' },
    update: {},
    create: {
      name: 'Gama Brasil (dev)',
      slug: 'gama-brasil-dev',
      status: 'active',
    },
  });
  console.log(`Workspace: ${workspace.name} (${workspace.id})`);

  await withWorkspace(workspace.id, async (tx) => {
    await tx.membership.upsert({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: devUserId },
      },
      update: {},
      create: {
        workspaceId: workspace.id,
        userId: devUserId,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      },
    });
    console.log(`Membership (owner) criado pra usuário ${devUserId}.`);

    const existingPipeline = await tx.pipeline.findFirst({
      where: { workspaceId: workspace.id, isDefault: true },
    });

    const pipeline =
      existingPipeline ??
      (await tx.pipeline.create({
        data: {
          workspaceId: workspace.id,
          name: 'Pipeline Padrão',
          isDefault: true,
          stages: {
            create: [
              { name: 'Qualificação', order: 1, probability: 20 },
              { name: 'Proposta Enviada', order: 2, probability: 40 },
              { name: 'Negociação', order: 3, probability: 65 },
              { name: 'Fechamento', order: 4, probability: 85 },
            ],
          },
        },
      }));
    console.log(`Pipeline: ${pipeline.name} (${pipeline.id})`);

    const existingCompany = await tx.company.findFirst({
      where: { workspaceId: workspace.id },
    });
    const company =
      existingCompany ??
      (await tx.company.create({
        data: {
          workspaceId: workspace.id,
          name: 'Empresa de Teste',
          domain: 'empresateste.com.br',
          ownerUserId: devUserId,
        },
      }));
    console.log(`Company: ${company.name} (${company.id})`);
  });

  console.log('Seed concluído.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
