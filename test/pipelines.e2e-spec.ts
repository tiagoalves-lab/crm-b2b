import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface StageBody {
  id: string;
  name: string;
  order: number;
}

interface PipelineBody {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageBody[];
}

interface PipelineListBody {
  items: PipelineBody[];
}

const prisma = new PrismaClient();

describe('PipelineController (e2e)', () => {
  let app: INestApplication;
  let readonlyApp: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let readonlyMembership: MembershipContext;
  let pipelineId: string;
  let stageId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Pipelines (teste)',
        slug: `pipelines-test-${Date.now()}`,
      },
    });

    const ownerUserId = randomUUID();
    membership = await withTenant(prisma, ownerUserId, workspace.id, (tx) =>
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

    const readonlyUserId = randomUUID();
    readonlyMembership = await withTenant(
      prisma,
      readonlyUserId,
      workspace.id,
      (tx) =>
        tx.membership.create({
          data: {
            workspaceId: workspace.id,
            userId: readonlyUserId,
            role: 'readonly',
            status: 'active',
            joinedAt: new Date(),
          },
        }),
    );

    app = await createFakeAuthApp(membership);
    readonlyApp = await createFakeAuthApp(
      readonlyMembership,
      'readonly@gamabrasil.com.br',
    );
  }, 30000);

  afterAll(async () => {
    // Ordem: activity/opportunity antes de company (mesmo motivo do
    // comentário em test/companies.e2e-spec.ts — FK ON DELETE SET NULL +
    // CHECK de exatamente um relacionamento), depois stage/pipeline,
    // depois membership/workspace.
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
      tx.stage.deleteMany({
        where: { pipeline: { workspaceId: workspace.id } },
      }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.pipeline.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await app.close();
    await readonlyApp.close();
    await prisma.$disconnect();
  }, 20000);

  it('POST /pipelines cria um pipeline (owner)', async () => {
    const res = await request(app.getHttpServer())
      .post('/pipelines')
      .send({ name: 'Funil Padrão', isDefault: true })
      .expect(201);
    const body = res.body as PipelineBody;
    expect(body.name).toBe('Funil Padrão');
    expect(body.isDefault).toBe(true);
    pipelineId = body.id;
  });

  it('POST /pipelines rejeita para papel readonly', async () => {
    await request(readonlyApp.getHttpServer())
      .post('/pipelines')
      .send({ name: 'Outro Funil' })
      .expect(403);
  });

  it('GET /pipelines lista, mesmo para readonly', async () => {
    const res = await request(readonlyApp.getHttpServer())
      .get('/pipelines')
      .expect(200);
    const body = res.body as PipelineListBody;
    expect(body.items.some((p) => p.id === pipelineId)).toBe(true);
  });

  it('POST /pipelines/:id/stages cria um stage', async () => {
    const res = await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/stages`)
      .send({ name: 'Qualificação', order: 1, probability: 20 })
      .expect(201);
    const body = res.body as StageBody;
    expect(body.name).toBe('Qualificação');
    stageId = body.id;
  });

  it('GET /pipelines/:id retorna o pipeline com os stages ordenados', async () => {
    const res = await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}`)
      .expect(200);
    const body = res.body as PipelineBody;
    expect(body.stages.some((s) => s.id === stageId)).toBe(true);
  });

  it('PATCH /pipelines/:pipelineId/stages/:stageId atualiza o stage', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/pipelines/${pipelineId}/stages/${stageId}`)
      .send({ probability: 50 })
      .expect(200);
    const body = res.body as { probability: number };
    expect(body.probability).toBe(50);
  });

  it('segundo pipeline marcado como default desmarca o primeiro', async () => {
    const res = await request(app.getHttpServer())
      .post('/pipelines')
      .send({ name: 'Funil Secundário', isDefault: true })
      .expect(201);
    const secondId = (res.body as PipelineBody).id;

    const first = await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}`)
      .expect(200);
    expect((first.body as PipelineBody).isDefault).toBe(false);

    await request(app.getHttpServer())
      .delete(`/pipelines/${secondId}`)
      .expect(204);
  });

  it('DELETE stage/pipeline com Opportunity associada retorna 409', async () => {
    const company = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.company.create({
          data: { workspaceId: workspace.id, name: 'Empresa pra Opportunity' },
        }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.opportunity.create({
        data: {
          workspaceId: workspace.id,
          companyId: company.id,
          pipelineId,
          stageId,
          ownerUserId: membership.userId,
          amount: 1000,
          currency: 'BRL',
        },
      }),
    );

    await request(app.getHttpServer())
      .delete(`/pipelines/${pipelineId}/stages/${stageId}`)
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/pipelines/${pipelineId}`)
      .expect(409);

    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.opportunity.deleteMany({ where: { workspaceId: workspace.id } }),
    );
  }, 15000);

  it('DELETE /pipelines/:pipelineId/stages/:stageId remove o stage depois de livre', async () => {
    await request(app.getHttpServer())
      .delete(`/pipelines/${pipelineId}/stages/${stageId}`)
      .expect(204);
  });

  it('DELETE /pipelines/:id remove o pipeline depois de livre', async () => {
    await request(app.getHttpServer())
      .delete(`/pipelines/${pipelineId}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}`)
      .expect(404);
  });
});
