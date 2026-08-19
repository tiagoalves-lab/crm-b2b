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
  razaoSocial: string | null;
  emRecuperacaoJudicial: boolean;
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
    // de uma Activity viola a CHECK "exatamente um de company/opportunity"
    // — só acontece nesse cleanup de teste porque a API nunca faz hard
    // delete de Company (sempre soft delete via deletedAt).
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
      .send({ razaoSocial: 'Empresa E2E' })
      .expect(201);
    const body = res.body as CompanyBody;
    expect(body.razaoSocial).toBe('Empresa E2E');
    expect(body.ownerUserId).toBe(membership.userId);
    companyId = body.id;
  });

  it('POST /companies rejeita campo desconhecido (whitelist)', async () => {
    await request(app.getHttpServer())
      .post('/companies')
      .send({ razaoSocial: 'X', notAField: 'bomb' })
      .expect(400);
  });

  // Indicativo "EM RECUPERAÇÃO JUDICIAL" da Receita Federal (pedido
  // direto do usuário, 2026-08-05) — ver src/common/sanitize-razao-social.ts.
  it('POST /companies detecta e remove "EM RECUPERAÇÃO JUDICIAL" da razão social', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .send({ razaoSocial: 'Empresa RJ E2E LTDA EM RECUPERACAO JUDICIAL' })
      .expect(201);
    const body = res.body as CompanyBody;
    expect(body.razaoSocial).toBe('Empresa RJ E2E LTDA');
    expect(body.emRecuperacaoJudicial).toBe(true);
  });

  it('POST /companies confia no hint emRecuperacaoJudicial quando informado', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .send({
        razaoSocial: 'Empresa Já Limpa LTDA',
        emRecuperacaoJudicial: true,
      })
      .expect(201);
    const body = res.body as CompanyBody;
    expect(body.razaoSocial).toBe('Empresa Já Limpa LTDA');
    expect(body.emRecuperacaoJudicial).toBe(true);
  });

  it('PATCH /companies/:id detecta o indicativo ao atualizar a razão social', async () => {
    const created = await request(app.getHttpServer())
      .post('/companies')
      .send({ razaoSocial: 'Empresa RJ Update LTDA' })
      .expect(201);
    const id = (created.body as CompanyBody).id;

    const res = await request(app.getHttpServer())
      .patch(`/companies/${id}`)
      .send({ razaoSocial: 'Empresa RJ Update LTDA - EM RECUPERAÇÃO JUDICIAL' })
      .expect(200);
    const body = res.body as CompanyBody;
    expect(body.razaoSocial).toBe('Empresa RJ Update LTDA');
    expect(body.emRecuperacaoJudicial).toBe(true);
  });

  // Não existe mais campo obrigatório em Company (decisão de 2026-08-01,
  // ver migration 20260801220000_drop_company_name) — corpo vazio é
  // válido no backend agora; a exigência de razaoSocial/fantasia é só do
  // formulário (web/app/dashboard/empresas/actions.ts#createCompanyAction).
  it('POST /companies aceita corpo vazio (nenhum campo obrigatório)', async () => {
    await request(app.getHttpServer()).post('/companies').send({}).expect(201);
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

  describe('Contatos (feature nova, fora do SPEC-CRM-GAMA.md)', () => {
    let contactId: string;

    it('GET /companies/:companyId/contacts começa vazio', async () => {
      const res = await request(app.getHttpServer())
        .get(`/companies/${companyId}/contacts`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('POST /companies/:companyId/contacts cria um contato (decisor default false)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/companies/${companyId}/contacts`)
        .send({
          nome: 'Jonas Becker',
          cargo: 'Comprador',
          email: 'jonas@example.com',
        })
        .expect(201);
      const body = res.body as {
        id: string;
        nome: string;
        companyId: string;
        decisor: boolean;
      };
      expect(body.nome).toBe('Jonas Becker');
      expect(body.companyId).toBe(companyId);
      expect(body.decisor).toBe(false);
      contactId = body.id;
    });

    it('POST /companies/:companyId/contacts aceita decisor=true', async () => {
      const res = await request(app.getHttpServer())
        .post(`/companies/${companyId}/contacts`)
        .send({ nome: 'Ricardo Menezes', decisor: true })
        .expect(201);
      const body = res.body as { decisor: boolean };
      expect(body.decisor).toBe(true);
    });

    it('POST /companies/:companyId/contacts exige nome', async () => {
      await request(app.getHttpServer())
        .post(`/companies/${companyId}/contacts`)
        .send({ cargo: 'Sem nome' })
        .expect(400);
    });

    it('POST /companies/:companyId/contacts para empresa inexistente retorna 404', async () => {
      await request(app.getHttpServer())
        .post(`/companies/${randomUUID()}/contacts`)
        .send({ nome: 'Alguém' })
        .expect(404);
    });

    it('GET /companies/:companyId/contacts lista o contato criado', async () => {
      const res = await request(app.getHttpServer())
        .get(`/companies/${companyId}/contacts`)
        .expect(200);
      const body = res.body as { id: string }[];
      expect(body.some((c) => c.id === contactId)).toBe(true);
    });

    it('PATCH /companies/:companyId/contacts/:contactId atualiza campos, incl. decisor (owner)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${companyId}/contacts/${contactId}`)
        .send({ cargo: 'Diretor de Compras', decisor: true })
        .expect(200);
      const body = res.body as { cargo: string; decisor: boolean };
      expect(body.cargo).toBe('Diretor de Compras');
      expect(body.decisor).toBe(true);
    });

    it('DELETE /companies/:companyId/contacts/:contactId remove o contato', async () => {
      await request(app.getHttpServer())
        .delete(`/companies/${companyId}/contacts/${contactId}`)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get(`/companies/${companyId}/contacts`)
        .expect(200);
      const body = res.body as { id: string }[];
      expect(body.some((c) => c.id === contactId)).toBe(false);
    });

    it('DELETE de contato já removido retorna 404', async () => {
      await request(app.getHttpServer())
        .delete(`/companies/${companyId}/contacts/${contactId}`)
        .expect(404);
    });
  });

  // Pedido do usuário (2026-08-03): representante (sales_rep) só vê e
  // insere contato; editar/remover é só owner/admin. Empresa própria
  // (ownerUserId = o próprio sales_rep) pra companies RLS (Fatia 9)
  // deixar o sales_rep enxergá-la — senão qualquer requisição já cairia
  // em 404 antes de testar o 403 de papel.
  describe('Contatos — restrição de papel (sales_rep só vê/insere)', () => {
    let salesRepApp: INestApplication;
    let salesRepMembership: MembershipContext;
    let salesRepCompanyId: string;
    let salesRepContactId: string;

    beforeAll(async () => {
      const userId = randomUUID();
      salesRepMembership = await withTenant(
        prisma,
        userId,
        workspace.id,
        (tx) =>
          tx.membership.create({
            data: {
              workspaceId: workspace.id,
              userId,
              role: 'sales_rep',
              status: 'active',
              joinedAt: new Date(),
            },
          }),
      );
      salesRepApp = await createFakeAuthApp(salesRepMembership);

      const company = await withTenant(prisma, userId, workspace.id, (tx) =>
        tx.company.create({
          data: {
            workspaceId: workspace.id,
            razaoSocial: 'Empresa do sales_rep (contatos)',
            ownerUserId: userId,
          },
        }),
      );
      salesRepCompanyId = company.id;
    }, 30000);

    afterAll(async () => {
      await salesRepApp.close();
    });

    it('sales_rep vê a lista de contatos (vazia)', async () => {
      const res = await request(salesRepApp.getHttpServer())
        .get(`/companies/${salesRepCompanyId}/contacts`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('sales_rep consegue inserir um contato', async () => {
      const res = await request(salesRepApp.getHttpServer())
        .post(`/companies/${salesRepCompanyId}/contacts`)
        .send({ nome: 'Contato inserido pelo sales_rep' })
        .expect(201);
      const body = res.body as { id: string };
      salesRepContactId = body.id;
    });

    it('CRÍTICO: sales_rep NÃO consegue editar contato (403)', async () => {
      await request(salesRepApp.getHttpServer())
        .patch(`/companies/${salesRepCompanyId}/contacts/${salesRepContactId}`)
        .send({ nome: 'Tentativa de edição' })
        .expect(403);
    });

    it('CRÍTICO: sales_rep NÃO consegue remover contato (403)', async () => {
      await request(salesRepApp.getHttpServer())
        .delete(`/companies/${salesRepCompanyId}/contacts/${salesRepContactId}`)
        .expect(403);
    });

    it('admin/owner consegue editar e remover o contato inserido pelo sales_rep', async () => {
      await request(app.getHttpServer())
        .patch(`/companies/${salesRepCompanyId}/contacts/${salesRepContactId}`)
        .send({ nome: 'Editado pelo owner' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/companies/${salesRepCompanyId}/contacts/${salesRepContactId}`)
        .expect(204);
    });
  });

  // Empresa cadastrada em duplicidade por dois representantes diferentes
  // (pedido direto do usuário, 2026-08-06 — exemplo dado: "Lauro cadastrou
  // Empresa Modelo... Darlã também cadastra Empresa Modelo"). Decisão
  // confirmada com o usuário: não duplica a Company, o PERFIL passa a ser
  // visível pros dois, mas contatos continuam privados de quem os criou.
  describe('Empresa duplicada por CNPJ — não duplica, compartilha só o perfil (2026-08-06)', () => {
    let repAApp: INestApplication;
    let repBApp: INestApplication;
    let repAMembership: MembershipContext;
    let repBMembership: MembershipContext;
    const CNPJ = '11222333000181';

    beforeAll(async () => {
      const userIdA = randomUUID();
      repAMembership = await withTenant(prisma, userIdA, workspace.id, (tx) =>
        tx.membership.create({
          data: {
            workspaceId: workspace.id,
            userId: userIdA,
            role: 'sales_rep',
            status: 'active',
            joinedAt: new Date(),
          },
        }),
      );
      repAApp = await createFakeAuthApp(repAMembership);

      const userIdB = randomUUID();
      repBMembership = await withTenant(prisma, userIdB, workspace.id, (tx) =>
        tx.membership.create({
          data: {
            workspaceId: workspace.id,
            userId: userIdB,
            role: 'sales_rep',
            status: 'active',
            joinedAt: new Date(),
          },
        }),
      );
      repBApp = await createFakeAuthApp(repBMembership);
    }, 30000);

    afterAll(async () => {
      await repAApp.close();
      await repBApp.close();
    });

    it('rep A cadastra a empresa (CNPJ novo)', async () => {
      const res = await request(repAApp.getHttpServer())
        .post('/companies')
        .send({ razaoSocial: 'Empresa Modelo', cpfCnpj: CNPJ })
        .expect(201);
      expect((res.body as CompanyBody).ownerUserId).toBe(repAMembership.userId);
    });

    it('CRÍTICO: rep B cadastra o MESMO CNPJ — não cria duplicata, devolve a empresa do rep A', async () => {
      const res = await request(repBApp.getHttpServer())
        .post('/companies')
        .send({
          razaoSocial: 'Empresa Modelo (tentativa duplicada)',
          cpfCnpj: CNPJ,
        })
        .expect(201);
      const body = res.body as CompanyBody;
      // Dono original não muda — rep B não "rouba" a empresa do rep A.
      expect(body.ownerUserId).toBe(repAMembership.userId);

      const total = await withTenant(
        prisma,
        repAMembership.userId,
        workspace.id,
        (tx) =>
          tx.company.count({
            where: { workspaceId: workspace.id, cpfCnpj: CNPJ },
          }),
      );
      expect(total).toBe(1);
    });

    it('rep B agora enxerga o PERFIL da empresa (GET /companies/:id)', async () => {
      const listB = await request(repBApp.getHttpServer())
        .get('/companies')
        .expect(200);
      const found = (listB.body as CompanyListBody).items.find(
        (c) => c.razaoSocial === 'Empresa Modelo',
      );
      expect(found).toBeDefined();

      await request(repBApp.getHttpServer())
        .get(`/companies/${found!.id}`)
        .expect(200);
    });

    it('CRÍTICO: contato do rep A não aparece pro rep B, e vice-versa', async () => {
      const listB = await request(repBApp.getHttpServer())
        .get('/companies')
        .expect(200);
      const companyId = (listB.body as CompanyListBody).items.find(
        (c) => c.razaoSocial === 'Empresa Modelo',
      )!.id;

      await request(repAApp.getHttpServer())
        .post(`/companies/${companyId}/contacts`)
        .send({ nome: 'Contato do rep A' })
        .expect(201);
      await request(repBApp.getHttpServer())
        .post(`/companies/${companyId}/contacts`)
        .send({ nome: 'Contato do rep B' })
        .expect(201);

      const contatosA = (
        await request(repAApp.getHttpServer())
          .get(`/companies/${companyId}/contacts`)
          .expect(200)
      ).body as Array<{ nome: string }>;
      expect(contatosA.map((c) => c.nome)).toEqual(['Contato do rep A']);

      const contatosB = (
        await request(repBApp.getHttpServer())
          .get(`/companies/${companyId}/contacts`)
          .expect(200)
      ).body as Array<{ nome: string }>;
      expect(contatosB.map((c) => c.nome)).toEqual(['Contato do rep B']);
    }, 15000);
  });
});
