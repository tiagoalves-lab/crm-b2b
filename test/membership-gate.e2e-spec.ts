import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient, type MembershipRole } from '@prisma/client';
import type { TenantTx } from '../src/tenancy/tenant-context.service';
import {
  TenantMembershipGuard,
  type MembershipContext,
} from '../src/tenancy/tenant-membership.guard';

// Prova a decisão da auditoria de 2026-08-20: um login válido do Supabase
// Auth NÃO entra sozinho. Antes, TenantMembershipGuard.ensureMembership
// criava um sales_rep automático pra QUALQUER usuário autenticado — o que
// transformava "ter conta no Supabase" em "ser funcionário da Gama".
// Agora, workspace que já tem membros nega quem não foi cadastrado.
//
// Roda direto no Postgres (mesmo estilo de test/authz.e2e-spec.ts) porque
// o que precisa ser exercitado é a LÓGICA REAL do guard contra a RLS real
// — não o fake que o resto dos e2e usa (test/utils/fake-auth.ts stroca o
// guard inteiro por um stub, então nunca tocaria neste código). O método
// ensureMembership só usa o `tx` que recebe, então o guard é construído
// com dependências vazias e chamado direto; a cadeia HTTP dos guards
// globais já tem cobertura em test/idor.e2e-spec.ts.
//
// Usa um workspace DESCARTÁVEL (slug aleatório), nunca o `gama` de
// produção — importante porque `npm run test:e2e` local pode apontar pro
// Supabase real (ver CLAUDE.md, "não existe banco de teste").

const prisma = new PrismaClient();

const guard = new TenantMembershipGuard(new Reflector(), {} as any, {} as any);

function ensureMembership(
  tx: TenantTx,
  workspaceId: string,
  userId: string,
): Promise<MembershipContext> {
  // ensureMembership é privado — acesso por bracket só pro teste, é
  // justamente o método que a mudança de 2026-08-20 reescreveu.
  return (
    guard as unknown as {
      ensureMembership: (
        tx: TenantTx,
        workspaceId: string,
        userId: string,
      ) => Promise<MembershipContext>;
    }
  ).ensureMembership(tx, workspaceId, userId);
}

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

describe('Portão de acesso — login sem cadastro não entra (auditoria 2026-08-20)', () => {
  let workspace: { id: string };
  let membroCadastrado: string;

  async function criarMembership(role: MembershipRole): Promise<string> {
    const userId = randomUUID();
    await withTenant(userId, workspace.id, (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role,
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    );
    return userId;
  }

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Portao (teste)',
        slug: `gate-test-${Date.now()}`,
      },
    });
    // Semeia um membro real: com o workspace já povoado, o ramo de
    // bootstrap ("primeiro login vira owner") não dispara, e o caminho
    // exercitado é justamente o de negar quem não tem cadastro.
    membroCadastrado = await criarMembership('sales_rep');
  }, 20000);

  afterAll(async () => {
    await withTenant(membroCadastrado, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  });

  it('CRÍTICO: usuário autenticado SEM cadastro é negado (não vira sales_rep)', async () => {
    const invasorSemCadastro = randomUUID();

    await expect(
      withTenant(invasorSemCadastro, workspace.id, (tx) =>
        ensureMembership(tx, workspace.id, invasorSemCadastro),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Confirma no banco que nada foi criado — um "negado" que ainda assim
    // escrevesse seria o pior dos mundos (mesmo princípio de idor.e2e).
    const criado = await withTenant(membroCadastrado, workspace.id, (tx) =>
      tx.membership.findFirst({ where: { userId: invasorSemCadastro } }),
    );
    expect(criado).toBeNull();
  }, 20000);

  it('membro previamente cadastrado continua entrando normalmente', async () => {
    const ctx = await withTenant(membroCadastrado, workspace.id, (tx) =>
      ensureMembership(tx, workspace.id, membroCadastrado),
    );
    expect(ctx.userId).toBe(membroCadastrado);
    expect(ctx.status).toBe('active');
    expect(ctx.role).toBe('sales_rep');
  }, 20000);
});
