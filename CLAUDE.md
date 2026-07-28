# CRM B2B Multi-tenant — Gama Brasil

Referência rápida pra qualquer sessão. Documentação completa em `docs/`:
`roadmap.md` (fases), `arquitetura-dados.md` (modelo de dados),
`geracao-qualificacao-leads.md` (módulo de leads), `seguranca.md`
(segurança — leia antes de tocar em `web/` ou em endpoints do backend).

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
  2026-07-27, 5 das 6 telas têm dado real** (Membros, Empresas, Contatos,
  Pipeline, Tarefas) via Server Components/Server Actions — só `Leads`
  segue placeholder (depende de módulo separado, fora de escopo). Backend
  roda em `PORT=3001` (Next dev usa `:3000` por padrão, colidiam).
  **Pendência real:** fluxo autenticado completo (criar empresa → contato
  → oportunidade → mover no pipeline → ganhar/perder) ainda não foi
  confirmado pelo usuário no navegador — próxima sessão, perguntar
  primeiro se isso já foi testado antes de construir mais telas. Detalhe
  completo em memória (`project_fase6_frontend_integrado`).
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
