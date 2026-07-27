import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface ContactBody {
  id: string;
  name: string;
  title: string | null;
  deletedAt: string | null;
}

const prisma = new PrismaClient();

describe('ContactController (e2e)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let contactId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Contacts (teste)',
        slug: `contacts-test-${Date.now()}`,
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
    // Ver comentário equivalente em test/companies.e2e-spec.ts — Activity
    // antes de Contact pelo mesmo motivo (FK ON DELETE SET NULL + CHECK
    // de exatamente um relacionamento).
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.activity.deleteMany({ where: { workspaceId: workspace.id } }),
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
  });

  it('POST /contacts cria um contato', async () => {
    const res = await request(app.getHttpServer())
      .post('/contacts')
      .send({ name: 'Fulano de Tal', email: 'fulano@exemplo-teste.com' })
      .expect(201);
    const body = res.body as ContactBody;
    expect(body.name).toBe('Fulano de Tal');
    contactId = body.id;
  });

  it('POST /contacts rejeita e-mail duplicado no mesmo workspace', async () => {
    await request(app.getHttpServer())
      .post('/contacts')
      .send({ name: 'Outro Nome', email: 'fulano@exemplo-teste.com' })
      .expect(409);
  });

  it('POST /contacts rejeita e-mail malformado', async () => {
    await request(app.getHttpServer())
      .post('/contacts')
      .send({ name: 'X', email: 'nao-e-email' })
      .expect(400);
  });

  it('GET /contacts/:id retorna o contato', async () => {
    const res = await request(app.getHttpServer())
      .get(`/contacts/${contactId}`)
      .expect(200);
    const body = res.body as ContactBody;
    expect(body.id).toBe(contactId);
  });

  it('PATCH /contacts/:id atualiza campos', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/contacts/${contactId}`)
      .send({ title: 'Diretor' })
      .expect(200);
    const body = res.body as ContactBody;
    expect(body.title).toBe('Diretor');
  });

  it('DELETE /contacts/:id soft-deleta e POST restore reverte', async () => {
    await request(app.getHttpServer())
      .delete(`/contacts/${contactId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/contacts/${contactId}`)
      .expect(404);

    const res = await request(app.getHttpServer())
      .post(`/contacts/${contactId}/restore`)
      .expect(201);
    const body = res.body as ContactBody;
    expect(body.deletedAt).toBeNull();
  });
});
