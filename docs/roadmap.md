# Roadmap — CRM B2B Multi-tenant

> Referência: `arquitetura-dados.md` (modelo de dados) e
> `geracao-qualificacao-leads.md` (processo de geração/qualificação de leads
> que alimenta o funil). Fases pensadas para entregar valor incremental —
> cada uma produz algo demonstrável, não apenas infraestrutura.

## Fase 0 — Fundamentos técnicos (pré-requisito)
- [x] Escolher stack — **Node.js + TypeScript (NestJS)**, Postgres como banco
      primário, **hospedado no Supabase** (decisão de 2026-07-24 — ver nota
      abaixo)
- [x] Setup de repositório, CI básico (lint + testes), ambientes (dev/staging/prod)
      — git inicializado, esqueleto NestJS, GitHub Actions (lint + build + test +
      e2e com Postgres em service container), `.env` para dev local e variáveis
      de ambiente reais para staging/prod
- [x] ~~Decisão de auth: provider próprio (JWT + argon2/bcrypt)~~ — **revisto em
      2026-07-24: Supabase Auth**, não mais implementação própria. Motivo:
      usuário já tem conta Supabase e quis aproveitar Auth + Postgres do mesmo
      provider em vez de manter JWT/hash de senha por conta própria. Impacto no
      modelo de dados: `User` deixa de ser tabela própria — a identidade vive em
      `auth.users` (schema interno do Supabase); o que o projeto modela é
      `Membership` (e outras entidades) referenciando `auth.users.id` por FK. Ver
      `arquitetura-dados.md`, seção 2.
- [x] Estratégia de migrations — **Prisma Migrate** (`schema.prisma` como fonte
      única do schema; RLS/triggers entram como SQL raw editado nas migrations
      geradas, já que Prisma não modela RLS nativamente) — migrations rodam
      contra o Postgres do Supabase via `DATABASE_URL`

> **Nota sobre o Supabase:** ele oferece Postgres gerenciado **e** Auth/RLS
> nativos. A decisão aqui foi usar os dois — não só o banco. Isso significa
> que o NestJS não implementa mais fluxo de senha/JWT próprio; ele valida o
> JWT emitido pelo Supabase Auth nas requisições (guard a implementar na
> Fase 2) e aplica a lógica de autorização (RBAC + ownership) por cima disso.

## Fase 1 — Modelo de dados e multi-tenancy
- [x] DDL de `Workspace`, `Membership` (`Membership.user_id` referencia
      `auth.users.id` do Supabase — sem tabela `User` própria) —
      `prisma/schema.prisma`
- [x] RLS no Postgres com `app.current_workspace_id` + teste que prova
      isolamento entre tenants — `test/rls-isolation.e2e-spec.ts`. Inclui
      guarda que falha alto se a conexão usar um papel com BYPASSRLS (ver
      `docs/seguranca.md`, seção 3.1) — sem isso o teste podia "passar"
      sem provar nada.
- [x] DDL de `Company`, `Contact`, `Pipeline`, `Stage`, `Opportunity`,
      `Task`, `Activity` — inclui CHECK constraints (Task/Activity exigem
      exatamente uma relação polimórfica preenchida; `Opportunity` com
      `status = lost` exige `lost_reason`)
- [x] Seeds de desenvolvimento — `prisma/seed.ts` (precisa de
      `DEV_USER_ID`, o uuid de um usuário criado manualmente no Supabase
      Auth — ver `web/README.md`)
- [x] Papel `app_runtime` no Postgres (sem superuser, sem BYPASSRLS) —
      `DATABASE_URL` da aplicação usa esse papel; `DIRECT_URL` (privilegiado)
      fica só para `prisma migrate` (ver `docs/seguranca.md`, seção 3.1)
- [x] **Migration aplicada contra o banco real em 2026-07-24**, via
      `apply_migration` do conector Supabase (não `prisma migrate deploy`
      — ver nota abaixo). 9 tabelas criadas em `rrhcibsutyralogpwkxe`, RLS
      + `FORCE ROW LEVEL SECURITY` confirmados em `memberships`,
      `companies`, `contacts`, `pipelines`, `stages`, `opportunities`,
      `tasks`, `activities`. Papel `app_runtime` criado e confirmado
      (`rolsuper=false`, `rolbypassrls=false`, `rolcanlogin=false`).
- [x] **Achado crítico corrigido na mesma sessão:** o event trigger nativo
      do Supabase (`rls_auto_enable`) ligou RLS automaticamente em
      `workspaces` ao criar a tabela — contrariando a intenção da migration
      (visibilidade de workspace é regra de app, não RLS). Ao desligar RLS
      pra corrigir isso, ficou exposto que **este projeto Supabase concede
      INSERT/SELECT/UPDATE/DELETE por padrão a `anon`/`authenticated` em
      toda tabela nova de `public`** — sem RLS, isso vira acesso público
      total via API REST/anon key. Corrigido com `REVOKE ALL ... FROM anon,
      authenticated` nas 9 tabelas (migration `revoke_anon_authenticated_business_tables`),
      já que a arquitetura nunca previu acesso a dado de negócio via
      PostgREST — só via NestJS/`app_runtime`. Confirmado com
      `get_advisors`: advisory crítico de RLS desapareceu.
- [x] Senha do papel `app_runtime` definida no Supabase e
      `DATABASE_URL`/`DIRECT_URL` reais configuradas em `.env` local (ação
      do usuário, feita fora do chat — nunca em código, nunca revelada em
      chat, ver `docs/seguranca.md`). Confirmado em 2026-07-24 via query
      direta: `app_runtime` com `rolcanlogin=true`, `rolbypassrls=false`,
      `rolsuper=false`.
- [x] `npm run test:e2e` rodado contra o banco real em 2026-07-24 — 2
      suites, 6 testes, todos passando, incluindo
      `test/rls-isolation.e2e-spec.ts` (prova isolamento entre workspaces
      de verdade, com a guarda anti-BYPASSRLS validando o papel conectado).

**Nota sobre o método de aplicação:** migration aplicada via `apply_migration`
do conector Supabase (MCP), não via `prisma migrate deploy` local — o
conector não roda `prisma`, executa o SQL da migration diretamente. Prisma
Migrate continua sendo a fonte de verdade do schema (`prisma/schema.prisma`
+ arquivos em `prisma/migrations/`); rodar `prisma migrate deploy` depois,
com `DIRECT_URL` real configurado, deve reconhecer essas migrations como já
aplicadas (histórico por nome de migration) — vale confirmar isso quando
`DIRECT_URL` existir, não foi testado nesta sessão.
- [x] Investigar `public.rls_auto_enable()` — resolvido em 2026-07-24:
      é função nativa da plataforma Supabase (event trigger que habilita
      RLS automaticamente em toda tabela nova criada em `public`, rede de
      segurança padrão do projeto), não algo introduzido por nós. Só age
      dentro de contexto de evento de DDL; chamada direta via RPC não tem
      efeito. Advisor de `SECURITY DEFINER` é alerta genérico da plataforma,
      não risco real. Sem ação necessária.

**Estado confirmado em 2026-07-24 (conector Supabase):** projeto real
localizado (`rrhcibsutyralogpwkxe`, região us-east-2, Postgres 17,
`ACTIVE_HEALTHY`). Migration aplicada na mesma sessão — ver acima.

**Critério de saída:** consegue criar um workspace, um usuário, logar, e
inserir/consultar Company/Contact via query direta (sem API ainda) respeitando RLS.
**Atingido em 2026-07-24** — schema/RLS aplicados e confirmados contra o banco
real, papel `app_runtime` configurado e validado, `test:e2e` passando de ponta
a ponta (isolamento entre workspaces provado, não só SQL aplicado sem erro).
**Fase 1 fechada.**

## Fase 2 — Autenticação e autorização

> **Nota de escopo (2026-07-24):** ao planejar a implementação, o usuário
> esclareceu que este projeto **não é um SaaS multi-tenant pra vender** — é
> ferramenta interna de uso colaborativo da Gama Brasil. Na prática só
> existe **um workspace** (slug fixo `gama`); qualquer login válido no
> Supabase Auth entra automaticamente nele, sem tela de "criar workspace"
> nem convite por token. O modelo Workspace/Membership com RLS por
> `workspace_id` (Fase 1) é mantido como está — só não tem uso pleno de
> "múltiplos tenants" agora; a porta fica aberta pra segregar por área/filial
> no futuro sem migrar o schema de novo. Isso dividiu a fase em dois itens:
> **núcleo** (fechado nesta sessão) e **convite/gestão de membros** (adiado).

- [x] **Núcleo fechado em 2026-07-24:**
  - Login via Supabase Auth (SDK já existe no frontend desde a Fase 6);
    criação automática de `Membership` (`role: sales_rep`, `status: active`)
    no workspace único, no primeiro login de qualquer usuário autenticado —
    sem tela de "criar workspace" (decisão de escopo acima).
  - `SupabaseAuthGuard` (`src/auth/`) valida o JWT do Supabase Auth em cada
    request via JWKS do projeto (`/auth/v1/.well-known/jwks.json`),
    verificando assinatura (ES256/RS256 — nunca HS256), issuer e audience.
    Implementado com `jsonwebtoken` + fetch/`crypto.createPublicKey`
    nativos do Node, não `jose`: tanto `jose` quanto `jwks-rsa` (que usa
    `jose` por baixo) são ESM-only, e o `ts-jest` deste projeto (que
    compila pra CommonJS) não consegue carregar ESM via `require()` —
    quebrava os testes com "Unexpected token 'export'" mesmo usando
    `import()` dinâmico no código de produção (o TS baixa isso pra
    `require()` quando o `module` alvo é `commonjs`).
  - `TenantContextService` (`src/tenancy/`) generaliza o helper
    `withWorkspace()` de `test/rls-isolation.e2e-spec.ts` pra uso em
    request real — abre transação, seta `app.current_user_id` e
    `app.current_workspace_id` via `SET LOCAL` (com validação estrita de
    UUID antes de interpolar, já que Postgres não aceita bind parameter
    nesse comando).
  - `TenantMembershipGuard` resolve/cria o workspace único (upsert
    atômico por slug) e o `Membership` do usuário, checando
    `status = suspended` (403 se suspenso).
  - `PolicyService` (`src/policy/`) implementa RBAC + ownership de
    `docs/arquitetura-dados.md` seção 4b: `can()` (checagem pontual) e
    `scopeFilter()` (fragmento de `where` do Prisma pra listagens — não
    está literal no doc, adicionado porque toda listagem real precisa
    disso). Hierarquia de subordinados via `Membership.managerId`.
  - `GET /me` (`src/me/`) prova a cadeia guard → membership → resposta via
    HTTP real, sem entrar em CRUD (isso é Fase 3).
  - CORS restritivo (`FRONTEND_ORIGIN`, `credentials: true`) — endereça
    `docs/seguranca.md` seção 5/6, já que este é o primeiro endpoint
    autenticado de verdade.
  - Testes: `src/auth/verify-supabase-jwt.spec.ts` (unit, chave EC gerada
    localmente, sem rede), `src/policy/policy.service.spec.ts` (unit, todas
    as regras por papel), `test/authz.e2e-spec.ts` (e2e contra o Postgres
    real — prova o critério de saída abaixo combinando RLS de fronteira de
    workspace com `PolicyService` de fronteira de ownership).
  - Sem migration nova — `Membership` já tinha todos os campos necessários.
- [ ] Fluxo de convite de Membership (token, expiração, aceite) — **adiado**,
      não é mais estritamente necessário dado que login já dá acesso
      automático; só voltaria a fazer sentido se algum dia for preciso
      restringir quem pode entrar. Exigiria migration nova (campo de token
      em `Membership`) e policy de RLS adicional só pra lookup por token.
- [ ] Endpoint de gestão de membros (promover/suspender/rebaixar papel) —
      hoje é ajuste manual direto na tabela; `web/app/dashboard/membros`
      continua placeholder.

**Critério de saída:** dois usuários em papéis diferentes no mesmo workspace
têm acesso de dados visivelmente distinto, validado por teste automatizado.
**Atingido em 2026-07-24** por `test/authz.e2e-spec.ts` — sales_rep só vê a
própria empresa, manager vê a si mais os subordinados, owner vê tudo do
workspace, tudo contra dado real no Postgres. **Núcleo da Fase 2 fechado**;
os dois itens adiados acima não bloqueiam a Fase 3.

## Fase 3 — API core (CRUD + regras de negócio)
- [ ] Definir estilo de API (REST vs GraphQL) — decisão separada, não coberta
      no modelo de dados
- [ ] Endpoints de Company, Contact, Pipeline/Stage, Opportunity, Task
- [ ] Regras de negócio aplicadas na camada de serviço:
      - stage pertence ao pipeline da opportunity
      - `lost` exige `lost_reason`
      - toda mudança relevante gera Activity
      - versionamento otimista em Opportunity
- [ ] Soft delete + endpoint de restauração

**Critério de saída:** fluxo completo via API — criar company → contact →
opportunity → mover pelo pipeline → marcar como ganho/perdido — com Activity
sendo gerada automaticamente em cada passo.

## Fase 4 — Atividades, tarefas e auditoria
- [ ] Feed de Activity por Company/Contact/Opportunity (timeline)
- [ ] Tasks com `due_at`, atribuição, cálculo de overdue
- [ ] Notificações básicas (task vencendo, deal parado há N dias no mesmo stage)

**Critério de saída:** um usuário consegue abrir uma Opportunity e ver
histórico completo de interações + tarefas pendentes, sem consulta manual ao banco.

## Fase 5 — Relatórios e forecast
- [ ] Funil por pipeline/stage (contagem e valor)
- [ ] Forecast ponderado por `probability` do stage
- [ ] Performance por owner/time (usando hierarquia de Membership)
- [ ] Conversão multi-moeda em relatórios (moeda-base do workspace)

**Critério de saída:** dashboard (ainda que simples) respondendo "quanto está
no funil, por estágio, por responsável, em moeda-base".

## Fase 6 — Interface (frontend)
> Originalmente pensada pra vir só depois do backend estar sólido (Fases
> 1–3) — decisão revista em 2026-07-24: usuário quis adiantar um esqueleto
> deployado (com URL real) antes da Fase 1 estar pronta, pra ter algo
> demonstrável pro time enquanto o resto avança. Risco assumido
> conscientemente: telas construídas agora sobre dado mockado podem exigir
> retrabalho quando o modelo de dados real (Fase 1) e a API (Fase 3)
> chegarem — o roadmap original evitava isso de propósito.
- [x] Definir stack de frontend — **Next.js (App Router) + TypeScript**,
      integra com Supabase Auth via `@supabase/ssr`
- [x] Esqueleto deployável: shell (sidebar/topbar) + páginas placeholder por
      seção (leads/pipeline/empresas/contatos/tarefas/membros) + login real
      via Supabase Auth — **sem dado real ainda**, todas as telas mostram
      placeholder até a Fase 1/3 existirem
- [x] Validado localmente em 2026-07-24: `npm run dev` em `web/` apontando
      pro projeto Supabase real (`rrhcibsutyralogpwkxe`, só chaves públicas
      em `web/.env.local`, fora do git); middleware redireciona `/` e
      `/dashboard` sem sessão pra `/login`; usuário de teste criado no
      painel do Supabase (Auth → Users, e-mail fictício); login real
      confirmado pelo usuário no navegador. Telas do dashboard continuam
      placeholder — ainda não há `Workspace`/`Membership` no banco (Fase 1
      não aplicada), então esse é o próximo bloqueio, não a Fase 6.
- [ ] Telas completas: pipeline Kanban, lista de contacts/companies, detalhe
      de opportunity com timeline, gestão de workspace/membros — com dado
      real, depois que a API (Fase 3) estiver pronta
- [ ] Testar papéis diferentes na UI (não só na API)

## Fase 7 — Integrações e extensibilidade
- [ ] Import/export (CSV, e futuramente integrações de e-mail/calendário)
- [ ] Webhooks de eventos (`opportunity.won`, `stage.changed`, etc.) —
      naturalmente alimentados pela tabela Activity
- [ ] API pública / chaves de API por workspace

## Fase 8 — Hardening para produção
- [ ] Rate limiting por workspace
- [ ] Plano de backup/restore testado (incluindo restore seletivo por tenant)
- [ ] Observabilidade (logs estruturados com `workspace_id`, métricas, tracing)
- [ ] Revisão de segurança (RLS sob carga, testes de vazamento entre tenants
      em escala, revisão de todas as queries que ignoram RLS — ex. jobs
      administrativos)
- [ ] Plano de migração para banco dedicado (tenant enterprise), caso necessário

---

## Ordem de dependência crítica

```
Fase 0 → Fase 1 (dados + RLS) → Fase 2 (auth/policy) → Fase 3 (API + regras)
                                                              │
                                        ┌─────────────────────┴───────┐
                                  Fase 4 (activity/task)        Fase 5 (relatórios)
                                                │
                                        Fase 6 (frontend) → Fase 7 (integrações) → Fase 8 (produção)
```

Fases 4 e 5 podem correr em paralelo depois da Fase 3. Fase 6 não deveria
começar antes da Fase 3 estar estável — mudar o modelo de dados depois que a
UI existe é o retrabalho mais caro do projeto.

**Exceção assumida em 2026-07-24:** um esqueleto mínimo da Fase 6 (deploy +
auth real + shell de navegação, sem telas com dado real) foi adiantado pra
antes da Fase 1, a pedido do usuário — pra ter uma URL demonstrável pro time
o quanto antes. O aviso acima continua valendo pras telas com dado de
verdade: essas seguem esperando a Fase 3.
