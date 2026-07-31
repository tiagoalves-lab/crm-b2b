# CRM B2B Multi-tenant — Gama Brasil

Referência rápida pra qualquer sessão. Documentação completa em `docs/`:
`roadmap.md` (fases), `arquitetura-dados.md` (modelo de dados),
`geracao-qualificacao-leads.md` (módulo de leads), `seguranca.md`
(segurança — leia antes de tocar em `web/` ou em endpoints do backend).

## Retomando a sessão (última atualização: 2026-07-31)

**HANDOFF — sessão anterior foi interrompida por falta de crédito da
IA no meio da execução do `SPEC-CRM-GAMA.md`.** Se você é um colega
retomando isso pra outra pessoa: leia `SPEC-CRM-GAMA.md` inteiro primeiro
(é a ordem de serviço), depois esta seção.

### Estado da execução do SPEC-CRM-GAMA.md (seção 6 — 9 fatias)

- [x] **Fatia 1** — Migrations `raw_leads`, `task_attachments`, view
      `v_busca_empresa_lead` (§3.1/§3.2/§3.5). RLS confirmada.
- [x] **Fatia 2** — Seed das 4 stages do pipeline + limpeza de 3 stages
      sujas ("Tiago Alves", dado de teste) que existiam no banco real
      (§5). Validação de `name` no DTO de Stage corrigida (2-60 chars).
- [x] **Fatia 3** — Tela Empresas ganhou filtro Todas/Leads/Clientes +
      ficha (`?empresa=<id>&aba=`, 6 abas). Endpoint novo
      `POST /activities` (só existia leitura — gap real achado na tabela
      de reconciliação do spec, §2).
- [x] **Fatia 4** — Pipeline: seletor de empresa/lead (`CompanyPicker`,
      3 caminhos: empresa direta / aprovar lead na hora / cadastrar por
      CNPJ), drag-and-drop real (`@dnd-kit`, substituindo o
      `<select>+botão` antigo), previsão ponderada + taxa de fechamento,
      subform de encerradas com filtro de mês. Endpoints novos:
      `GET /busca-empresa-lead`, `POST /raw-leads/:id/approve`.
- [ ] **Fatia 5** — Tarefas: comentários (§4.3) — **próxima a fazer**.
- [ ] **Fatia 6** — Leads/Triagem (§4.4) — cria o módulo `raw_leads`
      completo (hoje só tem `approve()`, da Fatia 4) + `LeadScoringService`
      (fórmula exata em `gama-crm-mvp.html`, função `scoreRaw()` ~linha
      694). **Importante**: até esta fatia rodar, `raw_leads` fica vazio
      (0 linhas) — o seletor de empresa/lead da Fatia 4 só casa empresas,
      nunca leads, e o `POST /raw-leads/:id/approve` não tem dado real
      pra aprovar ainda (só testado com fixture manual em
      `test/raw-leads.e2e-spec.ts`).
- [ ] **Fatia 7** — Dashboard + Relatórios (§4.5).
- [ ] **Fatia 8** — Anexos: bucket Storage privado `task-attachments`
      (a tabela já existe, da Fatia 1) + upload via signed URL.
- [ ] **Fatia 9** — Papéis Admin/Operador (§7.5) — **fazer por último**,
      só depois de Empresas/Pipeline/Tarefas testados com um usuário só.
      Sequência de segurança não-negociável: middleware injeta
      `app.current_user_id`/`app.current_role` → testar → só então
      aplicar as policies de RLS por papel → retestar com dois usuários.

**NÃO testado no navegador em nenhuma fatia** (sem credencial real
disponível nas sessões que construíram isso) — só build + testes
automatizados (unit/e2e) a cada fatia, todos passando. **Prioridade de
teste manual quando alguém logar:**
1. Pipeline: arrastar um cartão entre colunas (drag-and-drop novo,
   Fatia 4) — os cartões têm botões reais (Ganhar/Perder) dentro, usei
   um padrão de "punho de arrasto" pra não conflitar, mas nunca cliquei
   de verdade.
2. Seletor de empresa no "Nova oportunidade" — buscar por nome/CNPJ,
   cadastrar empresa nova pelo CNPJ direto do seletor.
3. Ficha da empresa (`/dashboard/empresas`, clicar numa linha) — 6 abas,
   registrar uma nota na Timeline.
4. Tela Empresas — form expandido + botão "Buscar CNPJ".

Cada fatia tem os detalhes de decisão/gotcha registrados na memória do
Claude Code (`project_spec_crm_gama_execucao` — mas isso é local da
máquina/conta que rodou, **não vai junto no git**; se outra pessoa/conta
retomar sem acesso a essa memória, este arquivo + o `SPEC-CRM-GAMA.md`
são a fonte de verdade completa).

URLs de teste publicadas (mesmo Supabase real, sem banco de teste
separado): frontend `https://web-gamma-olive-80.vercel.app`, backend
`https://backend-production-bc44.up.railway.app` (agora rodando em
**US East**, não mais `sfo` — migração de região completou nesta sessão).
Redeploy: `railway up` (raiz) / `vercel --prod` (dentro de `web/`) — não
é automático por push.

Servidores locais de dev podem ou não continuar rodando dependendo de
como a sessão anterior foi encerrada — backend em `:3001`, frontend
tipicamente em `:3002` (não `:3000`, que costuma já estar ocupado por
processo antigo; checar com `netstat` antes de assumir a porta).

## Comunicação

Instrução explícita do usuário (2026-07-27): **responder sempre em
português do Brasil**, em qualquer sessão, independente do idioma da
mensagem de entrada.

## Segurança — não negociável, ler antes de qualquer coisa em `web/`

Instrução explícita do usuário (2026-07-24): segurança é premissa antes de
qualquer integração frontend↔backend, não um passo posterior. Detalhe
completo em `docs/seguranca.md` — resumo do que nunca pode acontecer:

- **Nenhuma variável de ambiente sem prefixo `NEXT_PUBLIC_` pode ser usada
  em código de `web/`.** Tudo em `web/` roda no navegador = é público.
  Antes de commitar qualquer mudança em `web/`, rodar:
  `grep -rn "process\.env\." web --include="*.ts" --include="*.tsx" | grep -v node_modules`
  — toda linha tem que começar com `NEXT_PUBLIC_`.
- **Nunca** colocar `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `JWT_SECRET`, `ANTHROPIC_API_KEY` ou qualquer segredo em `web/`, em
  docs, em commit, ou em texto de chat.
- **A anon key do Supabase é pública por design** — quem protege dado é
  RLS no Postgres, não a key. Nenhuma tabela nova sem policy de RLS no
  mesmo commit que a cria. Antes de conectar tela real a dado real,
  confirmar que RLS foi testado (teste de vazamento entre workspaces).
- **Nenhum dado real de empresa/pessoa** (CNPJ, telefone, e-mail, nome)
  em código, commit, doc ou artifact — sempre fictício, como já é o
  padrão nos mockups e nos leads de amostra.
- Antes de integrar `web/` a um endpoint real do NestJS pela primeira vez,
  rodar o checklist completo da seção 6 de `docs/seguranca.md`.

## Estado do projeto (ver `docs/roadmap.md` pra detalhe)

- **Fase 0** (setup, stack, auth, migrations): concluída.
- **Auth**: Supabase Auth (não JWT próprio — decisão revista em
  2026-07-24). `User` não existe como tabela nossa; identidade vive em
  `auth.users` do Supabase, `Membership` referencia por FK lógica.
- **Fase 1** (DDL + RLS): **fechada (2026-07-24)** — migration aplicada
  contra o Supabase real (`rrhcibsutyralogpwkxe`), `app_runtime` sem
  BYPASSRLS configurado, `test/rls-isolation.e2e-spec.ts` passando. Bug de
  RLS fail-closed (`''::uuid` sob pooler) corrigido em
  `20260724170000_fix_rls_empty_string_guc`. Ver `docs/seguranca.md`, seção
  3.1, sobre por que o papel de conexão importa tanto quanto o RLS em si.
- **Fases 2/3/4** (auth+policy, API core CRUD, Activity/tarefas/alertas):
  **fechadas (2026-07-24/27)**. RBAC+ownership+hierarquia (`Membership.role`
  + `ownerUserId` + `managerId`) via `PolicyService`, guards JWT do
  Supabase sem `jose`/`jwks-rsa` (ESM quebra sob Jest — implementação
  própria em `src/auth/supabase-jwks.ts`).
- **Conector Supabase**: usuário ativou o conector oficial em claude.ai
  (2026-07-24), mas não estava disponível na sessão em que foi ativado —
  precisa de sessão nova. **No início de qualquer sessão a partir de
  agora, rodar `ToolSearch` com `"supabase"`** pra ver se já carregou. Se
  sim: inspecionar o schema/escopo de permissão das ferramentas antes de
  usar qualquer uma pra rodar SQL/migration contra dado real — não supor o
  nível de acesso. Ver `docs/seguranca.md` antes de escrever nada real por
  esse caminho.
- **Fase 6** (frontend) foi adiantada fora de ordem, a pedido do usuário.
  Login real via Supabase Auth funciona desde 2026-07-24. **Desde
  2026-07-27, telas com dado real** via Server Components/Server Actions
  — `Leads` segue placeholder (depende de módulo separado, fora de
  escopo), menu de "Aquisição > Leads" removido do sidebar em 2026-07-28
  (rota ainda existe no disco, só não linkada). Backend roda em
  `PORT=3001` (Next dev usa `:3000` por padrão, colidiam).
  **Pendência real:** fluxo autenticado completo ainda não foi confirmado
  pelo usuário no navegador — próxima sessão, perguntar primeiro se isso
  já foi testado antes de construir mais telas. Detalhe completo em
  memória (`project_fase6_frontend_integrado`).
- **Contact removido (2026-07-28)**: a pedido explícito do usuário,
  `Contact` deixou de existir como tabela — virou campos dentro de
  `Company` (`razaoSocial`, `fantasia`, `nomeParaContato`, `cpfCnpj`,
  `tipo` PF/PJ, endereço completo, `emails`/`fones`/`tags` como arrays).
  `Task`/`Opportunity`/`Activity` perderam o vínculo com uma pessoa
  específica do cliente (só ligam a Company/Opportunity agora — decisão
  de produto, não bug). Tela "Contatos" e o menu correspondente foram
  removidos. Nova funcionalidade: busca de dados por CNPJ via BrasilAPI
  (`GET /companies/cnpj/:cnpj` no backend, proxied por
  `web/app/api/cnpj/route.ts` no frontend pra nunca expor o
  access_token do Supabase ao navegador). Detalhe completo — inclusive
  por que não é SEFAZ e a migration que dropou a tabela — em memória
  (`project_contact_removido_empresa_expandida`).
- **`leads/`**: módulo de geração/qualificação de leads, staging separado
  do CRM (DuckDB local, nunca commitado — ver `.gitignore`).
- **Tarefas (2026-07-28)**: virou Kanban configurável (colunas
  criadas/removidas por owner/admin) com drag-and-drop real + visão
  Calendário + cartão completo (descrição/checklist/comentários). Schema
  novo: `TaskList`, `TaskChecklistItem`, `TaskComment`. Primeira UI
  client-side interativa do projeto (`@dnd-kit`, em
  `web/app/dashboard/tarefas/kanban-board.tsx`) — todo o resto continua
  Server Components/Server Actions. Detalhe completo, inclusive um
  gotcha real de migration (baseline necessário via `prisma migrate
  resolve --applied`) e um bug latente de CHECK constraint documentado
  (não corrigido), em memória (`project_tarefas_kanban_trello`).
- **Deploy de teste (2026-07-27)**: MVP publicado pra validação — backend
  (NestJS) no Railway (`https://backend-production-bc44.up.railway.app`,
  projeto `crm-b2b-api`, serviço `backend`), frontend (Next.js) na Vercel
  (`https://web-gamma-olive-80.vercel.app`, projeto `gamabrasil/web`).
  CORS do backend (`FRONTEND_ORIGIN`) restrito a essa URL da Vercel — ver
  `docs/seguranca.md`, seção 5. Ambos apontam pro Supabase real
  (`rrhcibsutyralogpwkxe`), não há banco de "teste" separado — dado
  criado nessa URL é dado real do workspace `gama`. CLIs instaladas como
  devDependency (`@railway/cli` na raiz, `vercel` em `web/`) — **não usar
  `npx` pra essas ferramentas neste ambiente** (ver
  `feedback_npx_lock_quirk` na memória — trava com `ECOMPROMISED`), usar
  o bin local (`node_modules/.bin/railway`, `web/node_modules/.bin/vercel`).
  Bug real corrigido nesse deploy: `start:prod` apontava pra
  `dist/main` mas o `tsconfig` compila `src/` e `prisma/*.ts` juntos, então
  o `outDir` replica como `dist/src/main.js` — nunca tinha sido testado
  antes (só `start:dev`, que roda direto de `src/` via `ts-node`/`nest
  start`). Redeploy: `railway up` (raiz) / `vercel --prod` (`web/`).

## Stack

- **Backend**: NestJS + TypeScript, raiz do repo. Prisma Migrate.
  Postgres hospedado no Supabase.
- **Frontend**: Next.js (App Router) + TypeScript, em `web/` (projeto
  separado, `npm install`/`npm run build` próprios).
- **Leads**: scripts Python (Colab), em `leads/`.
