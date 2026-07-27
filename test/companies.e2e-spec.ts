import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

// Prova roteamento, ValidationPipe e o ciclo de vida completo (create →
// update → soft-delete → restore) via HTTP real. Sempre com papel "owner"
// pra não misturar com a matriz de RBAC — essa já está coberta em
// test/authz.e2e-spec.ts.

interface CompanyBody {
  id: string;
  name: string;
  ownerUserId: string;
  industry: string | null;
  deletedAt: string | null;
}

interface CompanyListBody {
  items: CompanyBody[];
}

const prisma = new PrismaClient();

describe('CompanyController (e2e)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let companyId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Companies (teste)',
        slug: `companies-test-${Date.now()}`,
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
    // Activity precisa ser limpa antes de Company: a FK
    // activities_company_id_fkey é ON DELETE SET NULL (default do Prisma
    // pra relação opcional), e um SET NULL que zere o único id preenchido
    // de uma Activity viola a CHECK "exatamente um de company/contact/
    // opportunity" — só acontece nesse cleanup de teste porque a API nunca
    // faz hard delete de Company (sempre soft delete via deletedAt).
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
  });

  it('POST /companies cria uma empresa', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .send({ name: 'Empresa E2E' })
      .expect(201);
    const body = res.body as CompanyBody;
    expect(body.name).toBe('Empresa E2E');
    expect(body.ownerUserId).toBe(membership.userId);
    companyId = body.id;
  });

  it('POST /companies rejeita campo desconhecido (whitelist)', async () => {
    await request(app.getHttpServer())
      .post('/companies')
      .send({ name: 'X', notAField: 'bomb' })
      .expect(400);
  });

  it('POST /companies rejeita corpo sem "name"', async () => {
    await request(app.getHttpServer()).post('/companies').send({}).expect(400);
  });

  it('GET /companies lista a empresa criada', async () => {
    const res = await request(app.getHttpServer())
      .get('/companies')
      .expect(200);
    const body = res.body as CompanyListBody;
    expect(body.items.some((c) => c.id === companyId)).toBe(true);
  });

  it('GET /companies/:id retorna a empresa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/companies/${companyId}`)
      .expect(200);
    const body = res.body as CompanyBody;
    expect(body.id).toBe(companyId);
  });

  it('GET /companies/:id com UUID malformado retorna 400', async () => {
    await request(app.getHttpServer()).get('/companies/not-a-uuid').expect(400);
  });

  it('GET /companies/:id inexistente retorna 404', async () => {
    await request(app.getHttpServer())
      .get(`/companies/${randomUUID()}`)
      .expect(404);
  });

  it('PATCH /companies/:id atualiza campos', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/companies/${companyId}`)
      .send({ industry: 'Manufatura' })
      .expect(200);
    const body = res.body as CompanyBody;
    expect(body.industry).toBe('Manufatura');
  });

  it('DELETE /companies/:id soft-deleta, some da listagem padrão', async () => {
    await request(app.getHttpServer())
      .delete(`/companies/${companyId}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/companies')
      .expect(200);
    const body = res.body as CompanyListBody;
    expect(body.items.some((c) => c.id === companyId)).toBe(false);
  });

  it('GET /companies/:id depois do soft-delete retorna 404', async () => {
    await request(app.getHttpServer())
      .get(`/companies/${companyId}`)
      .expect(404);
  });

  it('POST /companies/:id/restore restaura a empresa', async () => {
    const res = await request(app.getHttpServer())
      .post(`/companies/${companyId}/restore`)
      .expect(201);
    const body = res.body as CompanyBody;
    expect(body.deletedAt).toBeNull();

    await request(app.getHttpServer())
      .get(`/companies/${companyId}`)
      .expect(200);
  });
});
