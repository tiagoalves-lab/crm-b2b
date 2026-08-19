import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface SearchResult {
  id: string;
  origem: string;
  nome: string;
  cnpj: string | null;
}

const prisma = new PrismaClient();

describe('SearchController (e2e) — GET /busca-empresa-lead (SPEC-CRM-GAMA.md §3.5/§4.2.1)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let companyId: string;
  let leadId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Search (teste)',
        slug: `search-test-${Date.now()}`,
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
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Metalúrgica Busca Ltda',
          cpfCnpj: '11222333000181',
        },
      }),
    );
    companyId = company.id;

    // Company "sombra" da triagem — deve ficar de fora da busca por
    // origem='empresa' (tag lead-triagem), mas aparece via raw_leads.
    const leadCompany = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.company.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Empresa ainda em triagem',
          tags: ['lead-triagem'],
        },
      }),
    );

    const lead = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.rawLead.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Busca Fundição Triagem',
          cnpj: '99888777000166',
          status: 'novo',
          promotedCompanyId: leadCompany.id,
        },
      }),
    );
    leadId = lead.id;

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

  it('com menos de 2 caracteres retorna lista vazia (sem erro)', async () => {
    const res = await request(app.getHttpServer())
      .get('/busca-empresa-lead?q=a')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('casa empresa cadastrada por nome', async () => {
    const res = await request(app.getHttpServer())
      .get('/busca-empresa-lead?q=Metalúrgica Busca')
      .expect(200);
    const body = res.body as SearchResult[];
    expect(body.some((r) => r.id === companyId && r.origem === 'empresa')).toBe(
      true,
    );
  });

  it('casa empresa cadastrada por CNPJ', async () => {
    const res = await request(app.getHttpServer())
      .get('/busca-empresa-lead?q=11222333000181')
      .expect(200);
    const body = res.body as SearchResult[];
    expect(body.some((r) => r.id === companyId)).toBe(true);
  });

  it('casa lead em triagem (origem=lead), não a company-sombra dele', async () => {
    const res = await request(app.getHttpServer())
      .get('/busca-empresa-lead?q=Busca Fundição')
      .expect(200);
    const body = res.body as SearchResult[];
    expect(body.some((r) => r.id === leadId && r.origem === 'lead')).toBe(true);
    expect(body.every((r) => r.origem === 'lead' || r.id !== leadId)).toBe(
      true,
    );
  });

  it('não retorna a company marcada como lead-triagem via origem=empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/busca-empresa-lead?q=triagem')
      .expect(200);
    const body = res.body as SearchResult[];
    expect(
      body.some(
        (r) => r.origem === 'empresa' && r.nome === 'Empresa ainda em triagem',
      ),
    ).toBe(false);
  });
});
