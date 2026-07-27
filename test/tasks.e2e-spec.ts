import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface TaskBody {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  companyId: string | null;
}

interface TaskListBody {
  items: TaskBody[];
}

const prisma = new PrismaClient();

describe('TaskController (e2e)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let companyId: string;
  let contactId: string;
  let taskId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Tasks (teste)',
        slug: `tasks-test-${Date.now()}`,
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
        data: { workspaceId: workspace.id, name: 'Empresa Tasks' },
      }),
    );
    companyId = company.id;

    const contact = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.contact.create({
        data: { workspaceId: workspace.id, name: 'Contato Tasks' },
      }),
    );
    contactId = contact.id;

    app = await createFakeAuthApp(membership);
  }, 30000);

  afterAll(async () => {
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.activity.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.task.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.company.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.contact.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await app.close();
    await prisma.$disconnect();
  }, 20000);

  it('POST /tasks cria uma tarefa vinculada a uma company', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'Ligar pro cliente', companyId })
      .expect(201);
    const body = res.body as TaskBody;
    expect(body.title).toBe('Ligar pro cliente');
    expect(body.status).toBe('pending');
    taskId = body.id;
  });

  it('POST /tasks sem nenhum alvo retorna 400', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'Sem alvo' })
      .expect(400);
  });

  it('POST /tasks com dois alvos retorna 400', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .send({ title: 'Dois alvos', companyId, contactId })
      .expect(400);
  });

  it('GET /tasks lista a tarefa criada', async () => {
    const res = await request(app.getHttpServer()).get('/tasks').expect(200);
    const body = res.body as TaskListBody;
    expect(body.items.some((t) => t.id === taskId)).toBe(true);
  });

  it('GET /tasks?companyId filtra pela empresa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks?companyId=${companyId}`)
      .expect(200);
    const body = res.body as TaskListBody;
    expect(body.items.every((t) => t.companyId === companyId)).toBe(true);
  });

  it('PATCH /tasks/:id não aceita trocar o alvo polimórfico (campo ignorado, não faz parte do DTO)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .send({ title: 'Ligar de novo' })
      .expect(200);
    const body = res.body as TaskBody;
    expect(body.title).toBe('Ligar de novo');
    expect(body.companyId).toBe(companyId);
  });

  it('PATCH /tasks/:id com companyId no corpo retorna 400 (whitelist)', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .send({ companyId: randomUUID() })
      .expect(400);
  });

  it('PATCH /tasks/:id status done', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .send({ status: 'done' })
      .expect(200);
    expect((res.body as TaskBody).status).toBe('done');
  });

  it('DELETE /tasks/:id remove definitivamente (sem soft delete)', async () => {
    await request(app.getHttpServer()).delete(`/tasks/${taskId}`).expect(204);
    await request(app.getHttpServer()).get(`/tasks/${taskId}`).expect(404);
  });
});
