import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

const prisma = new PrismaClient();

describe('RawLeadController (e2e) — POST /raw-leads/:id/approve (SPEC-CRM-GAMA.md §4.2.1)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: { name: 'Workspace RawLeads (teste)', slug: `raw-leads-test-${Date.now()}` },
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
      tx.rawLead.deleteMany({ where: { workspaceId: workspace.id } }),
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

  it('remove a tag lead-triagem da company e marca o lead como aprovado', async () => {
    const company = await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.company.create({
        data: {
          workspaceId: workspace.id,
          name: 'Empresa do lead a aprovar',
          tags: ['lead-triagem', 'outra-tag'],
        },
      }),
    );
    const lead = await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.rawLead.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Lead a aprovar',
          status: 'novo',
          promotedCompanyId: company.id,
        },
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/raw-leads/${lead.id}/approve`)
      .expect(201);
    const body = res.body as { id: string; tags: string[] };
    expect(body.id).toBe(company.id);
    expect(body.tags).toEqual(['outra-tag']);

    const updated = await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.rawLead.findUniqueOrThrow({ where: { id: lead.id } }),
    );
    expect(updated.status).toBe('aprovado');
  }, 15000);

  it('404 pra lead inexistente', async () => {
    await request(app.getHttpServer())
      .post(`/raw-leads/${randomUUID()}/approve`)
      .expect(404);
  });

  it('400 ao tentar aprovar um lead já aprovado', async () => {
    const company = await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.company.create({
        data: { workspaceId: workspace.id, name: 'Já aprovada', tags: [] },
      }),
    );
    const lead = await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.rawLead.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Já aprovado antes',
          status: 'aprovado',
          promotedCompanyId: company.id,
        },
      }),
    );

    await request(app.getHttpServer())
      .post(`/raw-leads/${lead.id}/approve`)
      .expect(400);
  }, 15000);

  it('400 quando o lead não tem empresa associada', async () => {
    const lead = await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.rawLead.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Lead órfão',
          status: 'novo',
        },
      }),
    );

    await request(app.getHttpServer())
      .post(`/raw-leads/${lead.id}/approve`)
      .expect(400);
  }, 15000);
});
