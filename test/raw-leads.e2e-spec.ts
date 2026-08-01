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
      data: {
        name: 'Workspace RawLeads (teste)',
        slug: `raw-leads-test-${Date.now()}`,
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
    const company = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.company.create({
          data: {
            workspaceId: workspace.id,
            razaoSocial: 'Empresa do lead a aprovar',
            tags: ['lead-triagem', 'outra-tag'],
          },
        }),
    );
    const lead = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
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

    const updated = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) => tx.rawLead.findUniqueOrThrow({ where: { id: lead.id } }),
    );
    expect(updated.status).toBe('aprovado');
  }, 15000);

  it('404 pra lead inexistente', async () => {
    await request(app.getHttpServer())
      .post(`/raw-leads/${randomUUID()}/approve`)
      .expect(404);
  });

  it('400 ao tentar aprovar um lead já aprovado', async () => {
    const company = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.company.create({
          data: { workspaceId: workspace.id, razaoSocial: 'Já aprovada', tags: [] },
        }),
    );
    const lead = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
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
    const lead = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
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

describe('RawLeadController (e2e) — CRUD + score (SPEC-CRM-GAMA.md §4.4)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace RawLeads CRUD (teste)',
        slug: `raw-leads-crud-test-${Date.now()}`,
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
      tx.rawLead.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    // RawLeadService.create() cria a company-lead via CompanyService, que
    // emite uma Activity — precisa sair primeiro, senão o hard delete da
    // company tenta SET NULL em activities.company_id e bate no CHECK
    // activities_exactly_one_relation (mesmo padrão de companies.e2e-spec.ts).
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

  it('POST /raw-leads calcula o score e já cria a company-lead com a tag lead-triagem', async () => {
    const res = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Metalúrgica Quente Ltda',
        cnpj: '11.111.111/0001-11',
        cnaePrincipal: '2511-0',
        porte: 'GRANDE',
        situacao: 'ATIVA',
        uf: 'RS',
        municipio: 'Caxias do Sul',
        importador: true,
        fonte: 'econodata',
      })
      .expect(201);
    const body = res.body as {
      id: string;
      score: number;
      status: string;
      promotedCompanyId: string;
    };
    expect(body.score).toBe(100);
    expect(body.status).toBe('novo');
    expect(body.promotedCompanyId).toBeTruthy();

    const company = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.company.findUniqueOrThrow({ where: { id: body.promotedCompanyId } }),
    );
    expect(company.tags).toContain('lead-triagem');
    expect(company.razaoSocial).toBe('Metalúrgica Quente Ltda');
  }, 15000);

  it('GET /raw-leads lista só status=novo por padrão, ordenado por score desc', async () => {
    await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Lead Frio Ltda',
        cnaePrincipal: '4663-0',
        situacao: 'ATIVA',
        uf: 'RS',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/raw-leads')
      .expect(200);
    const body = res.body as {
      items: Array<{ razaoSocial: string; score: number; status: string }>;
    };
    expect(body.items.every((i) => i.status === 'novo')).toBe(true);
    const scores = body.items.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  }, 15000);

  it('GET /raw-leads?tier=quente filtra por faixa de score', async () => {
    const res = await request(app.getHttpServer())
      .get('/raw-leads?tier=quente')
      .expect(200);
    const body = res.body as { items: Array<{ score: number }> };
    expect(body.items.every((i) => i.score >= 70)).toBe(true);
  });

  it('POST /raw-leads/:id/discard marca descartado e preserva a company-lead', async () => {
    const created = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({ razaoSocial: 'Lead a descartar', situacao: 'ATIVA', uf: 'RS' })
      .expect(201);
    const lead = created.body as { id: string; promotedCompanyId: string };

    const res = await request(app.getHttpServer())
      .post(`/raw-leads/${lead.id}/discard`)
      .expect(201);
    expect((res.body as { status: string }).status).toBe('descartado');

    // Decisão do usuário (2026-07-31): descartar não apaga nem soft-deleta
    // a company-lead — continua intacta, só invisível pela tag.
    const company = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.company.findUniqueOrThrow({ where: { id: lead.promotedCompanyId } }),
    );
    expect(company.deletedAt).toBeNull();
    expect(company.tags).toContain('lead-triagem');
  }, 15000);

  it('POST /raw-leads/bulk-approve aprova em lote e reporta falhas individualmente', async () => {
    const a = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({ razaoSocial: 'Lote A', situacao: 'ATIVA', uf: 'RS' })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({ razaoSocial: 'Lote B', situacao: 'ATIVA', uf: 'RS' })
      .expect(201);
    const leadA = a.body as { id: string };
    const leadB = b.body as { id: string };

    const res = await request(app.getHttpServer())
      .post('/raw-leads/bulk-approve')
      .send({ ids: [leadA.id, leadB.id, randomUUID()] })
      .expect(201);
    const body = res.body as { ok: string[]; failed: Array<{ id: string }> };
    expect(body.ok).toEqual(expect.arrayContaining([leadA.id, leadB.id]));
    expect(body.failed).toHaveLength(1);
  }, 15000);

  it('POST /raw-leads/bulk-discard descarta em lote', async () => {
    const a = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({ razaoSocial: 'Descarte Lote A', situacao: 'ATIVA', uf: 'RS' })
      .expect(201);
    const leadA = a.body as { id: string };

    const res = await request(app.getHttpServer())
      .post('/raw-leads/bulk-discard')
      .send({ ids: [leadA.id] })
      .expect(201);
    const body = res.body as { ok: string[]; failed: unknown[] };
    expect(body.ok).toEqual([leadA.id]);
    expect(body.failed).toHaveLength(0);
  }, 15000);

  it('POST /raw-leads/rescore recalcula o score dos leads novo do workspace', async () => {
    const created = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Lead pra recalcular',
        cnaePrincipal: '2511-0',
        situacao: 'ATIVA',
        uf: 'RS',
      })
      .expect(201);
    const lead = created.body as { id: string; score: number };

    // Muda o score direto no banco (fora do fluxo normal) pra simular
    // dado desatualizado, e confirma que o rescore corrige.
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.rawLead.update({ where: { id: lead.id }, data: { score: 0 } }),
    );

    const res = await request(app.getHttpServer())
      .post('/raw-leads/rescore')
      .expect(201);
    expect((res.body as { updated: number }).updated).toBeGreaterThanOrEqual(1);

    const updated = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) => tx.rawLead.findUniqueOrThrow({ where: { id: lead.id } }),
    );
    expect(updated.score).toBe(lead.score);
  }, 15000);

  it('GET /raw-leads/:id devolve 404 pra lead de outro workspace', async () => {
    const otherWorkspace = await prisma.workspace.create({
      data: {
        name: 'Outro workspace (teste)',
        slug: `raw-leads-other-${Date.now()}`,
      },
    });
    const otherLead = await withTenant(
      prisma,
      membership.userId,
      otherWorkspace.id,
      (tx) =>
        tx.rawLead.create({
          data: {
            workspaceId: otherWorkspace.id,
            razaoSocial: 'Lead de outro workspace',
          },
        }),
    );

    await request(app.getHttpServer())
      .get(`/raw-leads/${otherLead.id}`)
      .expect(404);

    // prisma "cru" (sem SET LOCAL app.current_workspace_id) bate no RLS
    // fail-closed e apaga 0 linhas silenciosamente — precisa de withTenant
    // mesmo pra cleanup, igual ao resto do arquivo.
    await withTenant(prisma, membership.userId, otherWorkspace.id, (tx) =>
      tx.rawLead.deleteMany({ where: { workspaceId: otherWorkspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } });
  }, 15000);
});
