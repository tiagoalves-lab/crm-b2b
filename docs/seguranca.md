# Segurança — Práticas Obrigatórias

> **Como usar este arquivo**: este é um documento de trabalho, não um
> relatório fechado. Toda dúvida que ainda não tem resposta está marcada
> com `❓ DÚVIDA` — responda direto embaixo dela (ou edite a linha), que
> eu releio antes de implementar. Decisões já fechadas ficam na lista
> numerada de cada seção (`3.1`, `3.2`, ...), com três marcadores:
>
> - **Decisão →** o que ficou valendo.
> - **Fonte →** de onde veio (premissa do usuário, teste real, código
>   existente, auditoria).
> - **Estado →** ✅ implementado e verificado · ⚠️ decidido, **não**
>   implementado · 🔒 risco aceito conscientemente, com data.
>
> O marcador **Estado** é uma extensão deliberada do formato padrão de
> `.claude/skills/doc-decisoes` (que usa só Decisão/Fonte). Ele existe
> porque a auditoria de 2026-08-12 achou exatamente esse tipo de buraco:
> controles descritos no doc como se estivessem valendo, mas que não
> rodavam em lugar nenhum. Em segurança, "decidido" e "funcionando" são
> estados diferentes e o doc precisa distinguir os dois.

Qualquer sessão (humana ou do Claude Code) deve ler este arquivo antes de
tocar em `web/`, autenticação, ou qualquer endpoint que retorne dado de
Company/Opportunity/RawLead.

---

## 0. Modelo de ameaça — de quem estamos nos defendendo

Segurança sem modelo de ameaça vira lista de tarefas sem prioridade. Este
projeto é uma **ferramenta interna da Gama Brasil**, exposta na internet
pública (Vercel + Railway), com login via Supabase Auth. Os atacantes
plausíveis, do mais provável ao menos:

**A. Pessoa com login válido que não deveria ver aquele dado** — o
cenário mais provável de todos, e o menos "hacker". Um representante
comercial troca o ID na URL e abre o lead de outro representante. Não
precisa de nenhuma habilidade técnica. Defesa: seção 4 (autorização por
objeto) + RLS por papel (seção 3).

**B. Ex-funcionário com sessão ou login ainda ativo** — saiu da empresa,
o `Membership` não foi revogado, e continua entrando. Defesa: seção 10
(resposta a incidente / revogação).

**C. Varredura automatizada** — bot que raspa a internet procurando
Supabase mal configurado, endpoint sem auth, `.env` exposto, ou
dependência com CVE conhecido. Não é direcionado à Gama; acha qualquer
um. Defesa: seções 2, 3, 5 e 7.

**D. Vazamento por descuido nosso** — segredo colado em chat, commitado,
ou impresso em log. **Já aconteceu neste projeto** (2026-07-28, senha do
papel `app_runtime` impressa no chat). Defesa: seções 2 e 10.

**E. Atacante direcionado com tempo e recurso** — fora de escopo
realista aqui. Não vamos projetar contra isso, e é honesto dizer isso em
vez de fingir que sim.

O que um atacante ganharia: a carteira comercial inteira da Gama —
CNPJs, contatos, histórico de vendas, pipeline com valores. Dano de
negócio (concorrência) e dano legal (LGPD, seção 9), não dano técnico.

---

## 1. Princípios invioláveis

**1.1 — O frontend é público, sempre.**
Tudo que roda no navegador — todo o código de `web/`, todo `process.env.*`
usado ali, todo texto em componente `"use client"` — é visível pra
qualquer pessoa que abrir o DevTools. Não existe "esconder" nada no lado
do cliente. Isso não é falha a corrigir, é propriedade física de como
frontend funciona. A pergunta certa nunca é "como escondo isso do
frontend", é "isso pode ser público, ou não deveria estar no frontend de
jeito nenhum".

**1.2 — Nenhuma verificação de segurança feita só no frontend vale.**
Botão escondido, campo desabilitado, rota que não aparece no menu: tudo
isso é conveniência visual, nunca controle de acesso. Quem chama a API
direto (curl, DevTools) pula tudo. **Toda** regra de quem-pode-o-quê tem
que existir no backend, e de preferência também no banco (RLS).

**1.3 — Controle que não roda não é controle.**
Se uma regra deste documento não é verificada por um teste, um step de
CI, ou um comando que alguém de fato executa, ela é uma intenção — e
intenção produz confiança sem lastro, que é pior que não ter a regra.
Toda seção abaixo declara **como** ela é verificada. Ver seção 6.

---

## 2. Segredos e variáveis de ambiente

**2.1**
- Decisão → Nenhuma variável de ambiente sem o prefixo `NEXT_PUBLIC_`
  pode ser referenciada em código de `web/`, **nem em arquivo que só roda
  no servidor**.
- Fonte → Premissa do usuário (2026-07-24).
- Estado → ✅ Verificado em 2026-08-12: as 8 referências existentes em
  `web/` são todas `NEXT_PUBLIC_`.

Nuance importante que a versão anterior deste doc não explicitava: essa
regra é **deliberadamente mais rígida do que o Next.js exige**. Server
Components e Server Actions rodam no servidor e *tecnicamente* poderiam
ler segredo sem o prefixo. Nós proibimos assim mesmo, porque distinguir
com certeza o que é servidor e o que virou cliente no App Router é sutil
— basta um `"use client"` a mais numa refatoração pra transformar um
segredo em texto público, sem nenhum aviso do compilador. A margem de
segurança vale mais que a conveniência. Segredo de verdade fica no
backend NestJS, que o frontend chama por HTTP.

**2.2**
- Decisão → Nunca podem existir em `web/`, em `docs/`, em mensagem de
  commit ou em texto de chat: `DATABASE_URL`, `DIRECT_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `ANTHROPIC_API_KEY`,
  `EGESTOR_API_TOKEN_*`, ou qualquer outro segredo — inclusive "só de
  dev".
- Fonte → Premissa do usuário.
- Estado → ✅ Auditado em 2026-07-24 e 2026-08-12, sem achados.

**2.3**
- Decisão → A `NEXT_PUBLIC_SUPABASE_ANON_KEY` é pública por design e
  pode ir pro bundle. Ela não protege nada sozinha — quem protege é o
  RLS (seção 3).
- Fonte → Documentação do Supabase + arquitetura do projeto.
- Estado → ✅

**2.4 — Checagem mecânica antes de qualquer commit que toque em `web/`:**

```sh
grep -rn "process\.env\|process\[" web --include="*.ts" --include="*.tsx" | grep -v node_modules
```

- Decisão → Toda linha que aparecer tem que referenciar só
  `NEXT_PUBLIC_*`. Qualquer outra coisa é vazamento: parar e corrigir
  antes de prosseguir, não depois.
- Fonte → Auditoria de 2026-08-12. O grep anterior era
  `grep -rn "process\.env\."`, que só pegava o acesso literal com ponto
  — **não pegava** `const { MINHA_CHAVE } = process.env` nem
  `process["env"]`. Dava pra furar a regra sem nenhuma má-fé. O padrão
  acima cobre as três formas.
- Estado → ✅ Rodado em 2026-08-12, limpo.

**2.5**
- Decisão → `.env` e `.env.local` nunca entram no git; confirmar com
  `git check-ignore -v <arquivo>` quando houver dúvida.
- Fonte → Premissa do usuário.
- Estado → ✅ `.gitignore` cobre `.env`, `.env.local`, `.env.*.local`.

**2.6**
- Decisão → Nunca imprimir o conteúdo de `.env` no chat ou em log — nem
  parcialmente, nem "só pra conferir". Ler o arquivo com ferramenta que
  não ecoa o valor, ou pedir ao usuário que confirme sem colar.
- Fonte → Incidente real de 2026-07-28 (senha do `app_runtime` vazou no
  chat num `grep` cru). Ver seção 10 pro procedimento de resposta que
  faltava naquele dia.
- Estado → ✅ Regra ativa.

---

## 3. Isolamento de dados — RLS e o papel do Postgres

**3.1**
- Decisão → Nenhuma tabela nova entra no banco sem policy de RLS
  definida na **mesma** migration que a cria. Sem exceção "arrumo
  depois".
- Fonte → Premissa do usuário.
- Estado → ✅ Última tabela sem RLS (`workspaces`) foi fechada em
  2026-08-10 com a policy `app_runtime_only`.

**3.2**
- Decisão → A aplicação conecta em runtime com o papel `app_runtime`
  (sem superuser, sem `BYPASSRLS`), criado em
  `prisma/migrations/20260724120001_app_runtime_role`. O papel `postgres`
  que o Supabase entrega por padrão fica só em `DIRECT_URL`, usado
  exclusivamente por `prisma migrate`.
- Fonte → Comportamento do Postgres: **todo superusuário ignora RLS**,
  inclusive com `FORCE ROW LEVEL SECURITY` ligado. Sem isso, toda a
  seção 3 seria decorativa.
- Estado → ✅ `test/rls-isolation.e2e-spec.ts` falha alto se
  `DATABASE_URL` conectar com um papel `rolbypassrls = true`, em vez de
  passar em silêncio sem provar nada.

**3.3**
- Decisão → O teste de vazamento entre workspaces é pré-requisito de
  qualquer tela nova ligada a dado real.
- Fonte → Premissa do usuário desde a Fase 1.
- Estado → ✅ Implementado; ⚠️ **só passou a rodar automaticamente em
  2026-08-12** (ver decisão 6.1).

**3.4 — Toda tabela, view ou function nova fica exposta pela anon key.**
- Decisão → Ao criar qualquer objeto novo no Postgres, verificar
  explicitamente o que ele expõe **via PostgREST** — a API REST que o
  Supabase publica automaticamente e que qualquer visitante alcança com
  a anon key, **sem passar pelo backend NestJS**. Não basta a rota do
  NestJS estar protegida.
- Fonte → Auditoria de 2026-08-12. A versão anterior deste doc tratava a
  anon key só no contexto de tabela, e o projeto já tem um objeto que
  merece atenção especial: a function `SECURITY DEFINER` de checagem de
  CNPJ duplicado (`prisma/migrations/20260806190000_company_access_contact_owner`).
  Function `SECURITY DEFINER` roda com os privilégios de quem a criou e
  por definição **atravessa o RLS** — é a construção mais perigosa do
  Postgres e a mais fácil de esquecer.
- Estado → ✅ Auditado em 2026-08-12. **A regra estava certa e a
  suspeita se confirmou** — ver 3.4.1 a 3.4.4.

**3.4.1 — VULNERABILIDADE REAL: `v_busca_empresa_lead` atravessava o RLS.**
- Decisão → Corrigida com `security_invoker = true`
  (`prisma/migrations/20260812180000_fix_view_rls_bypass`).
- Fonte → Auditoria de 2026-08-12, confirmada empiricamente (não é
  teoria).
- Estado → ✅ Corrigido, mas **este é o achado mais grave do projeto até
  hoje** e merece ficar registrado por inteiro:
  - A view foi criada em 2026-07-29 **sem** `security_invoker`. Em
    Postgres, view sem essa opção roda com o privilégio do **dono** —
    aqui `postgres`, que ignora RLS. Toda consulta à view lia
    `companies` e `raw_leads` sem nenhuma policy aplicada.
  - Medido antes da correção: como papel `anon`, `raw_leads` devolvia
    **0 linhas** (o RLS funcionando), mas a view devolvia **1176
    linhas** — razão social e CNPJ de toda empresa e todo lead da base.
    Exatamente a carteira comercial que a seção 0 identifica como o
    ativo mais valioso da Gama.
  - Depois da correção: `anon` e `authenticated` recebem
    `permission denied` na view e em tudo mais.
- **A lição, que vale mais que a correção**: o comentário em
  `src/search/search.service.ts` afirmava que a view "já herda RLS das
  tabelas-base, então nenhum filtro de workspace_id extra é necessário
  aqui". A premissa era falsa, e a proteção que ela justificava dispensar
  nunca existiu. **Comentário de código não é evidência.** Foi preciso
  consultar o banco como o papel `anon` pra descobrir — nenhuma leitura
  de código teria pego, porque o código estava coerente com uma
  suposição errada.

**3.4.2 — O PostgREST foi desligado inteiro pra `anon`/`authenticated`.**
- Decisão → `REVOKE ALL` em todas as tabelas, sequences e functions de
  `public` pra `anon` e `authenticated`, mais `ALTER DEFAULT PRIVILEGES`
  pra que objeto novo não nasça exposto de novo.
- Fonte → Mesma migration de 2026-08-12.
- Estado → ✅ Correção estrutural, não pontual: o Supabase concede esse
  acesso por padrão porque assume um app que fala direto com o banco
  pelo navegador. **Não é o caso deste projeto** (ver 3.4.3), então a
  API REST automática era superfície de ataque 100% desnecessária — e
  era por onde a view vazava. Fechar a categoria inteira vale mais que
  corrigir só a view: se amanhã alguém criar outra view distraidamente,
  ela já nasce inalcançável de fora.
- Seguro porque → `app_runtime` **não** é membro de `anon`/`authenticated`
  (checado em `pg_auth_members`) e tem grants próprios nas 20 tabelas.
  Verificado depois: suíte e2e completa passa, incluindo
  `search.e2e-spec.ts`.
- **Provou-se sozinho no mesmo dia**: a tabela `egestor_webhook_events`,
  criada horas depois por outra frente de trabalho
  (`20260812190000_egestor_webhook_events`), nasceu com grants só pra
  `app_runtime`/`postgres`/`service_role` — **sem `anon`, sem
  `authenticated`** — sem ninguém ter lembrado de nada. É a diferença
  entre corrigir um caso e fechar uma categoria: o `ALTER DEFAULT
  PRIVILEGES` protege o código que ainda não foi escrito.

**3.4.3 — A chave pública do Supabase nunca chega ao navegador.**
- Decisão → Registrar como propriedade real da arquitetura atual, e
  como algo a **não** quebrar sem perceber.
- Fonte → Auditoria de 2026-08-12: `web/lib/supabase/client.ts` (o
  client de navegador) não é importado por ninguém, e o login usa Server
  Action. Confirmado também tentando extrair a chave do bundle publicado
  — não está lá.
- Estado → ✅ Melhor do que a decisão 2.3 assumia. Mas **isto não é uma
  proteção**, é uma consequência do desenho: chave pública continua
  sendo classe pública, e bastaria alguém instanciar o client de
  navegador numa tela nova pra publicá-la. Quem protege é o RLS
  (3.1–3.3) e o REVOKE (3.4.2), nessa ordem.

**3.4.4 — A chave antiga do `.env.local` está desativada.**
- Decisão → Registrar o falso negativo, porque ele quase produziu uma
  conclusão errada.
- Fonte → Auditoria de 2026-08-12.
- Estado → 🔒 A primeira tentativa de teste usou a anon key do
  `web/.env.local` e recebeu 401 em tudo. Parecia ótimo — mas o motivo
  era `"Legacy API keys are disabled"` (o Supabase desativou as chaves
  legadas deste projeto em 2026-08-11). O teste morreu na porta de
  entrada e **não exercitou o RLS nem a view**. Se eu tivesse parado ali,
  teria reportado "nada vazando" no exato dia em que 1176 linhas
  vazavam. Regra que fica: **um bloqueio só conta como prova se você
  souber qual camada bloqueou.**

---

## 4. Autorização por objeto — dentro do mesmo workspace

Esta seção inteira **não existia** até a auditoria de 2026-08-12, e cobre
o cenário A do modelo de ameaça — o mais provável de todos.

**4.1**
- Decisão → RLS protege *workspace contra workspace*. Ele **não** é
  suficiente pra proteger *usuário contra usuário dentro do mesmo
  workspace*. Todo endpoint que recebe um id de recurso (`:id`) tem que
  provar, no backend, que aquele usuário pode ver/alterar **aquele
  registro específico** — via `PolicyService` e o `mustBeVisible` do
  service correspondente.
- Fonte → Auditoria de 2026-08-12. O checklist anterior deste doc não
  tinha nenhum item que pegasse a falta de `mustBeVisible`: um endpoint
  novo que esquecesse a checagem passava em todos os itens e ninguém
  notava.
- Estado → ✅ O padrão está implementado (30 arquivos em `src/` usam
  `policy`/`mustBeVisible`, pra 16 controllers), mas ⚠️ **não há nada
  que impeça um endpoint novo de esquecer**.

**4.2**
- Decisão → Ordem obrigatória das checagens: **404 antes de 403**. Se o
  registro não pertence ao escopo do usuário, responder "não encontrado",
  não "proibido".
- Fonte → Código já existente (implementado em 2026-08-03 nos contatos).
- Estado → ✅ Responder 403 confirma pro atacante que o id existe —
  vira um oráculo de enumeração. Manter o padrão.

**4.3 — O esquecimento agora quebra o build.**
- Decisão → `test/idor.e2e-spec.ts` prova, pela rota HTTP, que um
  `sales_rep` não alcança o registro de outro do mesmo workspace — e
  **falha quando alguém adiciona uma rota com `:id` sem classificá-la**.
- Fonte → Decisão do usuário (opção "b" da dúvida original), implementada
  em 2026-08-12.
- Estado → ✅ 15 testes. Cobre leitura (404, nunca 403 — decisão 4.2),
  escrita (`PATCH` não altera, `DELETE` não apaga, com verificação
  independente no banco de que o valor original sobreviveu) e as rotas
  de admin (403).
- Por que a varredura é a parte que importa → Os outros 14 testes provam
  o que já funciona hoje; envelhecem bem mas não impedem nada. A
  varredura enumera as rotas reais do Express em tempo de execução e
  exige que todo caminho com `:id` esteja classificado como "com dono"
  (espera 404) ou "de admin" (403/404). Rota nova sem classificação =
  teste vermelho, com a mensagem dizendo o que fazer. É o que substitui
  "lembrar" por "não tem como esquecer".
- Detalhe → A varredura também exige encontrar mais de 20 rotas. Sem
  isso, uma mudança no formato de introspecção do Express faria a
  varredura passar de graça — teste que não consegue falhar é pior que
  teste nenhum (mesmo princípio do teste de RLS, decisão 3.2).

**4.5 — Rotas públicas são uma terceira categoria, declarada.**
- Decisão → Toda rota `@Public()` entra em `ROTAS_PUBLICAS` no
  `test/idor.e2e-spec.ts`, com teste próprio provando qual controle
  substitui o login.
- Fonte → Falha do próprio teste, encontrada em 2026-08-12.
- Estado → ✅ Corrigido. A primeira versão da varredura classificava por
  **primeiro segmento** do caminho. Quando surgiu
  `POST /integrations/egestor/webhook/:estabelecimento` — rota
  **pública, sem JWT** — ela caiu debaixo do prefixo `integrations`, já
  classificado como "de admin", e a varredura aprovou em silêncio uma
  rota sem autenticação nenhuma. Agora a classificação é por **caminho
  completo**: prefixo largo demais é varredura que aprova o que não
  olhou.
- Hoje há **duas** rotas públicas de dado no projeto — as duas são
  webhook de integração, e cada uma declara qual controle substitui o
  login:
  - **Webhook do eGestor** (`POST /integrations/egestor/webhook/
    :estabelecimento`). Protegido pelo `securityToken` do corpo,
    comparado com `timingSafeEqual`; o token é removido do payload antes
    de gravar — não vai pro banco. Três testes cobrem isso (token errado
    → 401, sem token → 400/401, estabelecimento inválido → 4xx).
  - **Webhook do Meta** (`GET`/`POST /integrations/meta-leads/webhook`,
    2026-08-14). Protegido por assinatura HMAC-SHA256 do corpo **cru**
    (`X-Hub-Signature-256`) com o App Secret, comparada em tempo
    constante; o `GET` é o handshake de verificação e só devolve o
    `hub.challenge` se o `hub.verify_token` bater. Nenhum segredo é
    persistido (o `rawPayload` gravado só tem identificadores). Três
    testes cobrem isso — e eles conferem a **mensagem** da recusa, não só
    o status: sem isso passariam verde mesmo se o 401 viesse de "segredo
    não configurado" em vez de "assinatura inválida", que é 401 pelo
    motivo errado (ver decisão 4.4 e a mesma armadilha na seção 6).

**4.6 — Webhook do eGestor: pendência de configuração.**
- Decisão → Registrar que `EGESTOR_WEBHOOK_SECURITY_TOKEN_MATRIZ` e
  `..._FILIAL` existem no `.env` local mas **não** estão configuradas no
  Railway.
- Fonte → Auditoria de 2026-08-12.
- Estado → ⚠️ Em produção o endpoint responde 401 a tudo. É **falha
  fechada** (o comportamento seguro — sem token configurado nada é
  aceito), então não há risco; mas a funcionalidade não opera até o
  usuário configurar as duas variáveis no Railway. Só ele tem os valores
  (vêm da conta do eGestor).

**4.4 — Achados da primeira execução.**
- Decisão → Registrar o que o teste pegou logo de cara, porque é
  evidência de que o mecanismo funciona.
- Fonte → Execução de 2026-08-12.
- Estado → ✅ Dois achados:
  - **4 rotas do módulo eGestor** (`contatos/:id/corrigir`,
    `/consolidar`, `/corrigir-sefaz`, `/completar`) não tinham nenhuma
    cobertura de teste de autorização. Verificadas no código: as 7 rotas
    do controller checam `SYNC_ROLES` (owner/admin) e escopam por
    workspace — estavam corretas, só não provadas. Agora têm teste. Não
    era falha, era ponto cego: são rotas que **escrevem de volta no ERP
    de terceiro**, então um acesso indevido ali não vazaria leitura,
    alteraria dado no sistema da empresa.
  - **Ordem de validação x autorização**: o `ValidationPipe` global roda
    antes do handler, então body inválido devolve 400 sem nunca chegar
    na checagem de papel. Não é falha (400 não vaza nada e não executa a
    ação), mas o teste precisa mandar corpo **válido** — senão passaria
    verde sem nunca ter exercitado a autorização. Um falso "protegido".

**4.7 — Acesso exige cadastro prévio (não basta ter conta no Supabase).**
- Decisão → Um login válido do Supabase Auth **não** entra sozinho no
  CRM. Só entra quem um gestor já cadastrou (`POST /memberships`).
  `TenantMembershipGuard` nega (403) qualquer usuário autenticado sem
  `Membership` no workspace. Única exceção: o bootstrap do primeiríssimo
  login de um workspace **vazio** (vira owner), que em produção já
  ocorreu e nunca mais dispara.
- Fonte → Auditoria de 2026-08-20. Até então o guard **criava um
  `sales_rep` automático** pra qualquer JWT válido — o que transformava
  "ter conta no Supabase Auth" em "ser funcionário da Gama" (cenário B do
  modelo de ameaça). A porta só não era explorável de fora porque a
  chave pública do Supabase não vaza pro navegador (decisão 3.4.3) — uma
  única barreira, do tipo que a decisão 3.4.3 avisa **não** bastar
  sozinha. O cadastro público do Supabase (`disable_signup=false`) era a
  outra metade da mesma porta.
- Estado → ✅ **As duas metades fechadas e verificadas em 2026-08-20.**
  - **Metade do código** (guard) → corrigida e publicada no Railway.
    `test/membership-gate.e2e-spec.ts` exercita o guard **real** contra a
    RLS real (não o stub de `test/utils/fake-auth.ts`): prova que um
    usuário sem cadastro leva 403 **e** que nada é criado no banco, e que
    um membro já cadastrado continua entrando.
  - **Metade da configuração** (Supabase) → cadastro público desligado no
    painel (Authentication → Sign In / Providers → User Signups →
    *Allow new users to sign up*). Verificado no servidor, não só na tela:
    `/auth/v1/settings` devolve `disable_signup=true`, e uma tentativa
    real de `POST /auth/v1/signup` agora responde `signup_disabled`
    (*"Signups not allowed for this instance"*), onde antes prosseguia.
    `Confirm email` segue ligada.

---

## 5. Superfície HTTP — CORS, cabeçalhos e rate limiting

**5.1**
- Decisão → CORS restrito à origem real do frontend, nunca `origin: '*'`
  com credenciais. Se `FRONTEND_ORIGIN` não estiver configurada, o
  backend **não sobe**.
- Fonte → Premissa do usuário.
- Estado → ✅ [src/main.ts:27-32](../src/main.ts#L27-L32) — falha ruidosa
  na inicialização, que é o comportamento certo: erro de configuração de
  segurança nunca deve degradar em silêncio.

**5.2**
- Decisão → O guard de autenticação valida o JWT do Supabase antes de
  qualquer handler rodar. Nenhuma rota de dado de negócio fica acessível
  sem isso, nem "temporariamente" durante desenvolvimento.
- Fonte → Premissa do usuário.
- Estado → ✅ Verificação assimétrica, aceitando **só** `ES256`/`RS256`
  ([src/auth/verify-supabase-jwt.ts:27](../src/auth/verify-supabase-jwt.ts#L27)).
  Aceitar `HS256` ali abriria brecha pra token forjado, porque a chave
  pública do projeto viraria a chave de assinatura. É uma das falhas
  clássicas de JWT e está fechada.

**5.3 — Cabeçalhos de segurança HTTP.**
- Decisão → O app envia, no mínimo: `Content-Security-Policy`,
  `Strict-Transport-Security`, `X-Frame-Options: DENY` (+ `frame-ancestors`
  na CSP), `X-Content-Type-Options: nosniff`, `Referrer-Policy` e
  `Permissions-Policy`.
- Fonte → Auditoria de 2026-08-12. A categoria inteira estava ausente do
  doc anterior.
- Estado → ✅ Implementado em 2026-08-12. Cabeçalhos estáticos em
  `web/next.config.ts` (aplicados a `/:path*`, cobrindo também
  `_next/static`, que o middleware não alcança); `helmet` no backend
  (`src/main.ts`), com `crossOriginResourcePolicy: cross-origin` porque
  o default `same-origin` viraria armadilha se alguma tela passar a
  chamar a API do navegador.

**5.3.1 — A CSP usa nonce por requisição, não `unsafe-inline`.**
- Decisão → `script-src` aceita só `'self'`, o nonce daquela requisição
  e `'strict-dynamic'`. `style-src` mantém `'unsafe-inline'`
  conscientemente (o Next injeta CSS inline no streaming de RSC e não há
  como nonce-ar tudo; estilo inline não executa código, o risco é ordens
  de grandeza menor que script inline).
- Fonte → Implementação em `web/middleware.ts` (2026-08-12).
- Estado → ✅ **Verificado no navegador**, não só no código: build de
  produção servido localmente, Chrome headless via CDP,
  **0 violações de CSP** e a página de login hidratando normalmente
  (React montou, formulário presente). Os 11 `<script>` da página vieram
  todos com o nonce — se a propagação falhasse, a CSP bloquearia tudo e
  o app ficaria em branco. Também confirmado que o redirect
  `/dashboard` → `/login` sem sessão continua funcionando e carrega a CSP.
- Detalhe → Ambiente de desenvolvimento é detectado por **hostname**
  (`localhost`/`127.0.0.1`), não por `NODE_ENV`. Duas razões: mantém a
  decisão 2.1 sem nenhuma exceção (nenhuma env var fora do padrão
  `NEXT_PUBLIC_` em `web/`), e impede que variável de ambiente mal
  configurada afrouxe a produção por acidente. Em dev entram
  `'unsafe-eval'` (Fast Refresh) e `ws:` (HMR); em produção entra
  `upgrade-insecure-requests`.

**5.4 — Rate limiting.**
- Decisão → Limite global generoso (300 req/min) + limites apertados nas
  rotas caras: importação de planilha (10/min) e sync do eGestor (3/min).
- Fonte → Auditoria de 2026-08-12. Vinha sendo arrastado desde a Fase 8
  do roadmap com a redação "revisar se não deveria entrar antes" — uma
  dúvida que nunca fechou, registrada como se fosse plano.
- Estado → ✅ Implementado em 2026-08-12 (`@nestjs/throttler`,
  `UserThrottlerGuard`).

**5.4.1 — O rate limit é chaveado por USUÁRIO, nunca por IP.**
- Decisão → O tracker usa o `sub` do JWT (`request.user.id`), caindo pra
  IP só nas rotas públicas.
- Fonte → Achado da implementação (2026-08-12), confirmado no código:
  **nenhum componente client importa `apiFetch`**. Todas as telas são
  Server Components/Server Actions, então 100% do tráfego que chega ao
  backend sai dos servidores da Vercel, de um punhado de IPs de saída
  compartilhados.
- Estado → ✅ Esta é a decisão mais importante desta seção. Um limite por
  IP — que é o **default** do `@nestjs/throttler` — seria na prática um
  limite global: alguns representantes navegando ao mesmo tempo
  derrubariam o CRM para todo mundo. O default teria parecido correto e
  quebrado produção sob carga normal.
- Garantia → `src/common/throttler/user-throttler.guard.spec.ts` trava
  nisso: um dos testes exige que dois usuários distintos atrás do mesmo
  IP caiam em baldes diferentes. Se alguém reverter pro tracker padrão,
  o teste quebra.

**5.4.2 — Ordem dos guards.**
- Decisão → O `UserThrottlerGuard` é registrado nos `providers` do
  próprio `AppModule`, não num módulo importado.
- Fonte → Comportamento do Nest: providers do módulo host resolvem
  depois dos imports, então o guard roda **depois** do
  `SupabaseAuthGuard` e enxerga `request.user`.
- Estado → ✅ Se essa ordem inverter, o tracker perde o usuário e cai no
  IP — ou seja, vira o cenário quebrado de 5.4.1, em silêncio. O
  trade-off aceito é que a checagem de limite acontece depois da
  validação do JWT (custo pequeno: verificação assimétrica com JWKS em
  cache).

**5.4.3 — O contador é por réplica, não global.**
- Decisão → Manter o storage padrão do `@nestjs/throttler` (em memória
  do processo), sem Redis.
- Fonte → Medição em produção logo após o deploy de 2026-08-12:
  chamadas seguidas ao `/health` devolveram `x-ratelimit-remaining`
  oscilando entre 299 e 298, o que só acontece com **mais de uma réplica
  no Railway**, cada uma contando o seu próprio balde.
- Estado → 🔒 Risco aceito, com duas consequências que precisam estar
  escritas em vez de descobertas depois:
  - o limite efetivo é `limite × número de réplicas` (então "300/min"
    é na prática um teto mais alto, não um número exato);
  - todo redeploy zera os contadores.
- Por que aceitar → O objetivo aqui é conter abuso e laço infinito, não
  cobrar quota com precisão. Mesmo multiplicado pelas réplicas, o teto
  continua limitado, e o limite apertado das rotas caras (10/min de
  import) segue valendo a pena. A alternativa — storage compartilhado em
  Redis — significa mais um serviço pago e mais uma peça pra manter numa
  ferramenta interna de uma empresa só. Desproporcional ao ganho.
- Quando revisitar → Se o CRM passar a ter usuário externo, ou se
  aparecer abuso real que o limite por réplica não segure.

**5.5**
- Decisão → Logs nunca imprimem payload inteiro de request/response em
  rota que lida com dado de Company/Contact/RawLead — nem em dev. Log
  estruturado, campos específicos, nunca `console.log(req.body)`.
- Fonte → Premissa do usuário.
- Estado → ✅ Regra ativa.

---

## 6. Automação — quais controles rodam sozinhos

**6.1**
- Decisão → O CI dispara em `push` para `master` (e `main`, por
  segurança caso o padrão mude) e em todo `pull_request`.
- Fonte → Auditoria de 2026-08-12 — **o achado mais grave da auditoria**.
  O workflow disparava só em `branches: [main]`, mas o repositório usa
  `master`. Consequência: desde a criação do repo, **nenhum teste deste
  projeto rodou automaticamente uma única vez** — incluindo
  `test/rls-isolation.e2e-spec.ts`, que este documento apresentava como
  a garantia central do isolamento de dados. O controle existia, estava
  correto, e estava desarmado.
- Estado → ✅ Corrigido em 2026-08-12 (`.github/workflows/ci.yml`).

**6.2**
- Decisão → O CI roda, em toda mudança: `lint`, `build`, os testes
  unitários, `prisma migrate deploy`, e os testes e2e — estes últimos
  contra um papel `app_runtime` com senha efêmera, **sem** privilégio de
  superusuário, igual à produção.
- Fonte → Código já existente, agora de fato executado por 6.1.
- Estado → ✅

**6.3**
- Decisão → O que **não** é verificado automaticamente e depende de
  disciplina humana, declarado aqui pra não virar falsa sensação de
  segurança: o grep da decisão 2.4, a ausência de dado real (seção 9), a
  revisão de `GRANT` da decisão 3.4 e a CSP da decisão 5.3.1.
  (O `mustBeVisible` da decisão 4.1 **saiu** desta lista em 2026-08-12 —
  passou a ser verificado por `test/idor.e2e-spec.ts`, decisão 4.3.)
- Fonte → Princípio 1.3.
- Estado → ✅ Declarado.

**6.4**
- Decisão → Controles que **passaram** a ser verificados por teste
  automático em 2026-08-12: o chaveamento do rate limit por usuário
  (decisão 5.4.1) e a recusa de `HS256` no JWT
  (`src/auth/verify-supabase-jwt.spec.ts`).
- Fonte → Implementação de 5.3/5.4.
- Estado → ✅ 201 testes unitários passando (eram 196 antes desta
  sessão).

A CSP (decisão 5.3.1) **não** tem teste automático — foi verificada
manualmente no navegador. Um teste de fumaça que suba o build e conte
violações de CSP seria o jeito de armar isso; hoje é disciplina humana,
e está declarado aqui justamente por isso.

**6.5 — Rodar a suíte e2e local pode DERRUBAR produção.**
- Decisão → Registrar como risco operacional conhecido, ainda sem
  correção.
- Fonte → Aconteceu de verdade em 2026-08-12, durante esta auditoria.
- Estado → ✅ **Corrigido em 2026-08-12** com `?connection_limit=5` na
  `DATABASE_URL` (Railway e `.env` local). O que houve: não existe banco de teste
  separado (ver `CLAUDE.md`), então os testes e2e e os scripts de
  auditoria conectam no **mesmo pooler** que a produção, que tem
  `pool_size: 15`. Scripts avulsos saturaram o pool e o backend em
  produção passou a responder com
  `FATAL: (EMAXCONNSESSION) max clients reached` — 13 erros registrados
  nos logs do Railway antes de eu liberar as conexões ociosas. Depois
  disso a suíte e2e passou a falhar por falta de conexão, não por bug:
  `activities.e2e-spec.ts` falhou 2 testes e passou 19/19 assim que o
  pool foi liberado.
- Mitigação imediata → Scripts de investigação devem usar `DIRECT_URL`
  (conexão direta, fora do pooler), nunca `DATABASE_URL`. Rodar e2e com
  `--runInBand`. Se travar, encerrar sessões `app_runtime` **ociosas há
  mais de 30s** (nunca `active` nem `idle in transaction`).
- Correção aplicada → `?connection_limit=5` na `DATABASE_URL`. Sem esse
  parâmetro o Prisma dimensiona o pool sozinho (`núcleos × 2 + 1`), que
  numa máquina de vários núcleos tenta abrir mais conexões do que o
  pooler inteiro comporta — a aplicação consumia as 15 sozinha. O
  trade-off aceito é fila sob carga alta; para o volume real (uma dúzia
  de usuários internos) 5 por réplica é folgado.
- Verificado → Depois da mudança, a suíte e2e completa
  (13 suítes / 171 testes) rodou **com produção no ar ao mesmo tempo**:
  tudo verde e **zero** ocorrências de `EMAXCONNSESSION` nos logs do
  Railway. Antes da mudança, a mesma suíte falhava por falta de conexão
  e gerava erro de banco pros usuários.
- Regra que fica → Script de investigação usa `DIRECT_URL` (fora do
  pooler), nunca `DATABASE_URL`; suíte e2e roda com `--runInBand`.

---

## 7. Dependências vulneráveis

Categoria ausente do doc anterior, e estatisticamente **o vetor mais
comum de invasão real de um app Node** — mais que falha de lógica no
código próprio.

**7.1**
- Decisão → O CI roda `npm audit` no backend e em `web/`, e **falha** se
  houver vulnerabilidade `critical`.
- Fonte → Auditoria de 2026-08-12.
- Estado → ✅ Job `audit` em `.github/workflows/ci.yml`.

**7.2**
- Decisão → A auditoria usa `--omit=dev`, ou seja, cobre só o que vai
  pro servidor em produção.
- Fonte → Decisão do usuário, perguntada direto (2026-08-12).
- Estado → 🔒 Risco aceito. O trade-off explícito: ferramenta de linha de
  comando que nunca é publicada (hoje `@railway/cli`, que arrasta um
  `tar` com CVE `critical`) fica fora do gate. Sem isso o CI travaria em
  CVE de ferramenta de deploy — e gate que trava por ruído é gate que
  todo mundo aprende a ignorar, que é pior que não ter gate.

**7.3 — Dívida datada: o gate está em `critical`, não em `high`.**
- Decisão → O nível de bloqueio sobe de `critical` para `high` assim que
  as pendências abaixo forem resolvidas.
- Fonte → Decisão do usuário, perguntada direto (2026-08-12).
- Estado → 🔒 Risco aceito em **2026-08-12**, com as seguintes
  vulnerabilidades `high` conhecidas e em aberto:
  - `web/`: `postcss`, `nanoid` e `sharp` (4 avisos `high`, incluindo
    CVEs de `libvips` no `sharp`) — todas vêm do `next@15.5.21` e só
    somem com **`next@16`**, que é upgrade de major. Atenuante apurado
    em 2026-08-12: **o projeto não usa `next/image` em lugar nenhum**,
    então o `sharp` (que é o pior dos quatro, por processar imagem) não
    chega a ser exercitado em runtime. Isso rebaixa a urgência do
    upgrade — não a elimina.
  - backend: `uuid` (moderate) via `exceljs` — a correção exigiria
    downgrade do `exceljs` pra 3.4.0, o que quebra o import de planilha.
    Não compensa.
  - Já resolvido nesta data: `brace-expansion` (`high`, DoS) via
    `npm audit fix`, sem quebra — build e 196 testes validados depois.

❓ **DÚVIDA — quando subir o `next` pra 16?** É a única pendência que
separa o gate de `critical` pra `high`. É upgrade de major do frontend
que está em produção: pode afetar o build, as rotas interceptadas (que
este projeto usa bastante nos modais/drawers) e o deploy da Vercel.
Sugiro tratar como tarefa própria, com validação no navegador — não
junto de outra coisa. Marco pra quando?

**7.4**
- Decisão → Nenhuma dependência nova entra sem uma olhada em quem a
  mantém e há quanto tempo. Pacote abandonado é dívida de segurança
  garantida.
- Fonte → Auditoria de 2026-08-12.
- Estado → ✅ Regra ativa.

❓ **DÚVIDA — varredura de segredo no histórico do git?** Hoje nada
impede que um segredo entre num commit futuro. As opções: Dependabot
(grátis, cobre dependência mas não segredo), GitHub secret scanning
(exige Advanced Security em repo privado — pago), ou uma action de
`gitleaks` no CI (grátis, roda em todo push). Recomendo o `gitleaks`.
Adiciono?

---

## 8. Upload de arquivo e Supabase Storage

**8.1**
- Decisão → O binário do anexo **nunca** passa pelo NestJS: o backend
  emite uma signed URL e o navegador envia direto pro Supabase Storage.
  O bucket (`task-attachments`) é privado e o download também é por
  signed URL.
- Fonte → Código já existente.
- Estado → ✅

**8.2**
- Decisão → O nome do arquivo é sanitizado antes de virar caminho no
  Storage, e o caminho final é sempre prefixado por `workspaceId`.
- Fonte → Código já existente
  (`buildStoragePath`, em `src/opportunities/opportunity-attachment.service.ts`).
- Estado → ✅ Remove tudo que não seja `[a-zA-Z0-9._-]`, colapsa `..`
  (path traversal) e prefixa um UUID — dois arquivos de mesmo nome não
  colidem e nenhum escapa da pasta do workspace.

**8.3 — O Storage é acessado com a service role key, de propósito.**
- Decisão → `SupabaseStorageService` usa a `SUPABASE_SERVICE_ROLE_KEY` e
  portanto **atravessa** qualquer policy de `storage.objects`. A
  fronteira de segurança dos anexos é o backend (`mustBeVisible` +
  `PolicyService`), não o Storage.
- Fonte → Decisão de arquitetura do projeto.
- Estado → 🔒 Risco aceito e **agora documentado aqui**. A auditoria de
  2026-08-12 achou essa decisão registrada apenas num comentário de
  código — peso demais pra um comentário que ninguém relê. A
  consequência prática: qualquer bug de autorização no backend vira
  acesso a **todos** os anexos de **todos** os workspaces, sem segunda
  barreira. Isso torna a seção 4 mais crítica do que pareceria.

**8.4**
- Decisão → `mimeType` e `sizeBytes` chegam **do cliente** e hoje não
  são conferidos contra o conteúdo real do arquivo.
- Fonte → Auditoria de 2026-08-12
  (`src/opportunities/dto/create-attachment.dto.ts`).
- Estado → ⚠️ Limitação conhecida. Mitigação atual: o bucket é privado,
  o download é sempre por signed URL e o arquivo nunca é servido a
  partir da origem do app — então um arquivo malicioso subido aqui não
  executa no contexto do CRM. O risco residual é a plataforma virar
  hospedagem de arquivo indesejado por alguém que já tem login.

❓ **DÚVIDA — vale endurecer o upload?** Daria pra (a) restringir a uma
lista de extensões/mime aceitos e (b) ler o cabeçalho real do arquivo
depois do upload pra confirmar que bate com o `mimeType` declarado.
Dado que o risco residual acima é baixo, minha recomendação honesta é
deixar como está e priorizar 5.3/5.4. Concorda?

---

## 9. Dado pessoal, LGPD e dado de exemplo

**9.1**
- Decisão → Nenhum dado real de empresa ou pessoa (CNPJ, telefone,
  e-mail, nome) entra em código-fonte, mensagem de commit, documentação,
  ou artifact/prévia publicada. Dado de exemplo é sempre fictício.
- Fonte → Premissa do usuário.
- Estado → ✅ Auditado em 2026-07-24 e 2026-08-12, sem achados.

**9.2**
- Decisão → Planilha ou export com dado real que precise ficar em
  `docs/` como referência de trabalho vai pro `.gitignore`
  (`docs/*.csv`, `docs/*.xlsx`), nunca versionado. O staging de leads
  (`leads/*.duckdb`) é tratado como sensível mesmo fora do git: não
  compartilhar, não anexar em chat, não copiar pra fora da máquina sem
  necessidade.
- Fonte → Premissa do usuário.
- Estado → ✅

**9.3**
- Decisão → Nenhum endpoint devolve mais campos do que a tela precisa —
  evitar `SELECT *` que vaza campo sensível não usado na UI.
- Fonte → Premissa do usuário.
- Estado → ✅ Regra ativa.

**9.4 — O CRM processa dado pessoal sob a LGPD.**
- Decisão → Reconhecer explicitamente que nome, e-mail, telefone e cargo
  de contatos em empresas-cliente **são dado pessoal** na LGPD, mesmo
  em contexto B2B, e que a Gama é controladora desse dado.
- Fonte → Auditoria de 2026-08-12. A categoria estava completamente
  ausente do doc anterior.
- Estado → ⚠️ Reconhecido, sem providência tomada.

❓ **DÚVIDA — qual o apetite pra LGPD agora?** Isso é decisão de negócio,
não técnica, então não escolho por você. Os pontos que costumam ser
cobrados de um CRM: (a) base legal pro tratamento (legítimo interesse é
o usual em prospecção B2B, mas precisa ser registrado); (b) política de
retenção — hoje nada é apagado nunca; (c) canal pra titular pedir
exclusão/correção; (d) registro de quem acessou o quê. Nada disso é
urgente do ponto de vista de invasão, mas (b) e (c) são os que mais
aparecem em auditoria. Quer que eu abra um doc separado pra isso, ou
fica fora de escopo por enquanto?

---

## 10. Resposta a incidente

Seção nova (2026-08-12). Existe porque o projeto **já teve** um vazamento
(2026-07-28) e naquele dia não havia procedimento — a decisão foi tomada
no improviso.

**10.1 — Se um segredo vazar** (chat, commit, log, print, tela
compartilhada):
- Decisão → A ordem é: **1)** rotacionar a credencial imediatamente
  (Supabase: gerar nova key/senha; Railway/Vercel: atualizar a env var e
  redeployar); **2)** só depois investigar como vazou. Nunca o inverso.
- Fonte → Auditoria de 2026-08-12.
- Estado → ✅ Procedimento definido.

Ponto crítico que confunde muita gente: **apagar a mensagem, o commit ou
o log não resolve**. Um segredo exposto deve ser considerado
comprometido para sempre, porque não há como provar que ninguém copiou
no intervalo. A única ação que de fato resolve é rotacionar. Reescrever
o histórico do git é higiene, não remédio.

**10.2 — Incidente de 2026-07-28: senha do `app_runtime` no chat.**
- Decisão → Rotacionada.
- Fonte → Incidente de 2026-07-28 (a senha foi impressa no chat por um
  `grep` cru no `.env`); na época o usuário optou por não rotacionar.
  Reaberto e fechado na auditoria de 2026-08-12.
- Estado → ✅ **Rotacionada em 2026-08-12.** Era a única credencial do
  projeto sabidamente exposta, e o único risco aceito que não tinha
  justificativa técnica — só inércia.

**10.2.1 — Procedimento usado (serve de roteiro pra próxima vez).**
- Decisão → Rotação executada inteira dentro de **um único comando de
  shell**, com a senha vivendo só numa variável de ambiente do processo.
- Fonte → Execução de 2026-08-12.
- Estado → ✅ O ponto não é burocracia: a rotação da senha vazada não
  podia, ela mesma, vazar a senha nova. Por isso:
  - senha gerada com `openssl rand -hex 32` (hex evita problema de
    encoding dentro da URL de conexão);
  - `ALTER ROLE` enviado por **stdin** pro `prisma db execute`, nunca
    como argumento de linha de comando (argumento aparece na lista de
    processos);
  - variável do Railway definida com `railway variables
    --set-from-stdin DATABASE_URL`, pelo mesmo motivo;
  - `.env` local reescrito por script, sem `cat`/`grep` no arquivo;
  - nenhum passo imprimiu o valor — só mensagens de status.
- Detalhe → A conexão da aplicação passa pelo **pooler** do Supabase
  (usuário `app_runtime.<ref>`), mas o papel real no Postgres é
  `app_runtime` — é esse o nome no `ALTER ROLE`.
- Verificado depois → conexão nova funciona; `app_runtime` continua
  **sem** `rolsuper` e **sem** `rolbypassrls` (checado por um bloco
  `DO` que levanta exceção se tiver ganhado privilégio); container novo
  no Railway subiu limpo, sem nenhum erro de autenticação de banco.

**10.3 — Se alguém sair da empresa ou perder o acesso:**
- Decisão → Remover o `Membership` **e** revogar as sessões ativas no
  Supabase Auth. Só remover o `Membership` não derruba quem já está
  logado até o token expirar.
- Fonte → Auditoria de 2026-08-12 (cenário B do modelo de ameaça).
- Estado → ⚠️ Procedimento definido, sem botão na UI — hoje exige ação
  manual no painel do Supabase.

**10.4 — Se suspeitar de acesso indevido:**
- Decisão → Ordem: **1)** revogar as sessões do usuário suspeito; **2)**
  consultar os logs do Supabase (Auth + Postgres) pra delimitar o que
  foi acessado e quando; **3)** rotacionar as credenciais de serviço se
  houver qualquer dúvida; **4)** só então avaliar notificação a titulares
  (seção 9).
- Fonte → Auditoria de 2026-08-12.
- Estado → ✅ Procedimento definido.

---

## 11. Checklists por tipo de mudança

A versão anterior deste doc tinha **um** checklist, "antes de integrar
frontend + backend pela primeira vez" — um evento que já passou. Um
checklist de evento único não protege nada depois que o evento
acontece. Estes são por **tipo de mudança**, e valem pra sempre.

### 11.A — Toquei em `web/`

- [ ] Rodei o grep da decisão 2.4 e toda linha é `NEXT_PUBLIC_*`
- [ ] Nenhuma regra de acesso depende só do frontend (princípio 1.2)
- [ ] Nenhum dado real de empresa/pessoa em mock, exemplo ou comentário

### 11.B — Criei ou alterei um endpoint

- [ ] O endpoint exige autenticação (não há exceção "temporária")
- [ ] Se recebe `:id`: chama `mustBeVisible`/`PolicyService` e prova que
      **aquele usuário** pode ver **aquele registro** (decisão 4.1)
- [ ] Registro fora do escopo responde **404**, não 403 (decisão 4.2)
- [ ] O DTO valida entrada com `class-validator`, e o `ValidationPipe`
      global (`whitelist` + `forbidNonWhitelisted`) rejeita campo não
      declarado — nunca confiar em campo vindo do cliente
- [ ] Devolve só os campos que a tela usa (decisão 9.3)
- [ ] Nenhum log imprime corpo de request/response (decisão 5.5)

### 11.C — Criei tabela, view ou function no Postgres

- [ ] Policy de RLS na **mesma** migration (decisão 3.1)
- [ ] Verifiquei o que o objeto expõe via PostgREST com a anon key
      (decisão 3.4)
- [ ] Se é `SECURITY DEFINER`: justifiquei por que precisa atravessar o
      RLS, e restringi o `GRANT` ao mínimo
- [ ] O teste de vazamento entre workspaces cobre a tabela nova

### 11.D — Adicionei uma dependência

- [ ] `npm audit` continua sem `critical` (decisão 7.1)
- [ ] O pacote é mantido e tem uso relevante (decisão 7.4)
- [ ] Se é dependência de `web/`: não arrasta segredo nem faz chamada a
      terceiro sem eu saber

### 11.E — Vou fazer deploy

- [ ] Nenhum segredo novo foi commitado
- [ ] Env vars novas foram configuradas no Railway/Vercel (e **não** no
      código)
- [ ] O CI passou de verdade — não "provavelmente passa" (princípio 1.3)

Se qualquer item falhar, a mudança espera. É o motivo deste documento
existir: é pré-requisito, não "depois eu arrumo".

---

## 12. Histórico de auditorias

Auditoria com data e sem cadência envelhece pra falsa sensação de
segurança — a versão anterior deste doc afirmava "nenhum segredo
encontrado" com base numa varredura feita quando o repositório tinha
**um único commit**.

**Cadência acordada**: reauditar a cada mudança estrutural relevante
(módulo novo, integração nova com terceiro, mudança no modelo de auth),
e no mínimo a cada 3 meses. Próxima revisão de calendário: **2026-11-12**.

**2026-07-24 — auditoria inicial.** Working tree + o único commit
existente. Nenhum segredo, chave, senha ou string de conexão vazada.
Único ponto de higiene: o ID da planilha do Google Sheets duplicado entre
`leads/cod.txt` e `leads/import_empresas.py` — não é risco, só falta de
centralização.

**2026-08-12 — auditoria completa (a que originou esta reescrita).**
Confirmado sem achados: nenhum segredo em `web/` (8 referências, todas
`NEXT_PUBLIC_`), nenhuma injeção de SQL (os `$executeRawUnsafe` de
`TenantContextService` validam UUID estrito e enum fechado antes de
interpolar), CORS restritivo com falha ruidosa, JWT recusando `HS256`,
o único `dangerouslySetInnerHTML` do projeto
(`web/app/dashboard/relatorios/page.tsx`, gráfico de rosca) monta SVG só
com números calculados e cores de um mapa fixo — sem dado de usuário.

Achados que geraram mudança:
  - **CI desarmado** (disparava em `main`, repo usa `master`) — nenhum
    teste jamais rodou automaticamente. Corrigido. Decisão 6.1.
  - **Sem varredura de dependência** — `npm audit` adicionado ao CI;
    `brace-expansion` (`high`) corrigido. Decisões 7.1 a 7.3.
  - **Autorização por objeto ausente do doc** — seção 4 criada.
  - **Cabeçalhos HTTP e rate limiting ausentes** — decisões 5.3 e 5.4.
    ✅ **Fechadas no mesmo dia** (ver adendo abaixo).
  - **Grep da decisão 2.4 furado** (não pegava destructuring) —
    corrigido.
  - **Decisões de risco só em comentário de código** (service role key
    no Storage) — promovidas pra decisão 8.3.
  - **Sem modelo de ameaça, sem resposta a incidente, sem LGPD** —
    seções 0, 10 e 9.4 criadas.

**2026-08-12 (adendo 4) — auditoria do PostgREST: 1 vulnerabilidade
real encontrada e corrigida.** A view `v_busca_empresa_lead` entregava
1176 linhas (razão social + CNPJ de toda empresa e todo lead) a qualquer
um com a chave pública, atravessando o RLS por completo — decisão 3.4.1.
Corrigida com `security_invoker`, e o acesso de `anon`/`authenticated`
ao schema `public` foi revogado por inteiro (3.4.2), fechando a
categoria em vez do caso.

Três lições metodológicas desta auditoria, mais duráveis que a correção:
  - **Comentário de código não é evidência.** O `search.service.ts`
    afirmava que a view herdava RLS. Não herdava. Nenhuma leitura de
    código pegaria — o código estava coerente com a suposição errada.
  - **Bloqueio só é prova se você souber qual camada bloqueou** (3.4.4):
    o primeiro teste deu 401 em tudo por causa de uma chave desativada,
    não por RLS. Parar ali teria produzido um laudo "está tudo seguro"
    no dia em que 1176 linhas vazavam.
  - **Auditar tem custo operacional**: os scripts saturaram o pool de
    conexões e causaram erro real em produção (decisão 6.5). Investigar
    banco de produção não é operação gratuita.

**2026-08-12 (adendo 3) — teste anti-IDOR.** Fechada a última lacuna
grande da auditoria: o cenário A do modelo de ameaça (representante
vendo o registro de outro) agora tem prova automatizada, e rota nova com
`:id` sem classificação quebra o build (decisões 4.3 e 4.4). Suíte
completa depois da mudança: **201 testes unitários + 171 e2e, tudo
verde**.

Achado de bônus, e é o mais eloquente do dia: a suíte e2e tinha **2
testes quebrados havia dois dias** (`raw-leads.e2e-spec.ts` esperava
razão social em caixa mista, mas a normalização em caixa alta de
2026-08-10 mudou o comportamento). Ninguém percebeu porque o CI
disparava numa branch que não existia (decisão 6.1). É a demonstração
prática do princípio 1.3: controle desarmado não só deixa de proteger —
ele deixa a podridão acumular em silêncio. Testes corrigidos.

**2026-08-12 (adendo 2) — rotação do `app_runtime`.** A credencial
exposta em 2026-07-28 foi rotacionada (decisão 10.2), fechando o último
risco aceito sem justificativa técnica do projeto. Procedimento e
verificação em 10.2.1. Bônus da mesma sessão: confirmado que
`SUPABASE_SERVICE_ROLE_KEY` **está** configurada no Railway — a
"pendência de infra conhecida" que o `CLAUDE.md` carregava há semanas
não existe mais.

**2026-08-12 (adendo) — implementação de 5.3 e 5.4.** Cabeçalhos de
segurança (CSP com nonce, HSTS, `nosniff`, `frame-ancestors`,
`Referrer-Policy`, `Permissions-Policy`) e rate limiting entraram no
mesmo dia da auditoria. Verificação feita: build dos dois lados, 201
testes unitários, e a CSP conferida em **Chrome headless via CDP** com
0 violações e a tela de login hidratando.

O achado mais valioso veio da implementação, não da auditoria: o rate
limit **por IP** — que é o default da biblioteca — teria derrubado o CRM
para todos os usuários ao mesmo tempo, porque nenhum componente do
frontend chama o backend direto do navegador e todo o tráfego chega dos
IPs de saída da Vercel. Está registrado em 5.4.1 e travado por teste.
Lição que vale além deste caso: **default de biblioteca de segurança
pressupõe uma arquitetura que pode não ser a sua** — neste projeto o
default parecia correto e teria causado uma queda difícil de
diagnosticar.

**2026-08-14 — reauditoria por gatilho: integração nova com terceiro
(Central de Leads do Meta).** Disparada pela regra de cadência desta
seção ("reauditar a cada mudança estrutural relevante — módulo novo,
integração nova com terceiro"), não pelo calendário. A revisão de
calendário segue marcada pra 2026-11-12.

Origem honesta do gatilho: a integração foi implementada e publicada em
2026-08-14 **sem** esta reauditoria. Ela só aconteceu porque uma
varredura de documentação, pedida pelo usuário no dia seguinte, achou
duas coisas ao mesmo tempo — a decisão 4.5 afirmando um número de rotas
públicas que tinha mudado, e o próprio gatilho desta seção não cumprido.
O checklist da skill `seguranca-web` foi rodado durante a implementação
(rota pública declarada e testada, RLS na mesma migration, nenhuma env
var em `web/`, nenhuma dependência nova), mas rodar um checklist não é a
mesma coisa que cumprir a cadência que este documento define — e a
diferença é exatamente o tipo de coisa que a reescrita de 2026-08-12 se
propôs a não deixar passar.

Verificado nesta reauditoria:
- **Grants da tabela nova**: `meta_leads_webhook_events` nasceu com
  grants só pra `app_runtime`/`postgres`/`service_role` — **sem `anon`,
  sem `authenticated`** (conferido em `information_schema.role_table_
  grants`). É a segunda confirmação de que o `ALTER DEFAULT PRIVILEGES`
  da decisão 3.4.2 protege código que ainda não foi escrito; a primeira
  foi `egestor_webhook_events`.
- **RLS**: habilitada **e forçada**, com a policy `workspace_isolation`
  (`workspace_id = app.current_workspace_id`), criada na mesma migration
  que a tabela — conferido em `pg_class`/`pg_policies` no banco de
  produção, não só no arquivo de migration.
- **Rota pública nova**: declarada em `ROTAS_PUBLICAS` do
  `test/idor.e2e-spec.ts` com três testes do controle substituto ao
  login (decisão 4.5, atualizada nesta data).
- **Segredos**: nenhuma variável `META_*` em `web/` (varredura com o
  padrão largo `process\.env\|process\[`); nenhum segredo em código,
  commit ou doc. O token da Graph API vai no header `Authorization`,
  nunca na query string.
- **Dependências**: nenhuma adicionada. `npm audit --omit=dev` rodado
  nos dois lados: os mesmos achados já registrados em 7.3 (backend:
  `uuid` moderate via `exceljs`; `web/`: 4 `high` que só somem com
  `next@16`), nenhum novo.

Achado que gerou mudança: **a lacuna era de processo, não de
implementação.** Nenhuma falha técnica foi encontrada na integração — o
que falhou foi o gatilho de reauditoria depender de alguém lembrar dele,
que é o mesmo modo de falha que a auditoria de 2026-08-12 documentou pro
checklist manual (decisão 4.5) e resolveu com a varredura automática do
`idor.e2e-spec.ts`. A varredura só cobre rota com `:id`; as do Meta não
têm, então nada teria falhado se a rota nunca tivesse sido declarada.
Registrado como dívida aberta abaixo.

**Dívida em aberto (2026-08-14)** 🔒 — a varredura de rotas do
`test/idor.e2e-spec.ts` só exige classificação de rota que contenha
`:id`. Uma rota pública **sem** parâmetro de id (como as duas do Meta)
pode nascer sem nenhum teste e sem nada falhar. Foi declarada à mão
desta vez, por disciplina, mas disciplina é exatamente o que a varredura
existe pra substituir. Correção proposta: exigir que **toda** rota
`@Public()` esteja em `ROTAS_PUBLICAS`, lendo o metadado do decorator
via `Reflector` em vez de inferir pelo formato do caminho.

**2026-08-20 — auditoria a pedido ("achar como o CRM se expõe a
invasor").** Varredura completa (rotas, segredos, RLS, dependências,
injeção/XSS, superfície HTTP), com verificação empírica assumindo o
papel do atacante no banco de produção.

Confirmado **sem** achado novo em: isolamento de dados (23 tabelas com
RLS forçada; papel `app_runtime` sem `BYPASSRLS`; a view corrigida em
3.4.1 segue com `security_invoker=true`), segredos (nada sem
`NEXT_PUBLIC_` em `web/`, nada em código/commit/doc), injeção/XSS,
cabeçalhos HTTP e CORS em produção (conferidos no ar), JWT recusando
`HS256`.

Achado que gerou mudança:
  - **Acesso sem cadastro prévio** — `TenantMembershipGuard` promovia
    qualquer JWT válido a `sales_rep` automático. Fechado: decisão 4.7,
    com `test/membership-gate.e2e-spec.ts`. Publicado no mesmo dia.
  - **Cadastro público do Supabase aberto** (`disable_signup=false`) —
    a outra metade da mesma porta. Desligado no painel (ação do usuário)
    e **verificado no servidor**: `signup` agora responde
    `signup_disabled`. Sozinho não era explorável de fora porque a chave
    pública não vaza pro navegador (3.4.3), mas depender só disso é a
    barreira única que a própria 3.4.3 avisa não bastar.

Correção de rota importante sobre o laudo inicial: a exposição de uma
conta recém-criada **não** era "a carteira comercial inteira" — a RLS
por dono (decisão 4.1/seção 3) barra empresas, leads e vendas de quem
não é dono. Um `sales_rep` de fora enxergaria a **lista de membros**
(nome/login/e-mail, via enriquecimento do `GET /memberships`) e a
estrutura do funil, além de poder criar registros. Real, mas de tamanho
diferente. A lição bate com a decisão 3.4.4: medir assumindo o papel do
atacante antes de afirmar o tamanho do vazamento.

**Pendências de configuração (não-código), a cargo do usuário:**
- 🔒 **Senha fraca permitida** no Supabase Auth — mínimo de 6 caracteres,
  sem checagem de senha vazada (HaveIBeenPwned). Baixo risco num app de
  8 logins internos; registrar como risco aceito ou ligar a proteção no
  painel (Authentication → Policies).
- ⚠️ **Dependências `high` no `web/`** (4) só somem com `next@16` — a
  mesma dívida datada em 7.3, ainda aberta.
