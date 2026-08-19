# Memorial do projeto — CRM B2B Gama Brasil

**O que é**: registro do **porquê** de escolhas que não são óbvias lendo o
código, e dos gotchas técnicos que já custaram tempo mais de uma vez.

**O que NÃO é**: diário de sessão. Não registra "o que foi feito" (o
código diz), nem contagem de testes, nem histórico de deploy. Decisão
substituída por outra é **apagada**, não arquivada.

**Como usar**: não é contexto padrão de sessão. Abra quando precisar
entender por que algo é do jeito que é, antes de mexer.

---

## Decisões de produto

**Escopo.** Ferramenta interna da Gama, workspace único (`gama`). O modelo
de dados suporta multi-tenant, mas nunca foi o objetivo. Qualquer login
válido no Supabase Auth entra no workspace automaticamente.

**Sem convite por e-mail.** Owner/admin (e gerente, desde 2026-08-06) cria
o membro já com login e senha definidos. O fluxo de convite com token foi
desenhado e descartado — não faz sentido com login automático.

**Login ≠ e-mail.** `Login` é a credencial de acesso (texto livre,
convertido internamente num e-mail sintético `@login.gamabrasil.com.br`).
`E-mail` é só contato. A capitalização digitada vive em
`user_metadata.login` — o e-mail sintético é sempre minúsculo por
exigência do Supabase.

**Contact é agenda de pessoas dentro da empresa.** Já foi tabela, virou
campo de Company, e voltou a ser tabela em 2026-08-03. Hoje é tabela
própria com `ownerUserId` e RLS por papel.

**Descartar um lead não apaga nada.** Só marca `raw_leads.status =
'descartado'`. A company-lead continua existindo, invisível (mantém a tag
`lead-triagem`).

**Company-lead nasce junto com o RawLead**, não na aprovação — com a tag
`lead-triagem`, que a tela de Empresas filtra fora. Consequência que já
virou bug: qualquer tela que resolva nome de empresa por `GET /companies`
perde o nome de uma company ainda em triagem (`GET /companies/:id` não
tem esse filtro; use ele para completar).

**Empresa duplicada por CNPJ não duplica** (2026-08-06). Dois
representantes cadastrando o mesmo CNPJ compartilham o registro: o perfil
(razão social/CNPJ/endereço) fica visível para os dois, mas histórico,
tarefas, oportunidades e contatos continuam privados de quem os criou.
Implementado com a tabela `CompanyAccess` + a function
`find_company_id_by_cnpj` (ver "Gotchas" abaixo).

**Tarefas de Ligação/Reunião/Visita/E-mail exigem contato**
(`CONTACT_REQUIRED_TASK_TYPES`, espelhado à mão no frontend). O contato
precisa pertencer à empresa da tarefa. Mesma regra vale para o registro
manual na Timeline (`CONTACT_REQUIRED_ACTIVITY_SUBTIPOS`) — lista
duplicada de propósito, porque `Activity.subtipo` é string livre e
`TaskType` é enum.

**Kanban de Tarefas não existe.** Saiu da UI em 2026-08-01 (não está no
protótipo) e as colunas foram apagadas do banco em 2026-08-04
(`task_lists`, `tasks.list_id`, `tasks.position`). Não recriar.

**"EM RECUPERAÇÃO JUDICIAL" é campo, não texto.** A Receita concatena o
aviso no fim da razão social. `sanitizeRazaoSocial()` extrai para
`emRecuperacaoJudicial` (boolean). Quem chama `lookupCnpj` recebe o texto
já limpo e repassa o flag como hint — sem o hint, uma segunda sanitização
daria falso negativo.

**Tags de importação só afetam `RawLead.tags`**, nunca `Company.tags` —
esta última carrega o marcador de sistema `lead-triagem`.

---

## Integração eGestor

Decisões de fonte da verdade estão em `docs/regras-de-negocio.md`.
Protocolo do webhook em `docs/webhook-egestor.md`. API em
`docs/api-egestor-*.md`.

**Modelo**: uma linha por CNPJ em `EgestorContatoConsolidado`, com colunas
paralelas `*Matriz`/`*Filial`. O CNPJ é a chave de consolidação — não
existe (nem deve existir) tabela de referência externa por company; o
plano original `CompanyExternalRef` foi abandonado.

**Colunas denormalizadas `nome_matriz`/`nome_filial`** são o que a lista
exibe. Todo caminho de escrita precisa atualizá-las. Isso já causou o pior
bug do módulo — ver "Gotchas".

**Só entra quem é cliente**: contato precisa ter `"cliente"` no array
`tipo` (pode ser cliente e fornecedor ao mesmo tempo; fornecedor puro fica
de fora).

**Toda empresa vinda do eGestor nasce como Cliente**, nunca passa por
lead/triagem/score — se já é cliente no ERP, não é prospecção.

**Autenticação em 2 passos**: `personal_token` (env var) trocado por
`access_token` de 15 min. Rate limit de 60 req/min.

**Cadastro do eGestor só é gravado na primeira promoção.** Depois disso o
CRM não sobrescreve mais — `promote` só ajusta tags. Assimetria conhecida,
registrada em `regras-de-negocio.md`.

**Mecanismo de eco** (`EgestorWriteEcho`, TTL 60s): a escrita do próprio
CRM no eGestor dispara o mesmo webhook de uma edição humana. Sem o eco, o
processamento automático reprocessaria a própria escrita.

**Vendas está adiada** (decisão do usuário, 2026-08-07). Quando retomar:
filtrar `tipo=50` (exclui orçamento), sem filtro por `situacaoOS`;
"cancelada" no eGestor significa cadastro errado, não devolução — como
devolução aparece na API ainda é desconhecido.

---

## Gotchas técnicos

Cada um destes já custou tempo pelo menos uma vez.

**Coluna denormalizada mente.** Validar mudança pelo dado gravado
(JSON/API) é confirmação parcial — o usuário só vê a tela. Em tabela com
campo denormalizado, checar se **todos** os caminhos de escrita atualizam
a denormalização.

**RLS retorna zero linhas silenciosamente.** Qualquer acesso ao banco
fora de `TenantContextService.run()` volta vazio, sem erro. Script
ad-hoc precisa abrir transação e setar `app.current_workspace_id`,
`app.current_user_id` e `app.current_role` na mão.

**View sem `security_invoker` ignora RLS por completo** (achado mais grave
do projeto, 2026-08-12). `v_busca_empresa_lead` rodava com o privilégio do
dono e expunha 1.176 linhas para o papel `anon`. Corrigido, e a categoria
inteira foi fechada com `REVOKE ALL` + `ALTER DEFAULT PRIVILEGES` para
`anon`/`authenticated`. O app nunca usa PostgREST — tudo passa pelo
NestJS como `app_runtime`.

**Pool do Supabase é compartilhado com produção.** Não existe banco de
teste. Script de investigação usa `DIRECT_URL` (fora do pooler), nunca
`DATABASE_URL`; e2e roda com `--runInBand`. `DATABASE_URL` tem
`?connection_limit=5` justamente por isso — sem o parâmetro o Prisma
consome as 15 conexões sozinho e produção responde `EMAXCONNSESSION`.

**Prisma não faz merge de campo JSON no `update`** — sobrescreve inteiro.
Ler o estado atual antes de salvar (`Company.customFields`). A Admin API
do Supabase tem exatamente o mesmo comportamento com `user_metadata`.

**`useState(prop)` não re-sincroniza.** Componente que guarda cópia local
de uma prop precisa de `useEffect` para acompanhar mudança vinda de fora
(ex.: edição em lote alterando a linha por fora do editor).

**Só `router.back()` fecha modal/drawer interceptado** no Next. `redirect()`
e `router.push()` não colapsam o slot `@modal`/`@drawer` — e ainda
disparam navegação, que faz a UI piscar. Server Action que precisa
atualizar sem fechar deve ser RPC (devolve `{ok, data}`) + `router.refresh()`.

**Hard-delete em teste e2e quebra o CHECK de relação polimórfica.** A FK
`ON DELETE SET NULL` zera os dois lados da `Activity` ao mesmo tempo,
violando `activities_exactly_one_relation`. Apagar a Activity antes da
Company no cleanup.

**`@ExactlyOneOf` não pega "zero campos preenchidos"** — o `class-validator`
pula o decorator quando o campo decorado está `undefined`. Sempre somar
uma checagem explícita no service.

**`overrideGuard()` não funciona** com guards registrados via `APP_GUARD`
nesta versão do Nest — usar `overrideProvider` (ver `test/utils/fake-auth.ts`).

**`jose` e `jwks-rsa` são ESM-only** e quebram sob `ts-jest` (CommonJS). A
verificação de JWT usa `jsonwebtoken` + `crypto` nativos de propósito.

**Rate limit é por usuário, não por IP.** Todo tráfego chega pelos
servidores da Vercel (Server Actions), então um limite por IP seria global
para todo mundo. `UserThrottlerGuard` chaveia pelo `sub` do JWT e precisa
resolver depois do `SupabaseAuthGuard` — por isso vive nos `providers` do
`AppModule`, não num módulo importado.

**Varredura por prefixo aprova o que não olhou.** O teste anti-IDOR
classificava rota pelo primeiro segmento do caminho e deixou passar uma
rota pública de webhook. Classificar por caminho completo.

**Variável "Sensitive" da Vercel não pode ser lida de volta.** `vercel env
pull` devolve o literal `[SENSITIVE]`. Para configurar o ambiente Preview,
pegar o valor do `.env.local` local ou pedir para o usuário adicionar pelo
painel.

**`npx` trava neste ambiente** (`ECOMPROMISED`). Usar sempre o bin local:
`node_modules/.bin/railway`, `web/node_modules/.bin/vercel`.

**Servidores em produção rodam em UTC.** Datas exibidas passam por
`format-date.ts` (`formatDateTimeBR`/`formatDateBR`/`dayKeyBR`) — sem
isso, "tarefa atrasada" e filtro de mês erram perto da virada do dia.

---

## Padrões do projeto

Coisas que se repetem e devem continuar se repetindo.

- **Sem libs novas de estado** no frontend (sem swr/react-query/
  react-hook-form/Tailwind). Server Components + Server Actions.
- **Tipos não são compartilhados** entre backend e `web/` — são dois
  projetos npm separados, espelhados à mão. Constante de regra de negócio
  duplicada nos dois lados é o padrão aceito, não um descuido.
- **404 antes de 403** em qualquer endpoint que recebe `:id` — um 403
  confirmaria a existência do registro.
- **Regra de negócio vive no service**, com CHECK constraint só como rede
  de segurança. O DTO valida forma, não regra.
- **Binário nunca passa pelo NestJS** — upload vai direto do Server Action
  para a signed URL do Supabase Storage, depois do backend confirmar o
  vínculo com o workspace.
- **Denormalizar o nome no payload da Activity** (ex.: `contatoNome`,
  `razaoSocial`) em vez de fazer JOIN em toda leitura de timeline.
- **Escrita no eGestor sempre passa por `EgestorContatoCorrectionService`**
  — botão manual e webhook usam o mesmo núcleo, com a mesma disciplina de
  eco e lock.
