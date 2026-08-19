import { randomUUID } from 'node:crypto';
import { PrismaClient, type MembershipRole } from '@prisma/client';
import { PolicyService } from '../src/policy/policy.service';
import type { TenantTx } from '../src/tenancy/tenant-context.service';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';

// Prova o critério de saída da Fase 2 (núcleo, ver docs/roadmap.md):
// "dois usuários em papéis diferentes no mesmo workspace têm acesso de
// dados visivelmente distinto". Roda direto no Postgres via Prisma (mesmo
// estilo de test/rls-isolation.e2e-spec.ts) porque o que precisa ser
// provado é RLS (fronteira de workspace, Fase 1) + PolicyService
// (fronteira de ownership dentro do workspace) trabalhando juntos — não
// vale a pena bootstrapar o Nest inteiro (guard JWT etc.) só pra isso; a
// verificação de JWT em si já tem cobertura própria em
// src/auth/verify-supabase-jwt.spec.ts.

const prisma = new PrismaClient();
const policy = new PolicyService();

describe('Autorização por papel — RBAC + ownership (Fase 2, núcleo)', () => {
  let workspace: { id: string };
  let owner: MembershipContext;
  let manager: MembershipContext;
  let salesRep: MembershipContext;
  let otherSalesRep: MembershipContext;
  let companyOwnedBySalesRep: { id: string; ownerUserId: string | null };
  let companyOwnedByOther: { id: string; ownerUserId: string | null };

  // `role` default 'owner': bypassa a policy de papel de SPEC-CRM-GAMA.md
  // §7.5 (necessário pra qualquer INSERT com RETURNING funcionar — ver
  // migration 20260731210000). Os testes que precisam simular o papel
  // real (abaixo, "sales_rep só vê...", "manager vê...", "owner vê...")
  // passam o role explícito de propósito.
  function withTenant<T>(
    userId: string,
    workspaceId: string,
    fn: (tx: TenantTx) => Promise<T>,
    role: string = 'owner',
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_workspace_id = '${workspaceId}'`,
      );
      await tx.$executeRawUnsafe(`SET LOCAL "app.current_role" = '${role}'`);
      return fn(tx);
    });
  }

  async function createMembership(
    role: MembershipRole,
    managerId: string | null,
  ): Promise<MembershipContext> {
    const userId = randomUUID();
    return withTenant(userId, workspace.id, (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role,
          managerId,
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    );
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Authz (teste)',
        slug: `authz-test-${Date.now()}`,
      },
    });

    owner = await createMembership('owner', null);
    manager = await createMembership('manager', null);
    salesRep = await createMembership('sales_rep', manager.id);
    otherSalesRep = await createMembership('sales_rep', null);

    companyOwnedBySalesRep = await withTenant(
      salesRep.userId,
      workspace.id,
      (tx) =>
        tx.company.create({
          data: {
            workspaceId: workspace.id,
            razaoSocial: 'Empresa do sales_rep',
            ownerUserId: salesRep.userId,
          },
        }),
    );
    companyOwnedByOther = await withTenant(
      otherSalesRep.userId,
      workspace.id,
      (tx) =>
        tx.company.create({
          data: {
            workspaceId: workspace.id,
            razaoSocial: 'Empresa de outra pessoa',
            ownerUserId: otherSalesRep.userId,
          },
        }),
    );
  }, 20000);

  afterAll(async () => {
    await withTenant(owner.userId, workspace.id, (tx) =>
      tx.company.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(owner.userId, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  });

  it('sales_rep só vê a própria empresa, não a de outro sales_rep', async () => {
    const visible = await withTenant(
      salesRep.userId,
      workspace.id,
      async (tx) => {
        const filter = await policy.scopeFilter(tx, salesRep);
        return tx.company.findMany({
          where: { workspaceId: workspace.id, ...filter },
        });
      },
      salesRep.role,
    );
    const ids = visible.map((c) => c.id);
    expect(ids).toContain(companyOwnedBySalesRep.id);
    expect(ids).not.toContain(companyOwnedByOther.id);
  });

  it('CRÍTICO: manager vê a empresa do subordinado além da própria, mas não a de quem não é subordinado', async () => {
    const visible = await withTenant(
      manager.userId,
      workspace.id,
      async (tx) => {
        const filter = await policy.scopeFilter(tx, manager);
        return tx.company.findMany({
          where: { workspaceId: workspace.id, ...filter },
        });
      },
      manager.role,
    );
    const ids = visible.map((c) => c.id);
    expect(ids).toContain(companyOwnedBySalesRep.id);
    expect(ids).not.toContain(companyOwnedByOther.id);
  });

  it('owner vê todas as empresas do workspace, sem filtro de ownership', async () => {
    const visible = await withTenant(
      owner.userId,
      workspace.id,
      async (tx) => {
        const filter = await policy.scopeFilter(tx, owner);
        return tx.company.findMany({
          where: { workspaceId: workspace.id, ...filter },
        });
      },
      owner.role,
    );
    const ids = visible.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        companyOwnedBySalesRep.id,
        companyOwnedByOther.id,
      ]),
    );
  });

  it('CRÍTICO: can() nega ação de sales_rep sobre empresa de outra pessoa', async () => {
    await withTenant(salesRep.userId, workspace.id, async (tx) => {
      await expect(
        policy.can(
          tx,
          salesRep,
          'write',
          { ownerUserId: companyOwnedByOther.ownerUserId },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
      await expect(
        policy.can(
          tx,
          salesRep,
          'write',
          { ownerUserId: companyOwnedBySalesRep.ownerUserId },
          'empresas_cadastro',
        ),
      ).resolves.toBe(true);
    });
  });

  it('CRÍTICO: sales_rep não pode excluir nenhum registro, nem o próprio (2026-08-06)', async () => {
    await withTenant(salesRep.userId, workspace.id, async (tx) => {
      await expect(
        policy.can(
          tx,
          salesRep,
          'delete',
          { ownerUserId: companyOwnedBySalesRep.ownerUserId },
          'empresas_cadastro',
        ),
      ).resolves.toBe(false);
    });
  });
});
