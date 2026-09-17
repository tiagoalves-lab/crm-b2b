import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

interface OpportunityBody {
  id: string;
  status: string;
  version: number;
  lostReason: string | null;
  stageId: string;
  closedAt: string | null;
}

const prisma = new PrismaClient();

describe('OpportunityController (e2e)', () => {
  let app: INestApplication;
  let adminApp: INestApplication;
  let workspace: { id: string };
  let membership: MembershipContext;
  let adminMembership: MembershipContext;
  let companyId: string;
  let pipelineId: string;
  let stageAId: string;
  let stageBId: string;
  let opportunityId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Opportunities (teste)',
        slug: `opportunities-test-${Date.now()}`,
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
          razaoSocial: 'Empresa Opportunities',
        },
      }),
    );
    companyId = company.id;

    const pipeline = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.pipeline.create({
        data: { workspaceId: workspace.id, name: 'Funil de teste' },
      }),
    );
    pipelineId = pipeline.id;

    const stageA = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.stage.create({
        data: { pipelineId, name: 'A', order: 1, probability: 20 },
      }),
    );
    stageAId = stageA.id;
    const stageB = await withTenant(prisma, userId, workspace.id, (tx) =>
      tx.stage.create({
        data: { pipelineId, name: 'B', order: 2, probability: 60 },
      }),
    );
    stageBId = stageB.id;

    app = await createFakeAuthApp(membership);

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
    adminApp = await createFakeAuthApp(adminMembership);
  }, 30000);

  afterAll(async () => {
    await adminApp.close();
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
      tx.stage.deleteMany({ where: { pipelineId } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.pipeline.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.membership.deleteMany({ where: { workspaceId: workspace.id } }),
    );
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await app.close();
    await prisma.$disconnect();
  }, 20000);

  it('POST /opportunities cria uma oportunidade "open"', async () => {
    const res = await request(app.getHttpServer())
      .post('/opportunities')
      .send({
        companyId,
        pipelineId,
        stageId: stageAId,
        amount: 5000,
        currency: 'BRL',
      })
      .expect(201);
    const body = res.body as OpportunityBody;
    expect(body.status).toBe('open');
    expect(body.version).toBe(1);
    opportunityId = body.id;
  });

  it('GET /opportunities?companyId= filtra pela empresa (ficha, SPEC-CRM-GAMA.md §4.1)', async () => {
    const outraCompany = await withTenant(
      prisma,
      membership.userId,
      workspace.id,
      (tx) =>
        tx.company.create({
          data: {
            workspaceId: workspace.id,
            razaoSocial: 'Empresa sem oportunidade',
          },
        }),
    );
    const res = await request(app.getHttpServer())
      .get(`/opportunities?companyId=${companyId}`)
      .expect(200);
    const body = res.body as { items: OpportunityBody[] };
    expect(body.items.some((o) => o.id === opportunityId)).toBe(true);

    const empty = await request(app.getHttpServer())
      .get(`/opportunities?companyId=${outraCompany.id}`)
      .expect(200);
    expect((empty.body as { items: OpportunityBody[] }).items).toHaveLength(0);
  });

  it('POST /opportunities rejeita status/lostReason no corpo (não whitelisted)', async () => {
    await request(app.getHttpServer())
      .post('/opportunities')
      .send({
        companyId,
        pipelineId,
        stageId: stageAId,
        amount: 100,
        currency: 'BRL',
        status: 'won',
      })
      .expect(400);
  });

  it('PATCH sem version é rejeitado pelo ValidationPipe', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ amount: 6000 })
      .expect(400);
  });

  it('PATCH com stage de outro pipeline (sem pipelineId) é aceito só se pertencer ao mesmo pipeline', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 1, stageId: stageBId })
      .expect(200);
    const body = res.body as OpportunityBody;
    expect(body.stageId).toBe(stageBId);
    expect(body.version).toBe(2);
  });

  it('PATCH status "lost" sem lostReason retorna 400', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 2, status: 'lost' })
      .expect(400);
  });

  it('PATCH com version desatualizada retorna 409', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 1, amount: 7000 })
      .expect(409);
  });

  it('PATCH status "won" fecha a oportunidade (closedAt preenchido)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 2, status: 'won' })
      .expect(200);
    const body = res.body as OpportunityBody;
    expect(body.status).toBe('won');
    expect(body.closedAt).not.toBeNull();
  });

  it('PATCH won -> lost direto é bloqueado (precisa reabrir primeiro)', async () => {
    await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 3, status: 'lost', lostReason: 'Motivo' })
      .expect(400);
  });

  it('PATCH won -> open reabre, depois open -> lost com motivo funciona', async () => {
    const reopened = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 3, status: 'open' })
      .expect(200);
    expect((reopened.body as OpportunityBody).closedAt).toBeNull();

    const lost = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({
        version: 4,
        status: 'lost',
        lostReason: 'Perdeu pro concorrente',
      })
      .expect(200);
    const body = lost.body as OpportunityBody;
    expect(body.status).toBe('lost');
    expect(body.lostReason).toBe('Perdeu pro concorrente');
  });

  it('CRÍTICO: duas atualizações concorrentes com a mesma version — só uma vence', async () => {
    // Reabre pra poder editar de novo, pega a version atual.
    const reopened = await request(app.getHttpServer())
      .patch(`/opportunities/${opportunityId}`)
      .send({ version: 5, status: 'open' })
      .expect(200);
    const version = (reopened.body as OpportunityBody).version;

    const [first, second] = await Promise.allSettled([
      request(app.getHttpServer())
        .patch(`/opportunities/${opportunityId}`)
        .send({ version, amount: 1111 }),
      request(app.getHttpServer())
        .patch(`/opportunities/${opportunityId}`)
        .send({ version, amount: 2222 }),
    ]);

    const statuses = [first, second].map((r) =>
      r.status === 'fulfilled' ? r.value.status : -1,
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);
  }, 15000);

  // Histórico do card (2026-09-14): o botão "Histórico" no rodapé lê
  // GET /activities?opportunityId=. O que ele consegue escrever depende
  // do que o backend grava no payload — é isso que estes testes fixam.
  describe('Histórico do card — trilha de etapa e edição', () => {
    let historicoOppId: string;

    it('troca de etapa grava o nome das duas etapas', async () => {
      const criada = await request(app.getHttpServer())
        .post('/opportunities')
        .send({
          companyId,
          pipelineId,
          stageId: stageAId,
          amount: 1000,
          currency: 'BRL',
        })
        .expect(201);
      const opp = criada.body as OpportunityBody;
      historicoOppId = opp.id;

      await request(app.getHttpServer())
        .patch(`/opportunities/${historicoOppId}`)
        .send({ version: opp.version, stageId: stageBId })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/activities?opportunityId=${historicoOppId}&pageSize=100`)
        .expect(200);
      const items = (
        res.body as {
          items: { type: string; payload: Record<string, unknown> }[];
        }
      ).items;
      const stageChange = items.find((a) => a.type === 'stage_change');
      expect(stageChange).toBeDefined();
      expect(typeof stageChange?.payload.fromStageName).toBe('string');
      expect(typeof stageChange?.payload.toStageName).toBe('string');
    }, 20000);

    it('edição de campo grava o valor anterior e o novo', async () => {
      const atual = await request(app.getHttpServer())
        .get(`/opportunities/${historicoOppId}`)
        .expect(200);
      const version = (atual.body as OpportunityBody).version;

      await request(app.getHttpServer())
        .patch(`/opportunities/${historicoOppId}`)
        .send({ version, amount: 2500 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/activities?opportunityId=${historicoOppId}&pageSize=100`)
        .expect(200);
      const items = (
        res.body as {
          items: { type: string; payload: Record<string, unknown> }[];
        }
      ).items;
      const edicao = items.find(
        (a) => a.type === 'field_update' && a.payload.action === 'updated',
      );
      expect(edicao).toBeDefined();
      const changes = edicao?.payload.changes as {
        field: string;
        from: string | null;
        to: string | null;
      }[];
      const valor = changes.find((c) => c.field === 'amount');
      expect(valor).toBeDefined();
      expect(Number(valor?.from)).toBe(1000);
      expect(Number(valor?.to)).toBe(2500);
    }, 20000);

    it('mexer na lista de itens entra no histórico', async () => {
      await request(app.getHttpServer())
        .post(`/opportunities/${historicoOppId}/items`)
        .send({ name: 'Prensa 50T' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/activities?opportunityId=${historicoOppId}&pageSize=100`)
        .expect(200);
      const items = (
        res.body as {
          items: { type: string; payload: Record<string, unknown> }[];
        }
      ).items;
      const item = items.find((a) => a.payload.action === 'item_added');
      expect(item).toBeDefined();
      expect(item?.payload.item).toBe('Prensa 50T');
    }, 20000);
  });

  // Ordem dos cards dentro da coluna (2026-09-14): arrasto vertical no
  // quadro grava Opportunity.position, e a listagem tem que devolver
  // nessa ordem.
  describe('Ordem dos cards na coluna', () => {
    it('POST /opportunities/reorder grava a ordem e o GET respeita', async () => {
      const criar = async (amount: number) => {
        const res = await request(app.getHttpServer())
          .post('/opportunities')
          .send({ companyId, pipelineId, stageId: stageBId, amount, currency: 'BRL' })
          .expect(201);
        return (res.body as OpportunityBody).id;
      };
      const primeiro = await criar(10);
      const segundo = await criar(20);

      await request(app.getHttpServer())
        .post('/opportunities/reorder')
        .send({ stageId: stageBId, orderedIds: [segundo, primeiro] })
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/opportunities?pageSize=100')
        .expect(200);
      const ids = (res.body as { items: { id: string }[] }).items
        .map((o) => o.id)
        .filter((id) => id === primeiro || id === segundo);
      expect(ids).toEqual([segundo, primeiro]);
    }, 30000);

    it('reordenar incluindo card de outra etapa é recusado', async () => {
      const res = await request(app.getHttpServer())
        .post('/opportunities')
        .send({ companyId, pipelineId, stageId: stageAId, amount: 30, currency: 'BRL' })
        .expect(201);
      const naEtapaA = (res.body as OpportunityBody).id;

      await request(app.getHttpServer())
        .post('/opportunities/reorder')
        .send({ stageId: stageBId, orderedIds: [naEtapaA] })
        .expect(400);
    }, 20000);
  });

  // Destacar membro no comentário (2026-09-14): vira pendência daquele
  // membro naquele card, e é ela que acende o triângulo amarelo no quadro.
  describe('Comentário que destaca um membro vira pendência dele', () => {
    let oppId: string;
    let commentId: string;

    it('POST comments com mentions grava quem foi destacado', async () => {
      const criada = await request(app.getHttpServer())
        .post('/opportunities')
        .send({ companyId, pipelineId, stageId: stageAId, amount: 800, currency: 'BRL' })
        .expect(201);
      oppId = (criada.body as OpportunityBody).id;

      const res = await request(app.getHttpServer())
        .post(`/opportunities/${oppId}/comments`)
        .send({ body: 'Confere o prazo, por favor', mentions: [adminMembership.userId] })
        .expect(201);
      const body = res.body as { id: string; mentionedUserIds: string[] };
      expect(body.mentionedUserIds).toEqual([adminMembership.userId]);
      commentId = body.id;
    }, 20000);

    it('GET /opportunities acende a pendência SÓ pra quem foi destacado', async () => {
      const doDestacado = await request(adminApp.getHttpServer())
        .get('/opportunities?pageSize=100')
        .expect(200);
      const paraAdmin = (
        doDestacado.body as { items: { id: string; pendenciaParaMim: boolean }[] }
      ).items.find((o) => o.id === oppId);
      expect(paraAdmin?.pendenciaParaMim).toBe(true);

      const doAutor = await request(app.getHttpServer())
        .get('/opportunities?pageSize=100')
        .expect(200);
      const paraAutor = (
        doAutor.body as { items: { id: string; pendenciaParaMim: boolean }[] }
      ).items.find((o) => o.id === oppId);
      expect(paraAutor?.pendenciaParaMim).toBe(false);
    }, 20000);

    it('CRÍTICO: quem não foi destacado não dá baixa na pendência', async () => {
      await request(app.getHttpServer())
        .patch(`/opportunities/${oppId}/comments/${commentId}/pendencia`)
        .send({ resolvida: true })
        .expect(403);
    }, 20000);

    it('o destacado dá baixa e o alerta apaga pra ele', async () => {
      await request(adminApp.getHttpServer())
        .patch(`/opportunities/${oppId}/comments/${commentId}/pendencia`)
        .send({ resolvida: true })
        .expect(200);

      const res = await request(adminApp.getHttpServer())
        .get('/opportunities?pageSize=100')
        .expect(200);
      const item = (
        res.body as { items: { id: string; pendenciaParaMim: boolean }[] }
      ).items.find((o) => o.id === oppId);
      expect(item?.pendenciaParaMim).toBe(false);
    }, 20000);

    it('dá pra destacar alguém num comentário JÁ publicado', async () => {
      const criado = await request(app.getHttpServer())
        .post(`/opportunities/${oppId}/comments`)
        .send({ body: 'Comentário sem destaque nenhum' })
        .expect(201);
      const id = (criado.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .patch(`/opportunities/${oppId}/comments/${id}/destaques`)
        .send({ mentions: [adminMembership.userId] })
        .expect(200);
      expect((res.body as { mentionedUserIds: string[] }).mentionedUserIds).toEqual([
        adminMembership.userId,
      ]);

      const lista = await request(adminApp.getHttpServer())
        .get('/opportunities?pageSize=100')
        .expect(200);
      const item = (
        lista.body as { items: { id: string; pendenciaParaMim: boolean }[] }
      ).items.find((o) => o.id === oppId);
      expect(item?.pendenciaParaMim).toBe(true);

      // Tirar o destaque apaga a pendência junto.
      await request(app.getHttpServer())
        .patch(`/opportunities/${oppId}/comments/${id}/destaques`)
        .send({ mentions: [] })
        .expect(200);
    }, 20000);

    it('destacar quem não é membro ativo é recusado', async () => {
      await request(app.getHttpServer())
        .post(`/opportunities/${oppId}/comments`)
        .send({ body: 'Teste', mentions: [randomUUID()] })
        .expect(400);
    }, 20000);
  });

  describe('Card — chat de comentários (feature nova, fora do SPEC-CRM-GAMA.md)', () => {
    let commentId: string;

    it('GET /opportunities/:id inclui comments vazio', async () => {
      const res = await request(app.getHttpServer())
        .get(`/opportunities/${opportunityId}`)
        .expect(200);
      expect((res.body as { comments: unknown[] }).comments).toEqual([]);
    });

    it('POST /opportunities/:id/comments cria comentário', async () => {
      const res = await request(app.getHttpServer())
        .post(`/opportunities/${opportunityId}/comments`)
        .send({ body: 'Cliente pediu desconto' })
        .expect(201);
      const body = res.body as { id: string; body: string };
      expect(body.body).toBe('Cliente pediu desconto');
      commentId = body.id;
    });

    it('GET /opportunities/:id traz o comentário criado', async () => {
      const res = await request(app.getHttpServer())
        .get(`/opportunities/${opportunityId}`)
        .expect(200);
      const comments = (res.body as { comments: { id: string }[] }).comments;
      expect(comments.some((c) => c.id === commentId)).toBe(true);
    });

    it('CRÍTICO: outro membro (não autor) não pode remover o comentário', async () => {
      await request(adminApp.getHttpServer())
        .delete(`/opportunities/${opportunityId}/comments/${commentId}`)
        .expect(403);
    });

    // Comentário fixado (2026-09-09): o histórico de anotações do
    // Pipeline abre com os fixados em cima.
    it('PATCH .../pin fixa o comentário', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/opportunities/${opportunityId}/comments/${commentId}/pin`)
        .send({ pinned: true })
        .expect(200);
      expect((res.body as { pinnedAt: string | null }).pinnedAt).not.toBeNull();
    });

    it('GET /opportunity-comments traz o fixado no topo, com a empresa do card', async () => {
      const res = await request(app.getHttpServer())
        .get('/opportunity-comments')
        .expect(200);
      const items = (
        res.body as {
          items: {
            id: string;
            pinnedAt: string | null;
            opportunity: { id: string; company: { id: string } | null };
          }[];
        }
      ).items;
      expect(items[0].pinnedAt).not.toBeNull();
      const meu = items.find((c) => c.id === commentId);
      expect(meu).toBeDefined();
      expect(meu?.pinnedAt).not.toBeNull();
      expect(meu?.opportunity.id).toBe(opportunityId);
      expect(meu?.opportunity.company?.id).toBe(companyId);
    });

    it('PATCH .../pin desafixa', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/opportunities/${opportunityId}/comments/${commentId}/pin`)
        .send({ pinned: false })
        .expect(200);
      expect((res.body as { pinnedAt: string | null }).pinnedAt).toBeNull();
    });

    it('o autor remove o próprio comentário', async () => {
      await request(app.getHttpServer())
        .delete(`/opportunities/${opportunityId}/comments/${commentId}`)
        .expect(204);
    });
  });

  it('DELETE soft-deleta e POST restore reverte', async () => {
    await request(app.getHttpServer())
      .delete(`/opportunities/${opportunityId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/opportunities/${opportunityId}`)
      .expect(404);

    const res = await request(app.getHttpServer())
      .post(`/opportunities/${opportunityId}/restore`)
      .expect(201);
    expect((res.body as { deletedAt: string | null }).deletedAt).toBeNull();
  });

  it('GET /opportunities?staleDays= só retorna deals parados há tempo suficiente (Fase 4)', async () => {
    const created = await request(app.getHttpServer())
      .post('/opportunities')
      .send({
        companyId,
        pipelineId,
        stageId: stageAId,
        amount: 1,
        currency: 'BRL',
      })
      .expect(201);
    const staleId = (created.body as OpportunityBody).id;

    // Backdata created_at direto no banco — não dá pra simular "10 dias
    // atrás" via API, e é exatamente isso que o COALESCE(stage_change,
    // created_at) do service usa quando a oportunidade nunca mudou de
    // stage.
    await withTenant(prisma, membership.userId, workspace.id, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE "opportunities" SET "created_at" = NOW() - INTERVAL '10 days' WHERE "id" = '${staleId}'`,
      ),
    );

    const stale = await request(app.getHttpServer())
      .get('/opportunities?staleDays=5')
      .expect(200);
    expect(
      (stale.body as { items: OpportunityBody[] }).items.some(
        (o) => o.id === staleId,
      ),
    ).toBe(true);

    const notStale = await request(app.getHttpServer())
      .get('/opportunities?staleDays=30')
      .expect(200);
    expect(
      (notStale.body as { items: OpportunityBody[] }).items.some(
        (o) => o.id === staleId,
      ),
    ).toBe(false);
  }, 15000);
});
