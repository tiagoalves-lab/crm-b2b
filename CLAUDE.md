# CRM B2B Multi-tenant — Gama Brasil

Referência rápida pra qualquer sessão. Documentação completa em `docs/`:
`roadmap.md` (fases), `arquitetura-dados.md` (modelo de dados),
`geracao-qualificacao-leads.md` (módulo de leads), `seguranca.md`
(segurança — leia antes de tocar em `web/` ou em endpoints do backend).

## Retomando a sessão (última atualização: 2026-08-01)

**HANDOFF — as 9 fatias do `SPEC-CRM-GAMA.md` estão implementadas,
commitadas, testadas (70 unit + 111 e2e, tudo verde) e publicadas** nas
URLs de teste (seção abaixo). A sessão que fechou isso foi interrompida
duas vezes por queda de energia (evento climático) e retomada sem perda
de trabalho — migrations e commits já estavam persistidos a cada
interrupção. **Ainda falta**: testar no navegador com credencial real
(nunca foi feito em nenhuma fatia, ver seção própria abaixo) e configurar
`SUPABASE_SERVICE_ROLE_KEY` no Railway pra Fatia 8 (anexos) funcionar em
produção — sem essa env var, upload de anexo devolve erro claro (o resto
do app funciona normal).

**ATUALIZAÇÃO (mesmo dia, sessão seguinte) — o resultado visual das 9
fatias divergia do protótipo** (usuário reportou vendo o app publicado:
sidebar sem os grupos certos, formulário de empresa cravado na lista em
vez de modal). Auditoria confirmou: não era só CSS, faltavam subsistemas
inteiros (modal/drawer/toast/topbar). Rodada de reconstrução fatia por
fatia fechada — ver "Trabalho pós-spec" abaixo, entrada "Reconstrução do
frontend pra fidelidade 1:1". **Publicada em produção incrementalmente,
mas ainda não commitada no git** — ver pendência específica lá.

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
- [x] **Fatia 5** — Tarefas: ícones de contagem (comentários/checklist) na
      Lista e no Kanban (`_count` novo em `GET /tasks`). **Decisão**: spec
      pede "sem Kanban", mas o Kanban já existia e funcionava (sessão
      anterior) — mantido, não apaguei feature funcionando sem confirmação
      explícita. Comentários/checklist já estavam prontos (não eram gap).
- [x] **Fatia 6** — Leads/Triagem (§4.4). Módulo `raw_leads` completo:
      `LeadScoringService` (fórmula 1:1 com `scoreRaw()`/`scoreTier()` do
      protótipo), `POST/GET /raw-leads`, `GET /raw-leads/:id`,
      `POST /raw-leads/:id/discard`, `POST /raw-leads/bulk-approve`,
      `POST /raw-leads/bulk-discard`, `POST /raw-leads/rescore`. **Decisão
      de modelagem**: a company-lead nasce junto com o raw_lead (tag
      `lead-triagem`), não só na aprovação — reusa `CompanyService.create`
      (agora exportado por `CompanyModule`). **Decisão do usuário
      (2026-07-31)**: descartar um lead NÃO apaga nem soft-deleta a
      company-lead, só marca `raw_leads.status='descartado'` — a company
      fica intacta e invisível (segue com a tag). Tela `/dashboard/leads`
      nova (lista com filtro quente/morno/frio, seleção em lote,
      "selecionar quentes", recalcular scores, importar lead manual,
      ficha com abas Histórico/Tarefas/Dados reusando `createNoteAction`/
      `createTaskAction` de Empresas/Tarefas). Empresas (`/dashboard/
      empresas`) agora filtra fora as companies com tag `lead-triagem`
      (senão a triagem poluiria a lista de empresas de verdade). Menu
      "Leads" religado no sidebar (grupo "Aquisição"). `prisma/seed.ts`
      ganhou 6 leads fictícios (2 quente/2 morno/2 frio, fontes
      variadas) pra popular a triagem em dev — **não rodei o seed contra
      o Supabase real** porque não tenho `DEV_USER_ID` disponível nesta
      sessão (mesma limitação de sempre, ver seção "não testado no
      navegador" abaixo). 64 unit + 107 e2e passando (12 novos: 8 no CRUD
      de raw-leads + reaproveitei os 4 de approve já existentes). Bug de
      teste achado e corrigido no processo (não é bug de produto): cleanup
      de e2e que faz hard-delete de company criada via `CompanyService`
      precisa apagar a `Activity` associada antes, senão bate no mesmo
      CHECK constraint latente já documentado na memória de Tarefas/Kanban.
      Detalhe completo em memória (`project_spec_crm_gama_execucao`).
- [x] **Fatia 7** — Dashboard (`/dashboard`) + Relatórios
      (`/dashboard/relatorios`, §4.5). KPIs, funil resumido, ações de
      hoje, taxa de fechamento/ciclo médio/ticket médio/origem dos leads.
      100% CONECTAR — nenhum endpoint novo, tudo derivado de
      `GET /opportunities`/`/tasks`/`/raw-leads`/`/pipelines` que já
      existiam. "Pipeline por produto" do protótipo ficou de fora de
      propósito — não existe campo "produto" em `Opportunity` neste
      schema (o protótipo simula algo que o backend real nunca teve).
- [x] **Fatia 8** — Anexos. Bucket privado `task-attachments` criado no
      Storage do Supabase (25MB/arquivo, sem policy em
      `storage.objects` — só `service_role` acessa, nenhuma outra role
      consegue ler/escrever, nem `anon` nem `authenticated`).
      `SupabaseStorageService` (`src/storage/`) assina URLs de
      upload/download; o binário nunca passa pelo NestJS — o Server
      Action do Next.js recebe o arquivo via FormData e faz o PUT
      direto pra signed URL, depois do backend confirmar que a tarefa
      pertence ao workspace. UI: seção "Anexos" na ficha da tarefa
      (enviar/baixar/remover — só quem enviou remove) + badge 📎 na
      Lista e no Kanban. **Pendência de infra**: `SUPABASE_SERVICE_ROLE_KEY`
      não está configurada no Railway (nem localmente) — eu não tenho
      esse segredo e não crio/exponho ele (regra de segurança do
      projeto). Sem ela, upload devolve 500 com mensagem clara; o resto
      do app funciona normal. **Ação humana pendente**: pegar a key em
      Supabase → Project Settings → API → service_role, colocar como
      env var no serviço `backend` do Railway (nunca em `web/`).
- [x] **Fatia 9** — Papéis Admin/Operador (§7.5). `TenantContextService`
      passa a injetar `app.current_role` (além de `user_id`/`workspace_id`
      que já injetava) em toda transação. RLS por papel aplicada em
      `companies`/`opportunities`/`tasks` (leitura restrita por
      papel+posse; escrita continua workspace-scoped, igual antes).
      `raw_leads` fica sem policy de papel — área comum, por decisão
      explícita do spec. **Dois bugs reais achados e corrigidos rodando
      a suíte inteira antes de fechar a fatia** (nenhum dos dois
      existia antes desta mudança):
      1. `current_role` é palavra reservada do SQL — `SET LOCAL
         app.current_role` quebra o parser mesmo com o namespace
         `app.` na frente ("syntax error at or near current_role").
         Corrigido com identificador quotado: `SET LOCAL
         "app.current_role" = '...'`.
      2. Toda escrita via Prisma usa `RETURNING`, e o Postgres exige
         que a linha devolvida também satisfaça a policy de SELECT da
         tabela — não só o `WITH CHECK` do INSERT/UPDATE. A policy de
         SELECT de `companies` (só "vinculada a uma oportunidade minha")
         fazia o próprio cadastro de empresa nova por um operador falhar
         (empresa recém-criada ainda não tem oportunidade nenhuma).
         Corrigido alargando a condição pra também aceitar
         `owner_user_id` direto (campo que já existe em `Company` desde
         a Fase 2) — e o mesmo padrão pra `tasks` com `created_by`.
      Três migrations (`20260731200000`/`210000`/`220000` — a segunda e
      terceira são correções encontradas testando, não features novas).
      `test/rls-role-isolation.e2e-spec.ts` prova a restrição com dois
      operadores + um admin, direto contra o Postgres real (o
      "retestar com dois usuários" do spec, feito via e2e automatizado
      já que não há credencial de navegador disponível). 111 e2e + 70
      unit verdes depois de aplicar tudo.
      **Nota**: o papel `manager` já tinha lógica própria funcionando na
      camada de app (`PolicyService`, hierarquia de subordinados) desde
      a Fase 2, mas o spec pede pra não implementar RLS pra ele nesta
      rodada — resolvido incluindo `manager` no mesmo bypass de
      admin/owner na RLS (RLS vira no-op pra esse papel, comportamento
      idêntico a antes desta fatia; `PolicyService` continua sendo o
      único ponto de decisão pra `manager`, como já documentado que
      deveria ficar).

## Trabalho pós-spec (fora das 9 fatias, pedido direto do usuário)

- **2026-08-01 — Tema escuro + fidelidade visual ao protótipo.** O
  frontend estava no tema claro por padrão (só ativava dark via
  `prefers-color-scheme`) e vários componentes reais do protótipo nunca
  tinham sido portados (cards de KPI sem borda colorida, sidebar sem
  ícones/badges, layout com `max-width` limitando a largura). Corrigido:
  `web/app/globals.css` reescrito mapeando a paleta e os componentes do
  `gama-crm-mvp.html` 1:1 (dark é o único tema agora, sem variante
  clara — igual ao protótipo). Sidebar ganhou ícones SVG (copiados do
  protótipo) + badges de contagem ao vivo (leads novos, oportunidades
  abertas, tarefas pendentes, empresas) + papel do membro no rodapé.
  Fora de escopo deliberado: topbar fixo com blur do protótipo — exigiria
  lift de estado de título pro layout compartilhado, arquitetura
  diferente da atual (cada página já tem seu próprio cabeçalho).
- **2026-08-01 — CRUD de membros com login/senha.** `/dashboard/membros`
  só permitia editar papel/gerente/status de quem já tinha logado uma
  vez (membership criado automaticamente no primeiro login). Não existia
  jeito de criar um membro novo direto no cadastro. Adicionado
  `POST /memberships`: cria o usuário no Supabase Auth via Admin API
  (`SupabaseUserService`, `src/memberships/`, mesmo padrão de isolamento
  da service role key do `SupabaseStorageService` da Fatia 8) e o
  Membership do workspace numa chamada só. `email_confirm: true` — sem
  fluxo de convite por e-mail (continua fora de escopo), o admin que
  cria já define a senha. Só owner/admin criam.

- **2026-08-01 — Reconstrução do frontend pra fidelidade 1:1 com
  `gama-crm-mvp.html`.** As 9 fatias tinham conectado o backend, mas o
  resultado visual era uma mistura da v1 com a migração — não batia com
  o protótipo. Auditoria (agente Explore, comparação arquivo-a-arquivo)
  achou a causa real: não era só CSS reskin, faltavam subsistemas
  inteiros. Grep confirmou **zero ocorrência** de `modal`/`drawer`/
  `toast`/`topbar` em `web/app` — ficha/formulário eram navegação de
  página cheia, não overlay; cards do pipeline sem cor por stage;
  Ganhar/Perder aparecia em todo cartão em vez de só na última etapa;
  Leads sem barra de score; e existia um Kanban de Tarefas + checklist
  que não estão no protótipo (sobra da v1). Plano completo salvo em
  `C:\Users\Pichau\.claude\plans\humble-inventing-bunny.md` (máquina
  local, não vai no git — só este resumo persiste).

  **Decisões travadas com o usuário antes de começar:**
  1. Modal/drawer como **overlay real**, via **Parallel + Intercepting
     Routes do Next.js** (`@modal`/`@drawer` em `web/app/dashboard/`,
     pastas `(.)segmento` interceptam navegação soft e mantêm a lista
     visível atrás, fundo escurecido, ESC/click-fora fecha; acesso
     direto/refresh cai na rota cheia normal como fallback) — recurso
     nativo do Next, não é lib nova, respeita a regra de "sem libs de
     estado novas" do projeto.
  2. Kanban de Tarefas e checklist **saíram da UI** (não existem no
     protótipo). Endpoint de checklist continua no backend, só não é
     mais exposto na tela — `kanban-board.tsx`/`task-detail.tsx` antigos
     foram apagados, não só desligados.
  3. Execução fatia por fatia, reportando e parando pra confirmação
     entre cada uma; a partir da Fatia 2, a pedido do usuário, deploy no
     Vercel **automático** ao fechar cada fatia (antes disso, só quando
     pedido explicitamente — regra que não mudou pro Railway nem pra
     commit, ver memória `feedback_auto_deploy_vercel`).

  **Fatias fechadas** (build limpo + checklist de segurança §8 do SPEC
  revalidado a cada uma):
  - **Fatia 0** (fundação) — `web/app/globals.css` ganhou ~50 famílias
    de classe do protótipo que faltavam (aditivo, nada removido — cada
    tela migra na própria fatia); infra de overlay
    (`web/app/dashboard/_overlay/{overlay-modal,overlay-drawer,toast}.tsx`)
    plugada no `layout.tsx` via slots `@modal`/`@drawer`; agrupamento do
    menu corrigido (Comercial/Cadastros/Análise, igual ao protótipo).
  - **Fatia 1** (Empresas) — ficha virou drawer, "Nova"/"Editar" viraram
    modal (`.modal.wide` — cadastro real tem ~20 campos herdados do
    antigo Contact, não cabe nos 520px do protótipo). Aba "Dados
    cadastrais" ganhou o card rico da Receita (situação/CNAE/porte/
    natureza jurídica) — exigiu **estender `src/companies/
    company.service.ts`**: `lookupCnpj` já buscava esses campos na
    BrasilAPI mas descartava a maioria antes de chegar no frontend.
    Bug real corrigido de passagem: `updateCustomFieldsAction`
    substituía `customFields` inteiro em vez de mesclar (Prisma não faz
    merge de campo JSON no `update`), apagando silenciosamente dado de
    outra aba a cada save — corrigido lendo o estado atual antes de
    salvar.
  - **Fatia 2** (Pipeline) — board com a cor exata de cada stage do
    protótipo (roxo/azul/verde-água/âmbar por ordem, `stage-colors.ts`).
    Ganhar/Perder saiu do cartão: só aparece no modal de detalhe, e só
    na última etapa ("Negociação e Fechamento"), como o protótipo
    define — antes aparecia em todo cartão de toda coluna. Subform de
    encerradas virou grade de cards azul/vermelho com filtro de período
    completo (navegação por mês + range customizado).
  - **Fatia 3** (Tarefas) — Kanban e checklist fora da UI (ver decisão
    2 acima). Detalhe da tarefa virou modal com anexos reais
    (`.attach-*`, upload via signed URL do Supabase Storage) e chat de
    comentários (`.chat-*`).
  - **Fatia 4** (Leads) — ficha virou drawer, score com barra de
    progresso real (`.score-mini`) + tooltip do cálculo completo.
    `scoreReasons()` novo em `web/lib/api/raw-leads.ts` espelha
    `LeadScoringService#score` do backend só pra exibição (o backend
    calcula `reasons` mas só persiste o `score` final) — mesmo padrão
    que `scoreTier()` já usava, zero mudança de backend.
  - **Fatia 5** (Dashboard + Relatórios) — ícones SVG nos títulos de
    painel, `kpi-delta`/`.up`/`.down` nos KPIs do painel comercial.

  **Verificação desta rodada**: `npm run build` limpo a cada fatia,
  74/74 unit tests do backend passando (rodados de novo no fim, depois
  da extensão do `company.service.ts`), checklist de segurança (grep
  `NEXT_PUBLIC_`) limpo em toda fatia, nenhuma migration/policy de
  RLS/schema tocada (só a extensão aditiva do `lookupCnpj`). **e2e não
  fechou limpo no fim da rodada**: o pool do Supabase (`pool_size: 15`,
  modo *session*) estourou (`EMAXCONNSESSION`) mesmo depois de derrubar
  os dev servers locais e rodar em série (`--runInBand`) — o backend de
  produção no Railway mantém conexões abertas nesse mesmo pool
  compartilhado o tempo todo, então isso não indica regressão desta
  sessão, só que não deu pra reconfirmar os 111 e2e de novo sem
  contenção de conexão. Reexecutar `npm run test:e2e` numa janela sem
  tráfego de produção antes de considerar 100% revalidado.

  **Pendência real, não resolvida nesta rodada**: tudo acima está
  **publicado em produção** (Vercel a cada fatia; Railway também na
  Fatia 1, por causa da extensão do `company.service.ts`) **mas ainda
  NÃO commitado no git** — o usuário pediu deploy incremental
  explicitamente, mas commit continua exigindo pedido à parte (regra do
  projeto, não mudou). O working tree local tem o diff inteiro das 6
  fatias. Se uma sessão nova retomar isso, rodar `git status`/`git
  diff` antes de supor que o repo local ou o GitHub remoto refletem o
  que está em produção — hoje eles **não** refletem.

**Pendência de infra compartilhada por duas features** (Fatia 8 e CRUD de
membros): `SUPABASE_SERVICE_ROLE_KEY` não está configurada no Railway —
eu não tenho esse segredo e não posso gerá-lo (regra de segurança do
projeto). Sem ela: upload de anexo e criação de membro devolvem erro
claro (500), resto do app funciona normal. Pegar em Supabase → Project
Settings → API → `service_role` e colocar como env var do serviço
`backend` no Railway.

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
5. **Tela Leads (Fatia 6, nova)** — precisa rodar `DEV_USER_ID=<uuid>
   npm run prisma:seed` primeiro (não rodei nesta sessão, sem o uuid do
   usuário de dev) pra popular os 6 leads fictícios. Depois: seleção em
   lote + "Selecionar quentes" + "Recalcular scores" (única parte
   client-side da tela, `leads-table.tsx`) e aprovar um lead pelo botão
   da ficha (`?lead=<id>&aba=dados`) — confirmar que ele some da lista e
   aparece em Empresas.
6. **Painel (`/dashboard`) e Relatórios (Fatia 7, novas)** — conferir que
   os KPIs batem com o que está em Pipeline/Tarefas/Leads (é o mesmo
   dado, só agregado diferente) e que o gráfico de origem dos leads
   (SVG donut gerado server-side) renderiza certo.
7. **Anexos em tarefa (Fatia 8, nova)** — **só funciona depois de
   configurar `SUPABASE_SERVICE_ROLE_KEY` no Railway** (ver Fatia 8
   acima). Testar: enviar um arquivo na ficha de uma tarefa, baixar de
   volta, confirmar que outro usuário não consegue remover (só quem
   enviou vê o botão de remover, mas vale confirmar que o backend
   também barra por API direta).
8. **Papéis Admin/Operador (Fatia 9, nova)** — precisa de dois usuários
   reais logados (um com `role='admin'`, outro `role='sales_rep'` — mudar
   em `/dashboard/membros`) pra testar de verdade no navegador; a
   restrição já está provada via e2e contra o Postgres real
   (`test/rls-role-isolation.e2e-spec.ts`), mas nunca foi clicada. Testar:
   operador só vê as próprias oportunidades/tarefas/empresas vinculadas;
   admin vê tudo; um operador não consegue promover a si mesmo pra admin
   (só admin/owner mexe em papel de outro membro).

**Adendo à lista acima, pós-reconstrução (2026-08-01, sessão seguinte)**:
toda a navegação por overlay (modal/drawer via Intercepting Routes) é
nova e nunca foi clicada de verdade — só validada por build + leitura de
código. Testar especificamente: abrir "Nova empresa"/"Nova oportunidade"/
"Nova tarefa" e confirmar que aparece como modal centralizado (não
navega pra página cheia); clicar numa empresa/lead na lista e confirmar
que abre como drawer lateral com a lista ainda visível atrás, escurecida;
apertar ESC ou clicar fora fecha; dar refresh direto numa URL de
ficha/modal (ex. colar `/dashboard/pipeline/<id>` na barra de endereço)
e confirmar que cai na versão de página cheia (fallback), não quebra.

Cada fatia tem os detalhes de decisão/gotcha registrados na memória do
Claude Code (`project_spec_crm_gama_execucao` — mas isso é local da
máquina/conta que rodou, **não vai junto no git**; se outra pessoa/conta
retomar sem acesso a essa memória, este arquivo + o `SPEC-CRM-GAMA.md`
são a fonte de verdade completa).

URLs de teste publicadas (mesmo Supabase real, sem banco de teste
separado): frontend `https://web-gamma-olive-80.vercel.app`, backend
`https://backend-production-bc44.up.railway.app` (rodando em **US
East**). **Ambos redeployados em 2026-08-01 com as 9 fatias completas**
(commits `2a903aa`/`6aaa680`/`7173574`).
Redeploy: `railway up` (raiz) / `vercel --prod` (dentro de `web/`) — não
é automático por push.

**Redeploys adicionais no mesmo dia (sessão da reconstrução do
frontend, ver "Trabalho pós-spec")**: Vercel redeployado a cada fatia
(0 a 5), Railway redeployado uma vez (Fatia 1, extensão do
`company.service.ts`). **Nenhum desses redeploys corresponde a um commit
novo** — o que está em produção agora é mais recente que o que está no
git. Não assumir que `git log`/GitHub refletem o estado publicado até
que alguém peça o commit explicitamente.

Servidores locais de dev podem ou não continuar rodando dependendo de
como a sessão anterior foi encerrada — backend em `:3001`, frontend
tipicamente em `:3002` (não `:3000`, que costuma já estar ocupado por
processo antigo; checar com `netstat` antes de assumir a porta).

## Comunicação

Instrução explícita do usuário (2026-07-27): **responder sempre em
português do Brasil**, em qualquer sessão, independente do idioma da
mensagem de entrada.
Sempre ao concluir uma tarefa de ajuste no código faça o deploy na Vercel.

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
