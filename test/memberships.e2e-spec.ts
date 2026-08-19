import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface MembershipBody {
  id: string;
  role: string;
  status: string;
  managerId: string | null;
}

const prisma = new PrismaClient();

describe('MembershipController (e2e)', () => {
  let app: INestApplication;
  let readonlyApp: INestApplication;
  let workspace: { id: string };
  let owner: MembershipContext;
  let repMembership: MembershipContext;
  let deletableMembership: MembershipContext;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Memberships (teste)',
        slug: `memberships-test-${Date.now()}`,
      },
    });

    const ownerUserId = randomUUID();
    owner = await withTenant(prisma, ownerUserId, workspace.id, (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: ownerUserId,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    );

    const repUserId = randomUUID();
    repMembership = await withTenant(prisma, repUserId, workspace.id, (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: repUserId,
          role: 'sales_rep',
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    );

    const deletableUserId = randomUUID();
    deletableMembership = await withTenant(
      prisma,
      deletableUserId,
      workspace.id,
      (tx) =>
        tx.membership.create({
          data: {
            workspaceId: workspace.id,
            userId: deletableUserId,
            role: 'sales_rep',
            status: 'active',
            joinedAt: new Date(),
          },
        }),
    );

    app = await createFakeAuthApp(owner, 'owner@gamabrasil.com.br');
    readonlyApp = await createFakeAuthApp(
      repMembership,
      'rep@gamabrasil.com.br',
    );
  }, 30000);

  afterAll(async () => {
    await withTenant(prisma, owner.userId, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await app.close();
    await readonlyApp.close();
    await prisma.$disconnect();
  }, 20000);

  it('GET /memberships lista os membros, mesmo pra sales_rep', async () => {
    const res = await request(readonlyApp.getHttpServer())
      .get('/memberships')
      .expect(200);
    const body = res.body as MembershipBody[];
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  it('PATCH /memberships/:id rejeitado pra sales_rep (403)', async () => {
    await request(readonlyApp.getHttpServer())
      .patch(`/memberships/${repMembership.id}`)
      .send({ role: 'manager' })
      .expect(403);
  });

  it('PATCH /memberships/:id promove sales_rep pra manager e seta managerId', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/memberships/${repMembership.id}`)
      .send({ role: 'manager', managerId: owner.id })
      .expect(200);
    const body = res.body as MembershipBody;
    expect(body.role).toBe('manager');
    expect(body.managerId).toBe(owner.id);
  });

  it('PATCH /memberships/:id rejeita gerente ser o próprio membro', async () => {
    await request(app.getHttpServer())
      .patch(`/memberships/${repMembership.id}`)
      .send({ managerId: repMembership.id })
      .expect(400);
  });

  it('CRÍTICO: PATCH bloqueia rebaixar o último owner ativo', async () => {
    await request(app.getHttpServer())
      .patch(`/memberships/${owner.id}`)
      .send({ role: 'admin' })
      .expect(400);
  });

  it('promove o segundo membro a owner e então permite rebaixar o primeiro', async () => {
    await request(app.getHttpServer())
      .patch(`/memberships/${repMembership.id}`)
      .send({ role: 'owner' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/memberships/${owner.id}`)
      .send({ role: 'admin' })
      .expect(200);
  });

  it('DELETE /memberships/:id rejeitado pra sales_rep (403)', async () => {
    await request(readonlyApp.getHttpServer())
      .delete(`/memberships/${deletableMembership.id}`)
      .expect(403);
  });

  it('DELETE /memberships/:id remove um membro comum', async () => {
    await request(app.getHttpServer())
      .delete(`/memberships/${deletableMembership.id}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/memberships')
      .expect(200)
      .expect((res) => {
        const body = res.body as MembershipBody[];
        expect(
          body.find((m) => m.id === deletableMembership.id),
        ).toBeUndefined();
      });
  });

  it('CRÍTICO: DELETE bloqueia remover o último owner ativo', async () => {
    // Neste ponto do arquivo, repMembership é o único owner ativo (ver
    // teste "promove o segundo membro a owner e então permite rebaixar o
    // primeiro" acima — owner virou admin).
    await request(app.getHttpServer())
      .delete(`/memberships/${repMembership.id}`)
      .expect(400);
  });

  it('DELETE 404 pra id inexistente', async () => {
    await request(app.getHttpServer())
      .delete(`/memberships/${randomUUID()}`)
      .expect(404);
  });
});
