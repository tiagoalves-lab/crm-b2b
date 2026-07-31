import { PrismaClient } from '@prisma/client';
import { LeadScoringService } from '../src/raw-leads/lead-scoring.service';

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

    // As 4 etapas do protótipo (SPEC-CRM-GAMA.md §4.2) — Ganho/Perdido não
    // são stages, são opportunities.status.
    const pipeline =
      existingPipeline ??
      (await tx.pipeline.create({
        data: {
          workspaceId: workspace.id,
          name: 'Funil Padrão',
          isDefault: true,
          stages: {
            create: [
              { name: 'Solicitação de Propostas', order: 1, probability: 15 },
              { name: 'Elaboração de Propostas', order: 2, probability: 35 },
              { name: 'Aprovação de Propostas', order: 3, probability: 60 },
              { name: 'Negociação e Fechamento', order: 4, probability: 80 },
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

    // Leads fictícios pra popular a triagem (SPEC-CRM-GAMA.md §4.4) — até
    // esta seed rodar, raw_leads fica vazio (ingestão real por crawler é
    // fora de escopo, §9). Dados 100% inventados, sem CNPJ/empresa real.
    // Score calculado pela mesma LeadScoringService do backend, não
    // hardcoded, pra nunca dessincronizar da fórmula real.
    const existingLead = await tx.rawLead.findFirst({
      where: { workspaceId: workspace.id },
    });
    if (!existingLead) {
      const scoring = new LeadScoringService();
      const rawLeadSeeds = [
        {
          razaoSocial: 'Metalúrgica Alfa Ltda',
          cnpj: '11.111.111/0001-11',
          cnaePrincipal: '2511-0',
          cnaeDescricao: 'Fabricação de estruturas metálicas',
          porte: 'GRANDE',
          uf: 'RS',
          municipio: 'Caxias do Sul',
          situacao: 'ATIVA',
          importador: true,
          fonte: 'econodata' as const,
        },
        {
          razaoSocial: 'Componentes Beta Indústria e Comércio',
          cnpj: '22.222.222/0001-22',
          cnaePrincipal: '2829-1',
          cnaeDescricao: 'Fabricação de máquinas e equipamentos',
          porte: 'MÉDIO',
          uf: 'RS',
          municipio: 'Bento Gonçalves',
          situacao: 'ATIVA',
          importador: false,
          fonte: 'apify' as const,
        },
        {
          razaoSocial: 'Usinagem Delta Peças Ltda',
          cnpj: '33.333.333/0001-33',
          cnaePrincipal: '2421-1',
          cnaeDescricao: 'Metalurgia dos metais não-ferrosos',
          porte: 'PEQUENO',
          uf: 'RS',
          municipio: 'Farroupilha',
          situacao: 'ATIVA',
          importador: false,
          fonte: 'manual' as const,
        },
        {
          razaoSocial: 'Comércio Gama Peças e Acessórios',
          cnpj: '44.444.444/0001-44',
          cnaePrincipal: '4663-0',
          cnaeDescricao: 'Comércio atacadista de máquinas e equipamentos',
          porte: 'PEQUENO',
          uf: 'RS',
          municipio: 'Porto Alegre',
          situacao: 'ATIVA',
          importador: false,
          fonte: 'comexstat' as const,
        },
        {
          razaoSocial: 'Fundição Épsilon do Sul',
          cnpj: '55.555.555/0001-55',
          cnaePrincipal: '2599-3',
          cnaeDescricao: 'Fabricação de produtos de metal não especificados',
          porte: 'MÉDIO',
          uf: 'SC',
          municipio: 'Joinville',
          situacao: 'ATIVA',
          importador: false,
          fonte: 'econodata' as const,
        },
        {
          razaoSocial: 'Zeta Ferramentaria Industrial',
          cnpj: '66.666.666/0001-66',
          cnaePrincipal: '2593-4',
          cnaeDescricao: 'Fabricação de artigos de serralheria',
          porte: 'GRANDE',
          uf: 'RS',
          municipio: 'Novo Hamburgo',
          situacao: 'BAIXADA',
          importador: true,
          fonte: 'apify' as const,
        },
      ];

      for (const seed of rawLeadSeeds) {
        const leadCompany = await tx.company.create({
          data: {
            workspaceId: workspace.id,
            name: seed.razaoSocial,
            razaoSocial: seed.razaoSocial,
            cpfCnpj: seed.cnpj,
            tipo: 'PJ',
            cidade: seed.municipio,
            uf: seed.uf,
            tags: ['lead-triagem'],
          },
        });
        const { score } = scoring.score(seed);
        await tx.rawLead.create({
          data: {
            workspaceId: workspace.id,
            razaoSocial: seed.razaoSocial,
            cnpj: seed.cnpj,
            cnaePrincipal: seed.cnaePrincipal,
            cnaeDescricao: seed.cnaeDescricao,
            porte: seed.porte,
            uf: seed.uf,
            municipio: seed.municipio,
            situacao: seed.situacao,
            importador: seed.importador,
            fonte: seed.fonte,
            score,
            promotedCompanyId: leadCompany.id,
          },
        });
      }
      console.log(`${rawLeadSeeds.length} lead(s) fictício(s) criado(s) na triagem.`);
    }
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
