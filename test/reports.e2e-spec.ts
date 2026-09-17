import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

// Tela "E-mail automático" (Administração, 2026-09-15) — prova que o que
// ela consome existe de verdade contra o Postgres: a configuração dos
// dois reports, as etapas do Pipeline pros checkboxes e o registro de
// envios. O envio em si (provedor de e-mail) tem cobertura unitária em
// src/reports/report-scheduler.service.spec.ts; aqui o alvo é a
// persistência e a validação.

interface ConfigBody {
  configs: {
    tipo: string;
    ativo: boolean;
    horarios: string[];
    diasUteis: boolean;
    etapas: string[];
  }[];
  etapasDisponiveis: string[];
  destinatarios: { nome: string; email: string | null }[];
  envioConfigurado: boolean;
  ultimosEnvios: unknown[];
}

const prisma = new PrismaClient();

describe('ReportController — configuração (e2e)', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let admin: MembershipContext;
  let repUserId: string;

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace reports (teste)',
        slug: `reports-test-${Date.now()}`,
      },
    });
    const adminUserId = randomUUID();

    const membro = await withTenant(prisma, adminUserId, workspace.id, (tx) =>
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
    repUserId = randomUUID();
    await withTenant(prisma, adminUserId, workspace.id, (tx) =>
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

    admin = {
      id: membro.id,
      workspaceId: workspace.id,
      userId: adminUserId,
      role: 'admin',
      status: 'active',
    };

    await withTenant(prisma, adminUserId, workspace.id, async (tx) => {
      const pipeline = await tx.pipeline.create({
        data: {
          workspaceId: workspace.id,
          name: 'Funil reports',
          isDefault: false,
        },
      });
      await tx.stage.create({
        data: {
          pipelineId: pipeline.id,
          name: 'Solicitação de Propostas',
          order: 1,
          probability: 15,
        },
      });
      await tx.stage.create({
        data: {
          pipelineId: pipeline.id,
          name: 'Negociação e Fechamento',
          order: 2,
          probability: 80,
        },
      });
    });

    app = await createFakeAuthApp(admin);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    // A limpeza precisa das variáveis de sessão: report_config, stages,
    // pipelines e memberships têm RLS por workspace, e um DELETE sem
    // contexto apaga ZERO linha em silêncio — o que só apareceria depois,
    // como violação de chave estrangeira ao remover o workspace.
    await withTenant(prisma, admin.userId, workspace.id, async (tx) => {
      await tx.reportConfig.deleteMany({ where: { workspaceId: workspace.id } });
      await tx.stage.deleteMany({
        where: { pipeline: { workspaceId: workspace.id } },
      });
      await tx.pipeline.deleteMany({ where: { workspaceId: workspace.id } });
      await tx.membership.deleteMany({ where: { workspaceId: workspace.id } });
    });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }, 60000);

  it('entrega o que a tela precisa, com o padrão de quem nunca salvou nada', async () => {
    const res = await request(app.getHttpServer()).get('/reports/config');
    expect(res.status).toBe(200);

    const body = res.body as ConfigBody;
    expect(body.configs.map((c) => c.tipo).sort()).toEqual([
      'pipeline-diario',
      'pipeline-followup',
    ]);
    // Etapas reais do Pipeline — é o que vira checkbox na tela.
    expect(body.etapasDisponiveis).toContain('Solicitação de Propostas');
    expect(body.etapasDisponiveis).toContain('Negociação e Fechamento');
    expect(Array.isArray(body.ultimosEnvios)).toBe(true);
  }, 30000);

  it('salva horários e etapas, e a leitura seguinte devolve o que foi salvo', async () => {
    const salvar = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-followup')
      .send({
        ativo: true,
        horarios: ['09:30', '15:00'],
        diasUteis: true,
        etapas: ['Solicitação de Propostas'],
      });
    expect(salvar.status).toBe(200);

    const res = await request(app.getHttpServer()).get('/reports/config');
    const followup = (res.body as ConfigBody).configs.find(
      (c) => c.tipo === 'pipeline-followup',
    );
    expect(followup?.horarios).toEqual(['09:30', '15:00']);
    expect(followup?.etapas).toEqual(['Solicitação de Propostas']);
  }, 30000);

  it('normaliza o horário digitado e descarta repetido', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-followup')
      .send({ horarios: ['9:30', '09:30', '8:05'] });

    expect(res.status).toBe(200);
    expect((res.body as { horarios: string[] }).horarios).toEqual([
      '08:05',
      '09:30',
    ]);
  }, 30000);

  it('recusa horário inválido', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-followup')
      .send({ horarios: ['25:00'] });

    expect(res.status).toBe(400);
  }, 30000);

  it('recusa deixar ativo sem nenhum horário', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-followup')
      .send({ ativo: true, horarios: [] });

    expect(res.status).toBe(400);
  }, 30000);

  it('recusa dois horários no resumo diário (é um envio por dia)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-diario')
      .send({ horarios: ['08:00', '17:00'] });

    expect(res.status).toBe(400);
  }, 30000);

  it('recusa report desconhecido', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-inventado')
      .send({ ativo: false });

    expect(res.status).toBe(400);
  }, 30000);

  it('salva quem recebe e devolve a lista', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-diario')
      .send({ destinatarios: [admin.userId] });

    expect(res.status).toBe(200);
    expect((res.body as { destinatarios: string[] }).destinatarios).toEqual([
      admin.userId,
    ]);
  }, 30000);

  it('CRÍTICO: recusa colocar representante na lista de quem recebe', async () => {
    // O report traz o quadro inteiro da empresa — decisão 1.1 é que
    // representante não recebe. Sem esta checagem no servidor, bastaria
    // mandar o id dele no formulário.
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-diario')
      .send({ destinatarios: [repUserId] });

    expect(res.status).toBe(400);
  }, 30000);

  it('lista vazia volta a significar todos os elegíveis', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-diario')
      .send({ destinatarios: [] });

    expect(res.status).toBe(200);
    expect((res.body as { destinatarios: string[] }).destinatarios).toEqual([]);
  }, 30000);

  it('desligar o report não exige horário', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reports/config/pipeline-followup')
      .send({ ativo: false, horarios: [] });

    expect(res.status).toBe(200);
    expect((res.body as { ativo: boolean }).ativo).toBe(false);
  }, 30000);
});
