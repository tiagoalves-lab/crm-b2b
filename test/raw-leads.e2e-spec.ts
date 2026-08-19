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
    // approve() (SPEC §4.2.1) agora emite uma Activity "lead_approved"
    // ligada à company — precisa sumir antes da company, senão o
    // ON DELETE SET NULL do FK deixa companyId/opportunityId nulos ao
    // mesmo tempo e viola o CHECK "activities_exactly_one_relation"
    // (mesmo gotcha já documentado pra Task/Kanban).
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
          data: {
            workspaceId: workspace.id,
            razaoSocial: 'Já aprovada',
            tags: [],
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
    // Caixa alta: RawLeadService#create() normaliza a razão social
    // (padronização pedida pelo usuário em 2026-08-10). Estas asserções
    // ficaram desatualizadas na época e ninguém viu, porque o CI
    // disparava numa branch que não existe — corrigido em 2026-08-12
    // junto com o gatilho do workflow (docs/seguranca.md, decisão 6.1).
    expect(company.razaoSocial).toBe('METALÚRGICA QUENTE LTDA');
  }, 15000);

  // Indicativo "EM RECUPERAÇÃO JUDICIAL" da Receita Federal (pedido
  // direto do usuário, 2026-08-05) — ver src/common/sanitize-razao-social.ts.
  // Confirma que tanto o RawLead quanto a Company criada junto ficam
  // marcados e com a razão social já sem o aviso.
  it('POST /raw-leads detecta "EM RECUPERAÇÃO JUDICIAL" e limpa a razão social no lead e na company', async () => {
    const res = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Metalúrgica RJ Ltda EM RECUPERACAO JUDICIAL',
        situacao: 'ATIVA',
        uf: 'RS',
      })
      .expect(201);
    const body = res.body as {
      razaoSocial: string;
      emRecuperacaoJudicial: boolean;
      promotedCompanyId: string;
    };
    // Caixa alta pelo mesmo motivo do teste anterior — o que este caso
    // prova de específico é que o aviso "EM RECUPERACAO JUDICIAL" saiu
    // da razão social, não a caixa das letras.
    expect(body.razaoSocial).toBe('METALÚRGICA RJ LTDA');
    expect(body.emRecuperacaoJudicial).toBe(true);

    const company = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.company.findUniqueOrThrow({ where: { id: body.promotedCompanyId } }),
    );
    expect(company.razaoSocial).toBe('METALÚRGICA RJ LTDA');
    expect(company.emRecuperacaoJudicial).toBe(true);
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

  it('PATCH /raw-leads/:id/tier sobrepõe a classificação automática (na leitura e no filtro)', async () => {
    const created = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Lead pra classificar na mão',
        cnaePrincipal: '4663-0', // fora do CNAE alvo → score baixo (frio)
        situacao: 'ATIVA',
        uf: 'RS',
      })
      .expect(201);
    const lead = created.body as { id: string; score: number };
    expect(lead.score).toBeLessThan(45);

    const patched = await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/tier`)
      .send({ tier: 'quente' })
      .expect(200);
    expect((patched.body as { manualTier: string }).manualTier).toBe('quente');

    const quentes = await request(app.getHttpServer())
      .get('/raw-leads?tier=quente')
      .expect(200);
    const quentesBody = quentes.body as { items: Array<{ id: string }> };
    expect(quentesBody.items.map((i) => i.id)).toContain(lead.id);

    const frios = await request(app.getHttpServer())
      .get('/raw-leads?tier=frio')
      .expect(200);
    const friosBody = frios.body as { items: Array<{ id: string }> };
    expect(friosBody.items.map((i) => i.id)).not.toContain(lead.id);

    // tier: null limpa a marcação manual e volta pro cálculo automático.
    const cleared = await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/tier`)
      .send({ tier: null })
      .expect(200);
    expect(
      (cleared.body as { manualTier: string | null }).manualTier,
    ).toBeNull();
  }, 15000);

  it('PATCH /raw-leads/:id/tier devolve 400 pra valor fora do enum', async () => {
    const created = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Lead pra tier inválido',
        situacao: 'ATIVA',
        uf: 'RS',
      })
      .expect(201);
    const lead = created.body as { id: string };

    await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/tier`)
      .send({ tier: 'ardente' })
      .expect(400);
  }, 15000);

  it('PATCH /raw-leads/:id/tags substitui o conjunto de tags, aparando espaço e removendo duplicata', async () => {
    const created = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Lead pra marcar com tags',
        situacao: 'ATIVA',
        uf: 'RS',
      })
      .expect(201);
    const lead = created.body as { id: string; tags: string[] };
    expect(lead.tags).toEqual([]);

    const patched = await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/tags`)
      .send({ tags: ['  Prioridade  ', 'evento-x', 'Evento-X'] })
      .expect(200);
    expect((patched.body as { tags: string[] }).tags).toEqual([
      'Prioridade',
      'evento-x',
    ]);

    // Manda o conjunto vazio de novo — substitui por completo, não soma.
    const cleared = await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/tags`)
      .send({ tags: [] })
      .expect(200);
    expect((cleared.body as { tags: string[] }).tags).toEqual([]);
  }, 15000);

  it('PATCH /raw-leads/:id/tags devolve 404 pra lead inexistente', async () => {
    await request(app.getHttpServer())
      .patch(`/raw-leads/${randomUUID()}/tags`)
      .send({ tags: ['x'] })
      .expect(404);
  });

  it('PATCH /raw-leads/:id/segmento define, aparando espaço, e limpa com null', async () => {
    const created = await request(app.getHttpServer())
      .post('/raw-leads')
      .send({
        razaoSocial: 'Lead pra marcar com segmento',
        situacao: 'ATIVA',
        uf: 'RS',
      })
      .expect(201);
    const lead = created.body as { id: string; segmento: string | null };
    expect(lead.segmento).toBeNull();

    const patched = await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/segmento`)
      .send({ segmento: '  Metalúrgica  ' })
      .expect(200);
    expect((patched.body as { segmento: string | null }).segmento).toBe(
      'Metalúrgica',
    );

    // Valor único — a segunda chamada substitui, não soma.
    const replaced = await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/segmento`)
      .send({ segmento: 'Serralheria' })
      .expect(200);
    expect((replaced.body as { segmento: string | null }).segmento).toBe(
      'Serralheria',
    );

    // segmento: null limpa o valor.
    const cleared = await request(app.getHttpServer())
      .patch(`/raw-leads/${lead.id}/segmento`)
      .send({ segmento: null })
      .expect(200);
    expect((cleared.body as { segmento: string | null }).segmento).toBeNull();
  }, 15000);

  it('PATCH /raw-leads/:id/segmento devolve 404 pra lead inexistente', async () => {
    await request(app.getHttpServer())
      .patch(`/raw-leads/${randomUUID()}/segmento`)
      .send({ segmento: 'x' })
      .expect(404);
  });

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

describe('RawLeadController (e2e) — POST /raw-leads/import-contacts (modelo padrão, 2026-08-03)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;

  const TEMPLATE_HEADER = [
    'CNPJ',
    'Razão Social',
    'Fantasia',
    'Cidade',
    'UF',
    'CNAE',
    'Porte',
    'Situação Cadastral',
    'Abertura',
    'Sócios (QSA)',
    'Importador',
    'Tags',
    'Contato Nome',
    'Contato Cargo',
    'Contato Email',
    'Contato Telefone',
    'Contato Decisor',
  ];

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace RawLeads Import Contatos (teste)',
        slug: `raw-leads-import-contacts-test-${Date.now()}`,
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
      tx.contact.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.rawLead.deleteMany({ where: { workspaceId: workspace.id } }),
    );
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

  it('agrupa linhas do mesmo CNPJ, cria uma empresa e um contato por linha', async () => {
    const rows = [
      [
        '11.222.333/0001-44',
        'Empresa Ficticia Import',
        '',
        '',
        'RS',
        '',
        '',
        '',
        '',
        '',
        '',
        'quente|prioritario',
        'Jonas Ficticio',
        'Financeiro',
        'jonas@ficticia.example.com',
        '51999990000',
        'Sim',
      ],
      [
        '11.222.333/0001-44',
        'Empresa Ficticia Import',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Maria Ficticia',
        'Compras',
        'maria@ficticia.example.com',
        '51999991111',
        'Não',
      ],
    ];
    const buffer = Buffer.from(
      [TEMPLATE_HEADER, ...rows].map((r) => r.join(',')).join('\n'),
      'utf8',
    );

    const res = await request(app.getHttpServer())
      .post('/raw-leads/import-contacts')
      .attach('file', buffer, 'contatos.csv')
      .expect(201);
    const body = res.body as {
      total: number;
      imported: number;
      errors: unknown[];
    };
    expect(body.errors).toEqual([]);
    expect(body.imported).toBe(2);
    expect(body.total).toBe(2);

    const lead = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.rawLead.findFirstOrThrow({
          where: { workspaceId: workspace.id, cnpj: '11222333000144' },
        }),
    );
    expect(lead.tags).toEqual(['quente', 'prioritario']);
    const contacts = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.contact.findMany({ where: { companyId: lead.promotedCompanyId! } }),
    );
    expect(contacts).toHaveLength(2);
    expect(contacts.map((c) => c.nome).sort()).toEqual([
      'Jonas Ficticio',
      'Maria Ficticia',
    ]);
    expect(contacts.find((c) => c.nome === 'Jonas Ficticio')?.decisor).toBe(
      true,
    );
  }, 15000);

  it('400 quando o cabeçalho não segue o modelo padrão', async () => {
    const buffer = Buffer.from(
      'CNPJ,Razão Social\n11.222.333/0001-44,Empresa Ficticia Fora Do Modelo',
      'utf8',
    );
    await request(app.getHttpServer())
      .post('/raw-leads/import-contacts')
      .attach('file', buffer, 'fora-do-modelo.csv')
      .expect(400);
  });
});
