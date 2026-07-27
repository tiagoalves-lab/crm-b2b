import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface ActivityBody {
  id: string;
  type: string;
  companyId: string | null;
}

interface ActivityListBody {
  items: ActivityBody[];
}

const prisma = new PrismaClient();

describe('ActivityController (e2e)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let companyId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Activities (teste)',
        slug: `activities-test-${Date.now()}`,
      },
    });
    const userId = randomUUID();
    membership = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    );

    app = await createFakeAuthApp(membership);
  }, 30000);

  afterAll(async () => {
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.activity.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.company.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await app.close();
    await prisma.$disconnect();
  }, 20000);

  it('setup: cria uma company (gera Activity "created" automaticamente)', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .send({ name: 'Empresa com histórico' })
      .expect(201);
    companyId = (res.body as { id: string }).id;
  });

  it('GET /activities?companyId= retorna a timeline da empresa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/activities?companyId=${companyId}`)
      .expect(200);
    const body = res.body as ActivityListBody;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((a) => a.companyId === companyId)).toBe(true);
  });

  it('GET /activities sem nenhum filtro retorna 400', async () => {
    await request(app.getHttpServer()).get('/activities').expect(400);
  });

  it('GET /activities com dois filtros retorna 400', async () => {
    await request(app.getHttpServer())
      .get(`/activities?companyId=${companyId}&contactId=${randomUUID()}`)
      .expect(400);
  });

  it('GET /activities?companyId= de empresa inexistente retorna 404', async () => {
    await request(app.getHttpServer())
      .get(`/activities?companyId=${randomUUID()}`)
      .expect(404);
  });
});
