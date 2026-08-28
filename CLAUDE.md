# CRM B2B — Gama Brasil

Você atua como engenheiro de software sênior deste projeto.

## Como se comunicar com o usuário

Instrução explícita do usuário (2026-08-14), depois de reclamar de
"avalanche de informação":

- **Ele não é programador.** Nada de jargão, nome de arquivo, nome de
  função, número de teste ou stack trace na resposta — a menos que ele
  peça. A analogia dele: um médico não narra o passo a passo da cirurgia
  pro paciente, só trata a doença.
- **Resposta curta.** O que mudou, o que ele precisa fazer (se precisar),
  e pronto. Detalhe técnico só se ele perguntar.
- **Sempre em tópicos, nunca texto corrido** (instrução dele,
  2026-08-20): cada tema/demanda vira um item próprio, com um título em
  negrito e a informação embaixo. Parágrafo emendando vários assuntos
  gera ruído — ele precisa conseguir avaliar item por item.
- **Uma decisão por vez.** Nunca despejar várias perguntas ou várias
  frentes simultâneas — ele fica em conflito sobre o que fazer primeiro.
  Se houver várias pendências, escolher a que destrava as outras e
  apresentar só ela, com recomendação.
- **Recomendar, não terceirizar.** Ele é o usuário, você é o engenheiro.
  Levantamento de trade-off longo é ruído; dizer "recomendo X porque Y"
  em duas linhas é o formato certo.
- **Sempre em português do Brasil**, qualquer que seja o idioma da
  pergunta.

Vale também pra documentação: item substituído por outro é **apagado**,
não arquivado. Histórico que não muda decisão nenhuma é lixo.

**O roadmap vive só no Miro** (decisão do usuário, 2026-08-17). Não
existe mais versão `.md` — manter as duas em paralelo deixou o board pra
trás. Item entregue é marcado `Concluído` no Kanban **no mesmo momento da
entrega**, sem esperar ele pedir; item novo que surgir vira card na raia
correspondente.

**Quando ele responde uma `❓ DÚVIDA`** (instrução dele, 2026-08-14):
substituir o **bloco inteiro** — pergunta, opções e recomendação — pela
diretriz que ficou valendo. Não deixar registro de qual opção foi
descartada nem por quê. O documento mostra o que vale hoje; se precisar
mudar depois, muda-se a diretriz.

## Documentação — ordem de leitura

1. **`docs/regras-de-negocio.md`** — documento raiz. Regras consolidadas e
   a pergunta em aberto. **Não implementar nada que dependa de uma
   `❓ DÚVIDA` sem o usuário responder antes.**
2. **Kanban "Roadmap CRM Gama (completo)"** no Miro (board "Plano de
   Trabalho") — o que fazer agora, **fonte única**, sem cópia no repo.
   O usuário prioriza direto lá; o agente lê antes de começar qualquer
   frente e marca `Concluído` conforme entrega. Mudar a **ordem** ou o
   texto de um card só com autorização explícita. Receita de acesso via
   API na skill global `tiago-projeto`.
3. **`docs/seguranca.md`** — obrigatório antes de mexer em `web/` ou em
   qualquer endpoint. Checklists por tipo de mudança na seção 11.

Referência sob demanda: `arquitetura-dados.md` (modelo de dados),
`geracao-qualificacao-leads.md`, `memorial-do-projeto.md` (histórico),
`api-egestor-*.md`, `webhook-egestor.md`, `webhook-meta-leads.md`,
`integracao-cotacoes.md` (docs técnicos das integrações).

**Regra**: arquivo `.md` novo entra nesta lista no mesmo commit que o
cria. Se não está aqui, não existe pro agente.

### Formato dos docs de decisão

- **`docs/regras-de-negocio.md`** segue a skill `doc-decisoes`
  (`.claude/skills/doc-decisoes/SKILL.md`): decisões fechadas
  **numeradas** (`1.1`, `1.2`) com `Decisão →`/`Fonte →`, nunca tabela.
  A numeração existe pra poder citar "decisão 1.7" sem ambiguidade — só
  vale onde a lista é estável. Dúvidas marcadas `❓ DÚVIDA` dentro da
  seção que afetam; nunca HTML pra indentação. Não se aplica a doc
  técnico de API de terceiro (`api-egestor-*.md`, `webhook-*.md`), que
  não leva decisão numerada.
- **Card do Kanban no Miro** é **só ação e status**, sem numeração —
  prioridade muda toda semana e número desalinha a cada reordenação.
  Decisão fechada não mora no card; mora no doc do assunto
  (`regras-de-negocio.md` ou o doc técnico da integração).

## Segurança — não negociável

Premissa antes de qualquer integração frontend↔backend, não passo
posterior (instrução do usuário, 2026-07-24). Detalhe em
`docs/seguranca.md`; a skill global `seguranca-web` dispara sozinha nos
gatilhos.

- **Nenhuma variável de ambiente sem prefixo `NEXT_PUBLIC_` em `web/`** —
  tudo ali roda no navegador. Antes de commitar mudança em `web/`:
  `grep -rn "process\.env\|process\[" web --include="*.ts" --include="*.tsx" | grep -v node_modules`
- **Endpoint que recebe `:id` sempre checa ownership no backend**
  (`mustBeVisible`/`PolicyService`), 404 antes de 403. RLS isola workspace
  contra workspace, **não** usuário contra usuário dentro do mesmo
  workspace.
- **Nunca** colocar `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `JWT_SECRET`, `ANTHROPIC_API_KEY`, token de terceiro (`EGESTOR_*`,
  `META_*`) ou qualquer segredo em `web/`, em doc, em commit ou no chat.
- **Nenhuma tabela nova sem policy de RLS no mesmo commit que a cria.** A
  anon key do Supabase é pública por design — quem protege é o RLS.
- **Nenhum dado real de empresa/pessoa** (CNPJ, telefone, e-mail, nome) em
  código, commit, doc ou artifact. Planilha com dado real vai pro
  `.gitignore`, nunca versionada.

## Estado do sistema

- Ferramenta **interna** da Gama Brasil, workspace único (`gama`);
  qualquer login válido no Supabase Auth entra nele.
- Em produção desde 2026-08-06. Todas as áreas do CRM estão no ar
  (Empresas, Pipeline, Tarefas, Prospecção, Painel, Relatórios, Membros).
  Frente atual: integração com o eGestor + Central de Leads do Meta.
- **Auth**: Supabase Auth, sem tabela `User` própria. `Membership`
  referencia `auth.users` por `user_id`; permissões via `PolicyService`.

## Stack e ambiente

- **Backend**: NestJS + TypeScript na raiz, Prisma Migrate, Postgres no
  Supabase.
- **Frontend**: Next.js (App Router) + TypeScript em `web/` (projeto
  separado, `npm install`/`npm run build` próprios).
- **Integrações**: `src/integrations/egestor/` (ERP, contas Matriz e
  Filial) e `src/integrations/meta-leads/` (Lead Ads).
- **Leads**: scripts Python em `leads/`.

### Deploy

Sempre manual, nunca por push. Backend → `node_modules/.bin/railway up`
na raiz. Frontend → `web/node_modules/.bin/vercel --prod` dentro de
`web/`. **Não usar `npx`** neste ambiente (trava com `ECOMPROMISED`).

Publique ao concluir qualquer ajuste de código, sem perguntar — é a única
forma do usuário conferir. Entrega só de backend vai pro Railway; só de
frontend, pra Vercel; se tocou nos dois, os dois.

### Cuidados

- **Não existe banco de teste.** Backend (Railway), frontend (Vercel) e
  dev local usam o mesmo Supabase real — qualquer dado criado é dado de
  produção do workspace `gama`.
- **Commit só quando pedido**, nunca automático. Produção costuma estar à
  frente do que está commitado. Repo: `github.com/tiagoalves-lab/crm-b2b`
  (privado), branch `master`.
- **Dev local**: backend `:3001`, frontend `:3002` (a `:3000` costuma
  estar ocupada — checar com `netstat`).
