# Segurança — Práticas Obrigatórias

> Este documento existe porque foi pedido explicitamente: **antes de
> integrar frontend e backend, segurança é premissa, não etapa posterior.**
> `CLAUDE.md` na raiz do repo aponta pra cá e traz um resumo — qualquer
> sessão (humana ou do Claude Code) deve ler isso antes de tocar em
> `web/`, autenticação, ou qualquer endpoint que retorne dado de
> Company/Contact/Opportunity.

## 1. Regra de ouro: o frontend é público

Tudo que roda no navegador — todo o código de `web/`, todo `process.env.*`
usado ali, todo texto em componente `"use client"` — **é visível pra
qualquer pessoa que abrir o DevTools**. Não existe "esconder" nada no lado
do cliente. Isso não é uma falha a corrigir, é uma propriedade física de
como frontend funciona. A pergunta certa nunca é "como escondo isso do
frontend", é "isso pode ser público, ou não deveria estar no frontend de
jeito nenhum".

## 2. Variáveis de ambiente — o que pode e o que não pode no frontend

No Next.js, só variáveis prefixadas com `NEXT_PUBLIC_` ficam disponíveis no
código que roda no navegador — e o prefixo existe exatamente pra ser um
alerta visual: "isso vai pro bundle público, olhe com atenção".

| Pode ter `NEXT_PUBLIC_` (público, por design) | NUNCA pode estar em `web/` |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `DATABASE_URL` (string de conexão do Postgres) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (protegida por RLS, não por sigilo) | `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS — nunca no client) |
| | `JWT_SECRET` / `JWT_REFRESH_SECRET` do backend |
| | `ANTHROPIC_API_KEY` ou qualquer outra chave de API |
| | Qualquer segredo, mesmo que "só de dev" |

**Checagem mecânica antes de qualquer commit que toque em `web/`:**
```sh
grep -rn "process\.env\." web --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Toda linha que aparecer tem que começar com `NEXT_PUBLIC_`. Se aparecer
qualquer outra coisa, é vazamento — parar e corrigir antes de prosseguir,
não depois.

## 3. A anon key do Supabase é pública — RLS é a fronteira real

A `NEXT_PUBLIC_SUPABASE_ANON_KEY` **é feita pra ser pública** — ela não dá
acesso a nada por si só. Quem protege os dados é o **Row-Level Security**
no Postgres (já é premissa da Fase 1 do `roadmap.md` e está descrito em
`arquitetura-dados.md`, seção 1). Isso muda a ordem de prioridade:

- **Antes de conectar qualquer tela real a dado real**, a Fase 1 tem que
  ter RLS testado — inclusive o teste que o roadmap já marca como crítico:
  tentar vazar dado entre dois workspaces e confirmar que falha.
- Sem RLS correto, a anon key pública + Postgres do Supabase = qualquer
  pessoa com essa key (ou seja, qualquer visitante do site) consegue ler
  tabela inteira. Isso não é uma vulnerabilidade "avançada" de explorar —
  é o comportamento padrão de uma tabela sem RLS habilitado no Supabase.
- **Nunca** habilitar uma tabela nova no Supabase sem policy de RLS
  definida no mesmo commit/migration que cria a tabela.

## 3.1. Papel do Postgres usado pela aplicação — nunca o superusuário

Detalhe fácil de passar batido e que anula toda a seção anterior se
errado: **RLS não protege nada se a conexão usar um papel que ignora
RLS.** Todo superusuário do Postgres ignora RLS por padrão — inclusive
com `FORCE ROW LEVEL SECURITY` habilitado. A connection string que o
painel do Supabase mostra por padrão usa o papel `postgres`
(superusuário) — ótima pra rodar migration, **nunca** deveria ser o que
a aplicação usa em runtime.

Solução implementada na Fase 1: duas connection strings distintas.

| Variável | Papel | Uso |
|---|---|---|
| `DATABASE_URL` | `app_runtime` (criado em `prisma/migrations/20260724120001_app_runtime_role`) — sem superuser, sem BYPASSRLS | Conexão da aplicação em runtime (Prisma Client) |
| `DIRECT_URL` | `postgres` (o que o Supabase fornece por padrão) | Só `prisma migrate` — nunca a aplicação |

O teste crítico de RLS (`test/rls-isolation.e2e-spec.ts`) checa isso
antes de testar qualquer outra coisa: se `DATABASE_URL` conectar com um
papel `rolbypassrls = true`, o teste falha alto explicando o motivo, em
vez de "passar" silenciosamente sem provar nada — passar por acidente
nesse cenário seria pior que não ter o teste.

## 4. Dados sensíveis de empresas e pessoas

- CNPJ, telefone, e-mail, nome de empresa/contato **reais** nunca entram em:
  código-fonte, mensagens de commit, este repositório de docs, ou qualquer
  artifact/prévia publicada. Dado de exemplo é sempre fictício (como já
  vem sendo feito nos mockups e nos leads de amostra da prévia de
  interface) — manter esse padrão.
- O staging de leads (`leads/*.duckdb`) contém dado real de empresas
  assim que rodar contra a planilha de verdade — está no `.gitignore`,
  mas **tratar esse arquivo como sensível** mesmo fora do git: não
  compartilhar, não anexar em chat, não copiar pra fora da máquina sem
  necessidade.
- Nenhum endpoint do backend deve devolver mais campos do que a tela
  precisa — evitar `SELECT *` que vaza campo sensível não usado na UI.

## 5. Backend (NestJS) — pontos a fechar antes da integração

Ainda pendentes (Fase 1–3 do roadmap) e citados aqui porque são
pré-requisito de segurança, não só de funcionalidade:

- **CORS restritivo** — permitir só a origem real do frontend deployado
  (e localhost em dev), nunca `origin: '*'` com credenciais habilitadas.
- **Guard de autenticação valida o JWT do Supabase antes de qualquer
  handler rodar** — nenhuma rota de dado de negócio fica acessível sem
  isso, nem "temporariamente" durante desenvolvimento.
- **Rate limiting** por workspace/IP (já listado na Fase 8 do roadmap —
  mas revisar se não deveria entrar antes, junto com a Fase 2, dado que
  auth é superfície de ataque desde o primeiro deploy real).
- **Logs nunca imprimem payload de request/response inteiro** em rota que
  lida com dado de Company/Contact — nem em dev. Log estruturado, campos
  específicos, nunca `console.log(req.body)` genérico.
- Segredos do backend (`.env`) seguem exclusivamente por variável de
  ambiente — nunca hardcoded, nunca em `docs/`, nunca colados em chat.

## 6. Checklist obrigatório antes de integrar frontend + backend

Antes de qualquer PR/mudança que conecte `web/` a um endpoint real do
NestJS pela primeira vez, confirmar cada item:

- [ ] Nenhuma variável de ambiente sem prefixo `NEXT_PUBLIC_` é referenciada
      em código de `web/` (checar com o grep da seção 2)
- [ ] RLS habilitado e testado em toda tabela que a query vai tocar —
      incluindo o teste de vazamento entre workspaces
- [ ] `DATABASE_URL` usa o papel `app_runtime` (sem BYPASSRLS), não
      `postgres` — `test/rls-isolation.e2e-spec.ts` falha alto se isso
      estiver errado, mas confirmar manualmente também
- [ ] CORS do backend restrito à origem real do frontend
- [ ] Endpoint retorna só os campos que a tela usa, nada a mais
- [ ] Nenhum log imprime corpo de request/response com dado sensível
- [ ] `.env`/`.env.local` confirmados fora do git (`git status` limpo,
      `git check-ignore -v <arquivo>` confirma o padrão)
- [ ] Nenhum dado real de empresa/pessoa em dado de exemplo, commit,
      artifact ou documentação

Se qualquer item falhar, a integração espera — isso é o motivo desse
documento existir: virou pré-requisito, não pode ser "depois eu arrumo".

## 7. Auditoria feita em 2026-07-24

Revisão completa do repositório nessa data (working tree + o único commit
existente) não encontrou nenhum segredo real, chave de API, senha ou
string de conexão vazada. Único ponto de higiene identificado (não é
segredo): o ID da planilha do Google Sheets (`leads/cod.txt` e
`leads/import_empresas.py`) está duplicado em vez de centralizado — não é
risco de segurança, mas vale unificar quando esses scripts forem revisados
de novo.
