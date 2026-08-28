import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type $Enums } from '@prisma/client';
import request from 'supertest';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';
import { createFakeAuthApp, withTenant } from './utils/fake-auth';

// IDOR / BOLA — o cenário de ataque mais provável deste projeto
// (docs/seguranca.md, seção 0, cenário A e decisão 4.1): NÃO é o hacker
// anônimo, é o representante comercial legítimo que troca o id na URL pra
// abrir o registro de um colega. Não exige nenhuma habilidade técnica.
//
// Diferença pro rls-role-isolation.e2e-spec.ts, que já existe: aquele
// prova o isolamento direto no Postgres (findMany não traz a linha do
// outro). Este prova a mesma coisa pela porta que o atacante realmente
// usaria — a rota HTTP, com id conhecido, passando por controller, guard,
// PolicyService e RLS juntos. Um endpoint pode estar protegido no banco e
// ainda assim vazar existência pelo código de status.
//
// O valor principal está no último teste (a varredura): ele quebra quando
// alguém adiciona uma rota com `:id` sem classificá-la aqui. É esse
// mecanismo que impede o esquecimento — o checklist manual da seção 11.B
// depende de alguém lembrar, e a auditoria de 2026-08-12 mostrou que
// lembrar não é confiável.

// Fixados ANTES do app subir (ConfigModule lê process.env no init, e o
// dotenv não sobrescreve o que já está definido): sem isto, a validação de
// assinatura do webhook do Meta recusaria por "segredo não configurado" —
// 401 pelo motivo errado, dando um teste que passa verde sem exercitar o
// HMAC. Os testes abaixo conferem a MENSAGEM justamente pra provar qual
// camada bloqueou.
process.env.META_APP_SECRET = 'app-secret-de-teste-idor';
process.env.META_VERIFY_TOKEN = 'verify-token-de-teste-idor';
process.env.COTACOES_API_TOKEN = 'token-cotacoes-de-teste-idor';

const prisma = new PrismaClient();

// A classificação é por CAMINHO, não por primeiro segmento. A primeira
// versão deste arquivo classificava por segmento e por isso deixou passar
// `/integrations/egestor/webhook/:estabelecimento` — uma rota PÚBLICA que
// nasceu debaixo do prefixo `integrations`, já classificado como "de
// admin". A varredura passou verde sobre uma rota sem autenticação
// nenhuma. Prefixo largo demais = varredura que aprova o que não olhou.

// Recursos com dono: um sales_rep NÃO pode ver o do outro, e a resposta
// tem que ser 404 — nunca 403. Ver decisão 4.2: 403 confirma que o id
// existe e vira um oráculo de enumeração.
const RECURSOS_COM_DONO = [
  '/companies/',
  '/opportunities/',
  '/tasks/',
  '/raw-leads/',
  '/contacts/',
  // Propagação CRM → eGestor ao salvar a ficha da empresa. Mudou de
  // categoria em 2026-08-14, junto com a regra: a permissão deixou de ser
  // o papel fixo owner/admin e passou a ser a capacidade "editar Dados
  // cadastrais", que um sales_rep tem por padrão. Com isso a rota deixa
  // de ser administrativa e passa a valer a regra de recurso com dono —
  // ter a capacidade não pode virar acesso à empresa de outro
  // representante, e a negativa é 404, nunca 403.
  '/integrations/egestor/companies/',
];

// Recursos de configuração do workspace (não têm "dono"): aqui um
// sales_rep pode legitimamente tomar 403 por RBAC. O que nunca pode é 2xx.
//
// `integrations` (eGestor) entrou nesta lista em 2026-08-12 porque a
// varredura abaixo pegou as 4 rotas do módulo na primeira execução — elas
// existiam sem nenhuma cobertura de teste de autorização. Verificado no
// código antes de classificar: as 7 rotas do EgestorSyncController checam
// `SYNC_ROLES` (owner/admin) e escopam por workspace. O espelho do eGestor
// é área comum do workspace, não tem dono por representante — por isso
// admin, e não "com dono". O teste logo abaixo prova o 403.
const RECURSOS_ADMIN = [
  '/pipelines/',
  '/memberships/',
  '/integrations/egestor/contatos/',
  '/integrations/egestor/sync/',
];

// Rotas deliberadamente PÚBLICAS (sem JWT). Cada uma precisa autenticar
// por conta própria e ter teste provando isso — estar nesta lista não é
// permissão pra não ter controle, é a declaração de qual controle
// substitui o login.
const ROTAS_PUBLICAS = [
  '/integrations/egestor/webhook/',
  // Central de Leads do Meta (2026-08-14) — sem `:id` na rota, então a
  // varredura do fim deste arquivo não a alcançaria; declarada aqui
  // mesmo assim porque a lista é a documentação executável de "o que é
  // público neste backend", e o teste do controle substituto (assinatura
  // HMAC) está logo abaixo.
  '/integrations/meta-leads/webhook',
  // App de cotações (2026-08-28) — idem: rotas sem `:id`, declaradas pela
  // documentação executável. Controle substituto: token estático
  // COTACOES_API_TOKEN no Authorization (Bearer), comparação em tempo
  // constante (CotacoesService#assertTokenValido). Teste logo abaixo do
  // bloco do Meta.
  '/integrations/cotacoes/',
];

describe('IDOR — um sales_rep não alcança o registro de outro pela rota HTTP', () => {
  let app: INestApplication;
  let workspace: { id: string };
  let admin: MembershipContext;
  let vitimaUserId: string;
  let atacanteUserId: string;

  // Recursos que pertencem à VÍTIMA. O app roda autenticado como ATACANTE.
  const doDono: Record<string, string> = {};

  beforeAll(async () => {
    workspace = await prisma.workspace.create({
      data: { name: 'Workspace IDOR (teste)', slug: `idor-test-${Date.now()}` },
    });

    const adminUserId = randomUUID();
    vitimaUserId = randomUUID();
    atacanteUserId = randomUUID();

    const criaMembership = (userId: string, role: $Enums.MembershipRole) =>
      withTenant(prisma, userId, workspace.id, (tx) =>
        tx.membership.create({
          data: {
            workspaceId: workspace.id,
            userId,
            role,
            status: 'active',
            joinedAt: new Date(),
          },
        }),
      );

    const membroAdmin = await criaMembership(adminUserId, 'admin');
    await criaMembership(vitimaUserId, 'sales_rep');
    const membroAtacante = await criaMembership(atacanteUserId, 'sales_rep');

    admin = {
      id: membroAdmin.id,
      workspaceId: workspace.id,
      userId: adminUserId,
      role: 'admin',
      status: 'active',
    };

    // Fixtures criadas pelo admin, mas com a VÍTIMA como dona.
    await withTenant(prisma, adminUserId, workspace.id, async (tx) => {
      const pipeline = await tx.pipeline.create({
        data: {
          workspaceId: workspace.id,
          name: 'Funil IDOR',
          isDefault: false,
        },
      });
      const stage = await tx.stage.create({
        data: {
          pipelineId: pipeline.id,
          name: 'Etapa',
          order: 1,
          probability: 50,
        },
      });
      const company = await tx.company.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Empresa da vítima',
          ownerUserId: vitimaUserId,
        },
      });
      const opportunity = await tx.opportunity.create({
        data: {
          workspaceId: workspace.id,
          companyId: company.id,
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerUserId: vitimaUserId,
          amount: 12345,
          currency: 'BRL',
        },
      });
      const task = await tx.task.create({
        data: {
          workspaceId: workspace.id,
          title: 'Tarefa da vítima',
          assigneeUserId: vitimaUserId,
          createdBy: vitimaUserId,
          companyId: company.id,
        },
      });
      const rawLead = await tx.rawLead.create({
        data: {
          workspaceId: workspace.id,
          razaoSocial: 'Lead da vítima',
          ownerUserId: vitimaUserId,
        },
      });
      const contact = await tx.contact.create({
        data: {
          workspaceId: workspace.id,
          companyId: company.id,
          nome: 'Contato da vítima',
          ownerUserId: vitimaUserId,
        },
      });

      doDono.pipelines = pipeline.id;
      doDono.companies = company.id;
      doDono.opportunities = opportunity.id;
      doDono.tasks = task.id;
      doDono['raw-leads'] = rawLead.id;
      doDono.contacts = contact.id;
    });

    // A partir daqui, TODA requisição é o atacante.
    app = await createFakeAuthApp({
      id: membroAtacante.id,
      workspaceId: workspace.id,
      userId: atacanteUserId,
      role: 'sales_rep',
      status: 'active',
    });
  }, 60000);

  afterAll(async () => {
    if (app) await app.close();

    // Ordem importa: filhos antes dos pais (FK).
    await withTenant(prisma, admin.userId, workspace.id, async (tx) => {
      const doWorkspace = { workspaceId: workspace.id };
      await tx.contact.deleteMany({ where: doWorkspace });
      await tx.rawLead.deleteMany({ where: doWorkspace });
      await tx.task.deleteMany({ where: doWorkspace });
      await tx.opportunity.deleteMany({ where: doWorkspace });
      await tx.company.deleteMany({ where: doWorkspace });
      await tx.stage.deleteMany({
        where: { pipeline: { workspaceId: workspace.id } },
      });
      await tx.pipeline.deleteMany({ where: doWorkspace });
      await tx.membership.deleteMany({ where: doWorkspace });
    });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }, 60000);

  describe('leitura', () => {
    it.each([
      ['/companies', 'companies'],
      ['/opportunities', 'opportunities'],
      ['/tasks', 'tasks'],
      ['/raw-leads', 'raw-leads'],
    ])(
      'GET %s/:id de outro representante responde 404 (nunca 200, nunca 403)',
      async (base, chave) => {
        const res = await request(app.getHttpServer()).get(
          `${base}/${doDono[chave]}`,
        );
        expect(res.status).toBe(404);
      },
      20000,
    );

    it('a listagem também não traz o registro do outro representante', async () => {
      const res = await request(app.getHttpServer()).get('/opportunities');
      expect(res.status).toBe(200);
      const corpo = res.body as { items?: Array<{ id: string }> };
      const ids = (corpo.items ?? []).map((o) => o.id);
      expect(ids).not.toContain(doDono.opportunities);
    }, 20000);
  });

  describe('escrita — o caso grave: alterar/apagar o registro alheio', () => {
    it('PATCH /opportunities/:id de outro representante não altera nada', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/opportunities/${doDono.opportunities}`)
        .send({ version: 1, amount: 999999 });
      expect(res.status).toBe(404);

      // Prova independente: o valor no banco continua o original. Um 404
      // que ainda assim tivesse escrito seria o pior dos mundos.
      const opp = await withTenant(prisma, admin.userId, workspace.id, (tx) =>
        tx.opportunity.findUnique({ where: { id: doDono.opportunities } }),
      );
      expect(Number(opp?.amount)).toBe(12345);
    }, 20000);

    it('PATCH /raw-leads/:id/tier de outro representante responde 404', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/raw-leads/${doDono['raw-leads']}/tier`)
        .send({ tier: 'quente' });
      expect(res.status).toBe(404);
    }, 20000);

    it('DELETE /tasks/:id de outro representante não apaga a tarefa', async () => {
      const res = await request(app.getHttpServer()).delete(
        `/tasks/${doDono.tasks}`,
      );
      expect(res.status).toBe(404);

      const task = await withTenant(prisma, admin.userId, workspace.id, (tx) =>
        tx.task.findUnique({ where: { id: doDono.tasks } }),
      );
      expect(task).not.toBeNull();
    }, 20000);

    it('DELETE /companies/:id de outro representante não apaga a empresa', async () => {
      const res = await request(app.getHttpServer()).delete(
        `/companies/${doDono.companies}`,
      );
      expect(res.status).toBe(404);

      const company = await withTenant(
        prisma,
        admin.userId,
        workspace.id,
        (tx) => tx.company.findUnique({ where: { id: doDono.companies } }),
      );
      expect(company).not.toBeNull();
    }, 20000);

    // A propagação pro eGestor virou capacidade ("editar Dados
    // cadastrais"), que um sales_rep tem por padrão — então a única coisa
    // que separa ele da empresa de outro representante é o ownership. Sem
    // esta checagem, ter a capacidade bastaria pra disparar escrita no ERP
    // de terceiro a partir de empresa alheia. 404, nunca 403.
    it('POST /integrations/egestor/companies/:id/propagar de empresa de outro representante responde 404', async () => {
      const res = await request(app.getHttpServer()).post(
        `/integrations/egestor/companies/${doDono.companies}/propagar`,
      );
      expect(res.status).toBe(404);
    }, 20000);
  });

  describe('rotas de admin — sales_rep não passa nem com id válido', () => {
    // Estas quatro rotas escrevem de volta no ERP de terceiro (eGestor).
    // Um sales_rep alcançando qualquer uma delas não vazaria só leitura:
    // alteraria dado no sistema da empresa. Foram descobertas pela
    // varredura no fim deste arquivo, sem cobertura nenhuma até então.
    it.each([['corrigir'], ['consolidar'], ['corrigir-sefaz'], ['completar']])(
      'POST /integrations/egestor/contatos/:id/%s responde 403 pra sales_rep',
      async (acao) => {
        // Corpo válido de propósito: o ValidationPipe global roda ANTES
        // do handler, então um body inválido devolveria 400 e o teste
        // passaria sem nunca ter exercitado a checagem de papel — um
        // falso "protegido". Só `corrigir` exige body; as outras ignoram.
        const res = await request(app.getHttpServer())
          .post(`/integrations/egestor/contatos/${randomUUID()}/${acao}`)
          .send({ direcao: 'matriz_para_filial' });
        expect(res.status).toBe(403);
      },
      20000,
    );

    it('POST /integrations/egestor/sync/contatos responde 403 pra sales_rep', async () => {
      const res = await request(app.getHttpServer()).post(
        '/integrations/egestor/sync/contatos',
      );
      expect(res.status).toBe(403);
    }, 20000);
  });

  describe('rota pública (webhook do eGestor) — sem JWT, autentica por token', () => {
    // Esta rota é @Public(): nenhum guard de auth roda nela. O que a
    // protege é o `securityToken` do corpo. Se essa checagem cair, vira
    // um endpoint aberto na internet capaz de escrever no banco.
    const caminho = '/integrations/egestor/webhook/matriz';
    // Payload VÁLIDO de propósito (action é 'updated', não 'update'): com
    // corpo inválido o ValidationPipe devolve 400 antes da checagem do
    // token, e o teste passaria verde sem nunca ter exercitado o único
    // controle que protege esta rota. Mesmo gotcha da decisão 4.4.
    const payload = {
      module: 'contatos',
      action: 'updated',
      codigo: 123,
      date: '2026-08-12 10:00:00',
    };

    it('recusa token inválido', async () => {
      const res = await request(app.getHttpServer())
        .post(caminho)
        .send({ ...payload, securityToken: 'token-errado-de-proposito' });
      expect(res.status).toBe(401);
    }, 20000);

    it('recusa requisição sem token nenhum', async () => {
      const res = await request(app.getHttpServer())
        .post(caminho)
        .send(payload);
      // 400 (DTO exige o campo) ou 401 (checagem do token) — o que não
      // pode, de jeito nenhum, é 2xx.
      expect([400, 401]).toContain(res.status);
    }, 20000);

    it('recusa estabelecimento fora de matriz/filial', async () => {
      const res = await request(app.getHttpServer())
        .post('/integrations/egestor/webhook/outro')
        .send({ ...payload, securityToken: 'qualquer' });
      expect(res.status).not.toBeLessThan(400);
    }, 20000);
  });

  describe('rota pública (webhook do Meta) — sem JWT, autentica por assinatura', () => {
    // @Public() como o webhook do eGestor, mas o controle substituto aqui
    // é a assinatura HMAC-SHA256 do corpo cru (X-Hub-Signature-256) com o
    // App Secret. Se essa checagem cair, vira endpoint aberto na internet
    // capaz de criar lead e consumir cota da Graph API.
    const caminho = '/integrations/meta-leads/webhook';
    // Payload VÁLIDO de propósito (mesmo gotcha da decisão 4.4 e do bloco
    // do eGestor acima): com corpo inválido o ValidationPipe devolveria
    // 400 antes da checagem da assinatura, e o teste passaria verde sem
    // exercitar o único controle que protege esta rota.
    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [{ field: 'leadgen', value: { leadgen_id: '1' } }],
        },
      ],
    };

    it('recusa requisição sem assinatura nenhuma', async () => {
      const res = await request(app.getHttpServer())
        .post(caminho)
        .send(payload);
      expect(res.status).toBe(401);
      expect((res.body as { message?: string }).message).toContain(
        'X-Hub-Signature-256',
      );
    }, 20000);

    it('recusa assinatura forjada', async () => {
      const res = await request(app.getHttpServer())
        .post(caminho)
        .set('X-Hub-Signature-256', `sha256=${'0'.repeat(64)}`)
        .send(payload);
      expect(res.status).toBe(401);
      // A mensagem prova QUAL camada recusou: tem que ser a comparação do
      // HMAC, não "segredo não configurado" nem "corpo cru indisponível" —
      // esses dois dariam 401 sem provar nada sobre a assinatura.
      expect((res.body as { message?: string }).message).toBe(
        'Assinatura inválida.',
      );
    }, 20000);

    it('recusa handshake com verify_token errado', async () => {
      const res = await request(app.getHttpServer()).get(caminho).query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token-errado-de-proposito',
        'hub.challenge': 'desafio-123',
      });
      expect(res.status).toBe(401);
      expect(res.text).not.toContain('desafio-123');
      expect((res.body as { message?: string }).message).toBe(
        'hub.verify_token inválido.',
      );
    }, 20000);
  });

  describe('rota pública (integração cotações) — sem JWT, autentica por token estático', () => {
    // @Public() como os webhooks acima; o controle substituto é o token
    // COTACOES_API_TOKEN no Authorization (Bearer), comparado em tempo
    // constante (CotacoesService#assertTokenValido). Se essa checagem cair,
    // vira endpoint aberto na internet expondo a carteira de empresas
    // inteira e aceitando cadastro de qualquer um.
    //
    // Payload VÁLIDO de propósito (mesmo gotcha dos blocos acima): corpo
    // inválido morre no ValidationPipe com 400 antes do token ser conferido,
    // e o teste passaria verde sem exercitar o controle. O caminho feliz
    // (token correto) não é testado aqui de propósito: leria/gravaria no
    // banco real fora do CI — a lógica de upsert tem spec unitário próprio
    // (cotacoes.service.spec.ts).
    const payloadValido = {
      cnpj: '00000000000191',
      razao_social: 'Empresa de Teste IDOR',
    };

    it('recusa leitura sem Authorization nenhum', async () => {
      const res = await request(app.getHttpServer()).get(
        '/integrations/cotacoes/companies',
      );
      expect(res.status).toBe(401);
      expect((res.body as { message?: string }).message).toBe(
        'Authorization ausente ou mal formado.',
      );
    }, 20000);

    it('recusa token forjado na leitura', async () => {
      const res = await request(app.getHttpServer())
        .get('/integrations/cotacoes/companies')
        .set('Authorization', 'Bearer token-forjado-de-proposito');
      expect(res.status).toBe(401);
      // A mensagem prova QUAL camada recusou: tem que ser a comparação do
      // token — não "não configurado" (o env está fixado no topo deste
      // arquivo) nem "mal formado".
      expect((res.body as { message?: string }).message).toBe(
        'Token inválido.',
      );
    }, 20000);

    it('recusa gravação de cadastro com token forjado', async () => {
      const res = await request(app.getHttpServer())
        .post('/integrations/cotacoes/clientes')
        .set('Authorization', 'Bearer token-forjado-de-proposito')
        .send(payloadValido);
      expect(res.status).toBe(401);
      expect((res.body as { message?: string }).message).toBe(
        'Token inválido.',
      );
    }, 20000);
  });

  // ---------------------------------------------------------------
  // A rede de segurança: pega ENDPOINT NOVO que ninguém classificou.
  // ---------------------------------------------------------------
  it('CRÍTICO: toda rota com id está classificada como "com dono" ou "de admin"', () => {
    type Camada = { route?: { path: string } };
    const servidor = app.getHttpAdapter().getInstance() as {
      router?: { stack?: Camada[] };
      _router?: { stack?: Camada[] };
    };
    const pilha = servidor.router?.stack ?? servidor._router?.stack ?? [];
    const caminhos = pilha
      .filter((c): c is { route: { path: string } } => Boolean(c.route))
      .map((c) => c.route.path);

    // Sem isto a varredura passaria de graça se a introspecção do Express
    // mudasse de formato numa atualização — um teste que não consegue
    // falhar é pior que nenhum teste.
    expect(caminhos.length).toBeGreaterThan(20);

    const conhecidos = [
      ...RECURSOS_COM_DONO,
      ...RECURSOS_ADMIN,
      ...ROTAS_PUBLICAS,
    ];
    const naoClassificadas = caminhos
      .filter((p) => p.includes(':'))
      .filter((p) => !conhecidos.some((prefixo) => p.startsWith(prefixo)));

    if (naoClassificadas.length > 0) {
      throw new Error(
        `Rota(s) com id sem classificação de segurança:\n` +
          naoClassificadas.map((p) => `  - ${p}`).join('\n') +
          `\n\nToda rota que recebe um id precisa provar que um usuário não ` +
          `alcança o registro de outro (docs/seguranca.md, decisão 4.1).\n` +
          `Adicione o CAMINHO (não só o primeiro segmento) em ` +
          `RECURSOS_COM_DONO (espera 404), RECURSOS_ADMIN (403/404) ou ` +
          `ROTAS_PUBLICAS (autentica por conta própria) neste arquivo, e ` +
          `escreva o teste correspondente — não silencie só adicionando ` +
          `à lista.`,
      );
    }
  }, 20000);
});
