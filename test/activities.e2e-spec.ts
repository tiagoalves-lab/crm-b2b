import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface ActivityBody {
  id: string;
  type: string;
  companyId: string | null;
}

interface ActivityListBody {
  items: ActivityBody[];
}

const prisma = new PrismaClient();

describe('ActivityController (e2e)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let companyId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Activities (teste)',
        slug: `activities-test-${Date.now()}`,
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

  it('setup: cria uma company (gera Activity "created" automaticamente)', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .send({ razaoSocial: 'Empresa com histórico' })
      .expect(201);
    companyId = (res.body as { id: string }).id;
  });

  it('GET /activities?companyId= retorna a timeline da empresa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/activities?companyId=${companyId}`)
      .expect(200);
    const body = res.body as ActivityListBody;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((a) => a.companyId === companyId)).toBe(true);
  });

  it('GET /activities sem nenhum filtro retorna as atividades recentes do workspace (Painel comercial, "Últimas atividades")', async () => {
    const res = await request(app.getHttpServer())
      .get('/activities')
      .expect(200);
    const body = res.body as ActivityListBody;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((a) => a.companyId === companyId)).toBe(true);
  });

  it('GET /activities com dois filtros retorna 400', async () => {
    await request(app.getHttpServer())
      .get(`/activities?companyId=${companyId}&opportunityId=${randomUUID()}`)
      .expect(400);
  });

  it('GET /activities?companyId= de empresa inexistente retorna 404', async () => {
    await request(app.getHttpServer())
      .get(`/activities?companyId=${randomUUID()}`)
      .expect(404);
  });

  describe('POST /activities — registro manual (SPEC-CRM-GAMA.md §4.1, Timeline)', () => {
    it('cria uma nota manual vinculada à empresa, com subtipo no payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/activities')
        .send({
          companyId,
          type: 'note',
          texto: 'Anotação de acompanhamento.',
          subtipo: 'nota',
        })
        .expect(201);
      const body = res.body as {
        id: string;
        type: string;
        companyId: string;
        payload: { texto: string; subtipo: string };
      };
      expect(body.type).toBe('note');
      expect(body.companyId).toBe(companyId);
      expect(body.payload.texto).toBe('Anotação de acompanhamento.');
      expect(body.payload.subtipo).toBe('nota');

      const list = await request(app.getHttpServer())
        .get(`/activities?companyId=${companyId}`)
        .expect(200);
      const items = (list.body as ActivityListBody).items;
      expect(items.some((a) => a.id === body.id)).toBe(true);
    });

    it('rejeita type fora do vocabulário manual (stage_change é só automático)', async () => {
      await request(app.getHttpServer())
        .post('/activities')
        .send({ companyId, type: 'stage_change', texto: 'Tentativa inválida' })
        .expect(400);
    });

    it('rejeita quando nenhum alvo é informado', async () => {
      await request(app.getHttpServer())
        .post('/activities')
        .send({ type: 'note', texto: 'Sem empresa nem oportunidade' })
        .expect(400);
    });

    it('rejeita quando dois alvos são informados', async () => {
      await request(app.getHttpServer())
        .post('/activities')
        .send({
          companyId,
          opportunityId: randomUUID(),
          type: 'note',
          texto: 'Ambíguo',
        })
        .expect(400);
    });

    it('retorna 404 pra empresa de outro workspace/inexistente', async () => {
      await request(app.getHttpServer())
        .post('/activities')
        .send({
          companyId: randomUUID(),
          type: 'note',
          texto: 'Empresa que não existe',
        })
        .expect(404);
    });
  });

  // Contato obrigatório pra ligação/reunião/visita/e-mail (pedido direto
  // do usuário, 2026-08-05) — mesma regra de Task.contactId.
  describe('POST /activities — contato obrigatório (ligação/reunião/visita/e-mail)', () => {
    let contactId: string;

    beforeAll(async () => {
      const contact = await withTenant(
        prisma,
        membership.userId,
        workspace.id,
        (tx) =>
          tx.contact.create({
            data: {
              workspaceId: workspace.id,
              companyId,
              nome: 'Contato de Teste',
              cargo: 'Compras',
            },
          }),
      );
      contactId = contact.id;
    });

    it.each(['ligacao', 'reuniao', 'visita', 'email'])(
      'rejeita subtipo "%s" sem contactId',
      async (subtipo) => {
        await request(app.getHttpServer())
          .post('/activities')
          .send({ companyId, type: 'note', texto: 'Sem contato', subtipo })
          .expect(400);
      },
    );

    it('aceita com contactId válido e denormaliza contatoNome no payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/activities')
        .send({
          companyId,
          type: 'call',
          texto: 'Ligação com o contato',
          subtipo: 'ligacao',
          contactId,
        })
        .expect(201);
      const body = res.body as {
        payload: { contatoNome?: string };
        contactId: string;
      };
      expect(body.contactId).toBe(contactId);
      expect(body.payload.contatoNome).toBe('Contato de Teste');
    });

    it('rejeita contactId de outra empresa', async () => {
      const otherCompany = await request(app.getHttpServer())
        .post('/companies')
        .send({ razaoSocial: 'Outra empresa (contato errado)' })
        .expect(201);
      const otherContact = await withTenant(
        prisma,
        membership.userId,
        workspace.id,
        (tx) =>
          tx.contact.create({
            data: {
              workspaceId: workspace.id,
              companyId: (otherCompany.body as { id: string }).id,
              nome: 'Contato de outra empresa',
            },
          }),
      );

      await request(app.getHttpServer())
        .post('/activities')
        .send({
          companyId,
          type: 'email',
          texto: 'Tentando usar contato de outra empresa',
          subtipo: 'email',
          contactId: otherContact.id,
        })
        .expect(400);
    });

    it('não exige contato pra "nota"/subtipo ausente', async () => {
      await request(app.getHttpServer())
        .post('/activities')
        .send({
          companyId,
          type: 'note',
          texto: 'Sem exigência',
          subtipo: 'nota',
        })
        .expect(201);
    });
  });

  describe('GET /activities sem filtro — escopo por papel (mesmo critério de Company/Opportunity/Task.findAll)', () => {
    let adminApp: INestApplication;
    let repApp: INestApplication;
    let otherRepApp: INestApplication;
    let companyDoRep: string;
    let companyDoOutroRep: string;

    beforeAll(async () => {
      const adminUserId = randomUUID();
      const adminMembership = await withTenant(
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
      const repUserId = randomUUID();
      const repMembership = await withTenant(
        prisma,
        repUserId,
        workspace.id,
        (tx) =>
          tx.membership.create({
            data: {
              workspaceId: workspace.id,
              userId: repUserId,
              role: 'sales_rep',
              status: 'active',
              joinedAt: new Date(),
            },
          }),
      );
      const otherRepUserId = randomUUID();
      const otherRepMembership = await withTenant(
        prisma,
        otherRepUserId,
        workspace.id,
        (tx) =>
          tx.membership.create({
            data: {
              workspaceId: workspace.id,
              userId: otherRepUserId,
              role: 'sales_rep',
              status: 'active',
              joinedAt: new Date(),
            },
          }),
      );

      adminApp = await createFakeAuthApp(
        adminMembership,
        'admin-act@gamabrasil.com.br',
      );
      repApp = await createFakeAuthApp(
        repMembership,
        'rep-act@gamabrasil.com.br',
      );
      otherRepApp = await createFakeAuthApp(
        otherRepMembership,
        'rep2-act@gamabrasil.com.br',
      );

      companyDoRep = (
        await request(repApp.getHttpServer())
          .post('/companies')
          .send({ razaoSocial: 'Empresa do rep' })
          .expect(201)
      ).body.id as string;
      companyDoOutroRep = (
        await request(otherRepApp.getHttpServer())
          .post('/companies')
          .send({ razaoSocial: 'Empresa do outro rep' })
          .expect(201)
      ).body.id as string;
    }, 30000);

    afterAll(async () => {
      await adminApp.close();
      await repApp.close();
      await otherRepApp.close();
    });

    it('CRÍTICO: sales_rep só vê nas "últimas atividades" o que é da própria empresa', async () => {
      const res = await request(repApp.getHttpServer())
        .get('/activities')
        .expect(200);
      const items = (res.body as ActivityListBody).items;
      expect(items.some((a) => a.companyId === companyDoRep)).toBe(true);
      expect(items.some((a) => a.companyId === companyDoOutroRep)).toBe(false);
    });

    it('admin vê as atividades de ambas as empresas', async () => {
      const res = await request(adminApp.getHttpServer())
        .get('/activities')
        .expect(200);
      const items = (res.body as ActivityListBody).items;
      expect(items.some((a) => a.companyId === companyDoRep)).toBe(true);
      expect(items.some((a) => a.companyId === companyDoOutroRep)).toBe(true);
    });
  });
});
