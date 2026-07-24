# CRM B2B Multi-tenant — Gama Brasil

Referência rápida pra qualquer sessão. Documentação completa em `docs/`:
`roadmap.md` (fases), `arquitetura-dados.md` (modelo de dados),
`geracao-qualificacao-leads.md` (módulo de leads), `seguranca.md`
(segurança — leia antes de tocar em `web/` ou em endpoints do backend).

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
- **Fase 1** (DDL + RLS): código pronto (`prisma/schema.prisma` completo,
  migrations com RLS/CHECK/papel `app_runtime` sem BYPASSRLS, teste
  crítico em `test/rls-isolation.e2e-spec.ts`), mas **ainda não aplicado
  contra um banco real** — sem acesso a Postgres nesta sessão. Antes de
  seguir pra Fase 2/3, confirmar que `prisma migrate deploy` +
  `npm run test:e2e` rodaram com sucesso contra o Supabase de verdade. Ver
  `docs/seguranca.md`, seção 3.1, sobre por que o papel de conexão importa
  tanto quanto o RLS em si.
- **Conector Supabase**: usuário ativou o conector oficial em claude.ai
  (2026-07-24), mas não estava disponível na sessão em que foi ativado —
  precisa de sessão nova. **No início de qualquer sessão a partir de
  agora, rodar `ToolSearch` com `"supabase"`** pra ver se já carregou. Se
  sim: inspecionar o schema/escopo de permissão das ferramentas antes de
  usar qualquer uma pra rodar SQL/migration contra dado real — não supor o
  nível de acesso. Ver `docs/seguranca.md` antes de escrever nada real por
  esse caminho.
- **Fase 6** (frontend) foi adiantada fora de ordem, a pedido do usuário,
  como um esqueleto deployável (`web/`) — login real via Supabase Auth,
  mas todas as telas são placeholder. Risco assumido conscientemente e
  documentado no roadmap.
- **`leads/`**: módulo de geração/qualificação de leads, staging separado
  do CRM (DuckDB local, nunca commitado — ver `.gitignore`).

## Stack

- **Backend**: NestJS + TypeScript, raiz do repo. Prisma Migrate.
  Postgres hospedado no Supabase.
- **Frontend**: Next.js (App Router) + TypeScript, em `web/` (projeto
  separado, `npm install`/`npm run build` próprios).
- **Leads**: scripts Python (Colab), em `leads/`.
