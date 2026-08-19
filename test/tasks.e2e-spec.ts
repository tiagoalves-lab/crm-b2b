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
  _count?: { checklistItems: number; comments: number; attachments: number };
}

interface TaskListBody {
  items: TaskBody[];
}

const prisma = new PrismaClient();

describe('TaskController (e2e)', () => {
  let app: INestApplication;
  let adminApp: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let adminMembership: MembershipContext;
  let companyId: string;
  let contactId: string;
  let otherCompanyContactId: string;
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
        data: { workspaceId: workspace.id, razaoSocial: 'Empresa Tasks' },
      }),
    );
    companyId = company.id;

    const contact = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.contact.create({
        data: { workspaceId: workspace.id, companyId, nome: 'Contato Tasks' },
      }),
    );
    contactId = contact.id;

    const otherCompany = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, razaoSocial: 'Outra Empresa Tasks' },
      }),
    );
    const otherContact = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.contact.create({
        data: {
          workspaceId: workspace.id,
          companyId: otherCompany.id,
          nome: 'Contato de outra empresa',
        },
      }),
    );
    otherCompanyContactId = otherContact.id;

    const adminUserId = randomUUID();
    adminMembership = await withTenant(
      prisma,
      adminUserId,
      workspace.id,
      (tx) =>
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

    app = await createFakeAuthApp(membership);
    adminApp = await createFakeAuthApp(
      adminMembership,
      'admin@gamabrasil.com.br',
    );
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
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await app.close();
    await adminApp.close();
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
      .send({ title: 'Dois alvos', companyId, opportunityId: randomUUID() })
      .expect(400);
  });

  describe('Contato obrigatório pra ligação/reunião/visita/e-mail', () => {
    it('CRÍTICO: rejeita tipo ligação sem contactId', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Ligar sem contato', companyId, tipo: 'ligacao' })
        .expect(400);
    });

    it('CRÍTICO: rejeita tipo e-mail sem contactId', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'E-mail sem contato', companyId, tipo: 'email' })
        .expect(400);
    });

    it('cria tarefa tipo e-mail com contactId da mesma empresa', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({
          title: 'E-mail com contato',
          companyId,
          tipo: 'email',
          contactId,
        })
        .expect(201);
      expect((res.body as { contactId: string }).contactId).toBe(contactId);
    });

    it('cria tarefa tipo reunião com contactId da mesma empresa', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({
          title: 'Reunião com contato',
          companyId,
          tipo: 'reuniao',
          contactId,
        })
        .expect(201);
      expect((res.body as { contactId: string }).contactId).toBe(contactId);
    });

    it('CRÍTICO: rejeita contactId de outra empresa', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({
          title: 'Visita com contato errado',
          companyId,
          tipo: 'visita',
          contactId: otherCompanyContactId,
        })
        .expect(400);
    });

    it('não exige contato pra tipos fora da lista (proposta)', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Enviar proposta', companyId, tipo: 'proposta' })
        .expect(201);
    });
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

  it('PATCH /tasks/:id volta status pra pending (reabrir)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .send({ status: 'pending' })
      .expect(200);
    expect((res.body as TaskBody).status).toBe('pending');
  });

  describe('Cartão — checklist e comentários', () => {
    let itemId: string;
    let commentId: string;

    it('GET /tasks/:id inclui checklistItems e comments vazios', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .expect(200);
      const body = res.body as {
        checklistItems: unknown[];
        comments: unknown[];
      };
      expect(body.checklistItems).toEqual([]);
      expect(body.comments).toEqual([]);
    });

    it('POST /tasks/:id/checklist-items cria item', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/checklist-items`)
        .send({ text: 'Confirmar horário' })
        .expect(201);
      const body = res.body as { id: string; text: string; done: boolean };
      expect(body.text).toBe('Confirmar horário');
      expect(body.done).toBe(false);
      itemId = body.id;
    });

    it('PATCH checklist-items/:itemId marca como feito', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/checklist-items/${itemId}`)
        .send({ done: true })
        .expect(200);
      expect((res.body as { done: boolean }).done).toBe(true);
    });

    it('DELETE checklist-items/:itemId remove', async () => {
      await request(app.getHttpServer())
        .delete(`/tasks/${taskId}/checklist-items/${itemId}`)
        .expect(204);
    });

    it('POST /tasks/:id/comments cria comentário', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/comments`)
        .send({ body: 'Cliente confirmou' })
        .expect(201);
      const body = res.body as { id: string; body: string };
      expect(body.body).toBe('Cliente confirmou');
      commentId = body.id;
    });

    it('GET /tasks (lista) traz _count.comments refletindo o comentário criado (SPEC-CRM-GAMA.md §4.3)', async () => {
      const res = await request(app.getHttpServer()).get('/tasks').expect(200);
      const body = res.body as TaskListBody;
      const task = body.items.find((t) => t.id === taskId);
      expect(task?._count?.comments).toBe(1);
      expect(task?._count?.checklistItems).toBe(0);
    });

    it('CRÍTICO: outro membro (não autor) não pode remover o comentário', async () => {
      await request(adminApp.getHttpServer())
        .delete(`/tasks/${taskId}/comments/${commentId}`)
        .expect(403);
    });

    it('o autor remove o próprio comentário', async () => {
      await request(app.getHttpServer())
        .delete(`/tasks/${taskId}/comments/${commentId}`)
        .expect(204);
    });
  });

  it('DELETE /tasks/:id remove definitivamente (sem soft delete)', async () => {
    await request(app.getHttpServer()).delete(`/tasks/${taskId}`).expect(204);
    await request(app.getHttpServer()).get(`/tasks/${taskId}`).expect(404);
  });
});
