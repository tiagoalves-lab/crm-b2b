import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface OpportunityBody {
  id: string;
  status: string;
  version: number;
  lostReason: string | null;
  stageId: string;
  closedAt: string | null;
}

const prisma = new PrismaClient();

describe('OpportunityController (e2e)', () => {
  let app: INestApplication;
  let adminApp: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let adminMembership: MembershipContext;
  let companyId: string;
  let pipelineId: string;
  let stageAId: string;
  let stageBId: string;
  let opportunityId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Opportunities (teste)',
        slug: `opportunities-test-${Date.now()}`,
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

    const company = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, razaoSocial: 'Empresa Opportunities' },
      }),
    );
    companyId = company.id;

    const pipeline = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.pipeline.create({
        data: { workspaceId: workspace.id, name: 'Funil de teste' },
      }),
    );
    pipelineId = pipeline.id;

    const stageA = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.stage.create({
        data: { pipelineId, name: 'A', order: 1, probability: 20 },
      }),
    );
    stageAId = stageA.id;
    const stageB = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.stage.create({
        data: { pipelineId, name: 'B', order: 2, probability: 60 },
      }),
    );
    stageBId = stageB.id;

    app = await createFakeAuthApp(membership);

    const adminUserId = randomUUID();
    adminMembership = await withTenant(prisma, adminUserId, workspace.id, (tx) =>
      tx.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: adminUserId,
          role: 'admin',
          status: 'active',
          joinedAt: new Date(),
        },
      }),
    );
    adminApp = await createFakeAuthApp(adminMembership);
  }, 30000);

  afterAll(async () => {
    await adminApp.close();
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.activity.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.opportunity.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.company.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.stage.deleteMany({ where: { pipelineId } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.pipeline.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await app.close();
    await prisma.$disconnect();
  }, 20000);

  it('POST /opportunities cria uma oportunidade "open"', async () => {
    const res = await request(app.getHttpServer())
      .post('/opportunities')
      .send({
        companyId,
        pipelineId,
        stageId: stageAId,
        amount: 5000,
        currency: 'BRL',
      })
      .expect(201);
    const body = res.body as OpportunityBody;
    expect(body.status).toBe('open');
    expect(body.version).toBe(1);
    opportunityId = body.id;
  });

  it('GET /opportunities?companyId= filtra pela empresa (ficha, SPEC-CRM-GAMA.md §4.1)', async () => {
    const outraCompany = await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, razaoSocial: 'Empresa sem oportunidade' },
      }),
    );
    const res = await request(app.getHttpServer())
      .get(`/opportunities?companyId=${companyId}`)
      .expect(200);
    const body = res.body as { items: OpportunityBody[] };
    expect(body.items.some((o) => o.id === opportunityId)).toBe(true);

    const empty = await request(app.getHttpServer())
      .get(`/opportunities?companyId=${outraCompany.id}`)
      .expect(200);
    expect((empty.body as { items: OpportunityBody[] }).items).toHaveLength(0);
  });

  it('POST /opportunities rejeita status/lostReason no corpo (não whitelisted)', async () => {
    await request(app.getHttpServer())
      .post('/opportunities')
      .send({
        companyId,
        pipelineId,
        stageId: stageAId,
        amount: 100,
        currency: 'BRL',
        status: 'won',
      })
      .expect(400);
  });

  it('PATCH sem version é rejeitado pelo ValidationPipe', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ amount: 6000 })
      .expect(400);
  });

  it('PATCH com stage de outro pipeline (sem pipelineId) é aceito só se pertencer ao mesmo pipeline', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 1, stageId: stageBId })
      .expect(200);
    const body = res.body as OpportunityBody;
    expect(body.stageId).toBe(stageBId);
    expect(body.version).toBe(2);
  });

  it('PATCH status "lost" sem lostReason retorna 400', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 2, status: 'lost' })
      .expect(400);
  });

  it('PATCH com version desatualizada retorna 409', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 1, amount: 7000 })
      .expect(409);
  });

  it('PATCH status "won" fecha a oportunidade (closedAt preenchido)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 2, status: 'won' })
      .expect(200);
    const body = res.body as OpportunityBody;
    expect(body.status).toBe('won');
    expect(body.closedAt).not.toBeNull();
  });

  it('PATCH won -> lost direto é bloqueado (precisa reabrir primeiro)', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 3, status: 'lost', lostReason: 'Motivo' })
      .expect(400);
  });

  it('PATCH won -> open reabre, depois open -> lost com motivo funciona', async () => {
    const reopened = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 3, status: 'open' })
      .expect(200);
    expect((reopened.body as OpportunityBody).closedAt).toBeNull();

    const lost = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({
        version: 4,
        status: 'lost',
        lostReason: 'Perdeu pro concorrente',
      })
      .expect(200);
    const body = lost.body as OpportunityBody;
    expect(body.status).toBe('lost');
    expect(body.lostReason).toBe('Perdeu pro concorrente');
  });

  it('CRÍTICO: duas atualizações concorrentes com a mesma version — só uma vence', async () => {
    // Reabre pra poder editar de novo, pega a version atual.
    const reopened = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 5, status: 'open' })
      .expect(200);
    const version = (reopened.body as OpportunityBody).version;

    const [first, second] = await Promise.allSettled([
      request(app.getHttpServer())
        .patch(`/opportunities/${opportunityId}`)
        .send({ version, amount: 1111 }),
      request(app.getHttpServer())
        .patch(`/opportunities/${opportunityId}`)
        .send({ version, amount: 2222 }),
    ]);

    const statuses = [first, second].map((r) =>
      r.status === 'fulfilled' ? r.value.status : -1,
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);
  }, 15000);

  describe('Card — chat de comentários (feature nova, fora do SPEC-CRM-GAMA.md)', () => {
    let commentId: string;

    it('GET /opportunities/:id inclui comments vazio', async () => {
      const res = await request(app.getHttpServer())
        .get(`/opportunities/${opportunityId}`)
        .expect(200);
      expect((res.body as { comments: unknown[] }).comments).toEqual([]);
    });

    it('POST /opportunities/:id/comments cria comentário', async () => {
      const res = await request(app.getHttpServer())
        .post(`/opportunities/${opportunityId}/comments`)
        .send({ body: 'Cliente pediu desconto' })
        .expect(201);
      const body = res.body as { id: string; body: string };
      expect(body.body).toBe('Cliente pediu desconto');
      commentId = body.id;
    });

    it('GET /opportunities/:id traz o comentário criado', async () => {
      const res = await request(app.getHttpServer())
        .get(`/opportunities/${opportunityId}`)
        .expect(200);
      const comments = (res.body as { comments: { id: string }[] }).comments;
      expect(comments.some((c) => c.id === commentId)).toBe(true);
    });

    it('CRÍTICO: outro membro (não autor) não pode remover o comentário', async () => {
      await request(adminApp.getHttpServer())
        .delete(`/opportunities/${opportunityId}/comments/${commentId}`)
        .expect(403);
    });

    it('o autor remove o próprio comentário', async () => {
      await request(app.getHttpServer())
        .delete(`/opportunities/${opportunityId}/comments/${commentId}`)
        .expect(204);
    });
  });

  it('DELETE soft-deleta e POST restore reverte', async () => {
    await request(app.getHttpServer())
      .delete(`/opportunities/${opportunityId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/opportunities/${opportunityId}`)
      .expect(404);

    const res = await request(app.getHttpServer())
      .post(`/opportunities/${opportunityId}/restore`)
      .expect(201);
    expect((res.body as { deletedAt: string | null }).deletedAt).toBeNull();
  });

  it('GET /opportunities?staleDays= só retorna deals parados há tempo suficiente (Fase 4)', async () => {
    const created = await request(app.getHttpServer())
      .post('/opportunities')
      .send({
        companyId,
        pipelineId,
        stageId: stageAId,
        amount: 1,
        currency: 'BRL',
      })
      .expect(201);
    const staleId = (created.body as OpportunityBody).id;

    // Backdata created_at direto no banco — não dá pra simular "10 dias
    // atrás" via API, e é exatamente isso que o COALESCE(stage_change,
    // created_at) do service usa quando a oportunidade nunca mudou de
    // stage.
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE "opportunities" SET "created_at" = NOW() - INTERVAL '10 days' WHERE "id" = '${staleId}'`,
      ),
    );

    const stale = await request(app.getHttpServer())
      .get('/opportunities?staleDays=5')
      .expect(200);
    expect(
      (stale.body as { items: OpportunityBody[] }).items.some(
        (o) => o.id === staleId,
      ),
    ).toBe(true);

    const notStale = await request(app.getHttpServer())
      .get('/opportunities?staleDays=30')
      .expect(200);
    expect(
      (notStale.body as { items: OpportunityBody[] }).items.some(
        (o) => o.id === staleId,
      ),
    ).toBe(false);
  }, 15000);
});
