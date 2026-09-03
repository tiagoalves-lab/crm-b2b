# CRM B2B Multi-tenant — Arquitetura de Dados

> Documento de contexto de arquitetura. Cobre modelo de dados, relacionamentos,
> permissões e regras de negócio. Decisões de API/interface ficam para depois
> (ver o Kanban "Roadmap CRM Gama (completo)" no Miro).

## 1. Estratégia de multi-tenancy

Decisão base que molda todo o resto do modelo.

| Estratégia | Isolamento | Custo operacional | Quando usar |
|---|---|---|---|
| Banco por tenant | Máximo | Alto (migrations, conexões, backups por tenant) | Poucos tenants enterprise, exigência regulatória forte |
| Schema por tenant | Alto | Médio | Dezenas/centenas de tenants |
| **Shared schema + `workspace_id`** | Lógico (row-level) | Baixo | Centenas a milhares de tenants, SaaS self-service |

**Decisão adotada:** shared schema com `workspace_id` em toda tabela de negócio, reforçado por:

- **Row-Level Security (RLS)** no Postgres — `workspace_id` vem de uma variável de
  sessão setada por request (`SET app.current_workspace_id`). A proteção contra
  vazamento entre tenants fica no banco, não só na aplicação.
- Todo índice composto e toda unique constraint começam por `workspace_id`
  (ex.: `(workspace_id, email)`), porque unicidade é quase sempre **por
  workspace**, não global.
- `workspace_id` nunca é nullable e nunca muda após a criação do registro.

Migração futura para banco dedicado (tenant enterprise) é possível sem mudar o
modelo — só muda o roteamento de conexão.

## 2. Entidades principais

### Workspace
Unidade de tenant. Tudo pendura nela.

- Campos: `id`, `name`, `slug`, `plan`, `status` (`active`, `suspended`,
  `trial`), `settings` (jsonb), `created_at`.
- Regra: nenhuma entidade de negócio existe sem workspace. Exclusão é
  soft-delete + purge assíncrono (nunca cascade delete síncrono).

### User vs. Membership
Identidade da pessoa é separada de participação em um workspace, porque uma
pessoa pode pertencer a múltiplos workspaces.

> **Atualizado em 2026-07-24:** identidade e autenticação passaram a ser do
> **Supabase Auth**, não mais uma tabela `User` própria com
> `password_hash`. Motivo: usuário já tem conta Supabase e preferiu
> aproveitar Auth + Postgres gerenciado do mesmo provider em vez de manter
> hash de senha/JWT por conta própria.

- **`auth.users`** (gerenciado pelo Supabase, fora do nosso schema): `id`
  (uuid), `email`, MFA, provider de login (e-mail/senha, OAuth, magic link).
  Não modelamos nem migramos essa tabela — é interna do Supabase.
- **Membership** (participação + papel, nossa tabela): `workspace_id`,
  `user_id` (FK lógica para `auth.users.id` — Postgres não permite FK
  cross-schema para o schema `auth` do Supabase por padrão, então a
  integridade é garantida na aplicação, não por constraint de banco),
  `role`, `status` (`active`, `invited`, `suspended`), `invited_by`,
  `joined_at`.
- Dados de perfil que não vivem em `auth.users` (nome de exibição, avatar,
  preferências) ficam numa tabela `Profile` própria, também referenciando
  `auth.users.id` — separada de `Membership` porque perfil é por pessoa
  (global), `Membership` é por pessoa+workspace.

### Company (Account)
Organização cliente. Cobre pessoa física e jurídica — desde 2026-07-28
absorveu os campos que antes viviam numa tabela `Contact` separada
(decisão do usuário: contato é atributo de Company, não entidade própria;
`Task`/`Opportunity`/`Activity` perderam o vínculo com uma pessoa
específica do cliente, só ligam a Company/Opportunity agora).

- Campos base: `id`, `workspace_id`, `name`, `domain`, `industry`, `size`,
  `owner_user_id`, `parent_company_id` (hierarquia matriz/filial),
  `custom_fields` (jsonb).
- Cadastro completo (ex-Contact): `razao_social`, `fantasia`,
  `nome_para_contato`, `cpf_cnpj`, `tipo` (`PF`/`PJ`), `dt_nasc`, `dt_cad`,
  `emails`/`fones`/`tags` (arrays), endereço completo (`logradouro`,
  `numero`, `complemento`, `bairro`, `cep`, `cidade`, `uf`). Todos
  opcionais — só `name` é obrigatório na criação.
- Regra: `owner_user_id` deve ser um Membership ativo do mesmo workspace
  (checagem de aplicação/trigger).

### Pipeline / Stage
Configuração, não dado transacional.

- **Pipeline**: `id`, `workspace_id`, `name`, `is_default`, `applies_to`.
- **Stage**: `id`, `pipeline_id`, `name`, `order`, `probability`, `is_won`,
  `is_lost`.
- Regras: stages têm ordem estrita; mover oportunidade "para trás" é
  permitido mas gera Activity de auditoria. `is_won`/`is_lost` são estados
  terminais — não aceitam nova mudança de stage sem reabertura explícita.

### Opportunity (Deal)
Núcleo transacional do CRM.

- Campos: `id`, `workspace_id`, `company_id`, `pipeline_id`, `stage_id`,
  `owner_user_id`, `amount`, `currency`,
  `expected_close_date`, `status` (`open`, `won`, `lost`), `lost_reason`,
  `created_at`, `closed_at`.
- Regras:
  - `stage_id` deve pertencer ao mesmo `pipeline_id` da oportunidade.
  - Toda transição de stage gera Activity (`stage_change`) — alimenta
    relatórios de velocity/funil.
  - `status = lost` exige `lost_reason`.
  - Multi-moeda: guardar a moeda da transação e converter para moeda-base
    apenas em relatórios (nunca substituir o valor original).

### Task
Ação futura, acionável.

- Campos: `id`, `workspace_id`, `assignee_user_id`, `company_id` /
  `opportunity_id` (nullable, exatamente um preenchido via CHECK
  constraint), `title`, `due_at`, `status` (`pending`, `done`),
  `created_by`.
- Regra: "overdue" é calculado (`due_at < now() AND status = pending`), não
  persistido.

### Activity
Log de interação e trilha de auditoria — o que já aconteceu, diferente de
Task (o que precisa acontecer).

- Campos: `id`, `workspace_id`, `actor_user_id` (nullable para eventos de
  sistema/integração), `company_id` / `opportunity_id` (mesmo padrão de
  Task), `type` (`note`, `call`, `email`, `stage_change`,
  `field_update`...), `payload` (jsonb), `occurred_at`.
- Regra: **append-only**. Nunca UPDATE/DELETE em fluxo normal — é a fonte de
  verdade de "quem fez o quê e quando".

> Nota de design: para as relações polimórficas de Task/Activity, preferir
> `company_id`/`opportunity_id` nullable lado a lado (com CHECK garantindo
> exatamente um preenchido) em vez de `related_to_type` + `related_to_id`
> genérico. Mantém FK real do Postgres e permite índice parcial por tipo.

## 3. Relacionamentos

```
Workspace 1──N Membership N──1 User
Workspace 1──N Company
Workspace 1──N Pipeline 1──N Stage
Company  1──N Opportunity
Pipeline 1──N Opportunity
Stage    1──N Opportunity
Opportunity/Company 1──N Task
Opportunity/Company 1──N Activity
Membership(user) 1──N Company/Opportunity (owner)
```

## 4. Modelo de permissões

Duas camadas que resolvem problemas diferentes.

### a) RBAC por papel (`Membership.role`)
Papéis: `owner`, `admin`, `manager`, `sales_rep`, `readonly`. Define classes
de ação (editar pipeline, ver relatório financeiro, remover usuário, etc.).

**Hierarquia de níveis** (fechada com o usuário, 2026-08-13) — usada como
referência sempre que uma regra precisar falar em "nível" em vez do nome do
papel:

- Nível 1 — `owner`
- Nível 2 — `admin`
- Nível 3 — `manager` (Gerente)
- Nível 4 — `sales_rep` (Representante)

`readonly` fica fora dessa escala — é uma variante "só leitura" ortogonal
aos níveis acima (mesmo escopo de visibilidade do nível 4, sem edição),
não um 5º nível.

Regra específica de Empresas (S9.x, ver `PolicyService.companyReadFilter()`
/`canReadCompany()` — uma regra só, usada pela lista, pela ficha e pela
Timeline/nota da empresa): níveis 1–3 (owner/admin/manager) enxergam
**todas** as empresas do workspace sem filtro; a lógica antiga de
ownership/hierarquia de time (dono direto, oportunidade própria na
empresa, ou `CompanyAccess` concedido) vale só pro nível 4
(`sales_rep`/`readonly`). Antes dessa mudança, `manager` via só a própria
carteira + subordinados, igual a `sales_rep` — o restante dos módulos
(oportunidades, tarefas, leads, contatos) **não** mudou, `manager`
continua restrito à própria equipe neles via `PolicyService.scopeFilter()`.

### b) Record-level / ownership
RBAC sozinho não resolve "sales_rep só vê os próprios deals, manager vê os
do time". Combina:

- `owner_user_id` no registro,
- hierarquia opcional de time (`Team`, `manager_id` em Membership),
- função de policy centralizada: `can(user, action, resource) → bool`.

```
pode_ver_oportunidade(user, opp):
  role = membership.role
  if role in (owner, admin): true
  if role == manager: opp.owner in subordinados(user)
  if role == sales_rep: opp.owner_user_id == user.id
  if role == readonly: leitura conforme mesma regra, sem edição
```

Centralizar essa policy em um único módulo de autorização (não espalhar por
endpoint) — aplicada idealmente tanto na API quanto via RLS no banco.

### c) Ciclo de vida de Membership
- Convite gera `Membership.status = invited` + token de aceite com
  expiração.
- Remoção nunca é DELETE físico — `status = suspended`. Registros que o
  usuário possuía (`owner_user_id`) exigem reatribuição obrigatória
  ("transferir carteira") antes/durante a suspensão, para não gerar
  registros órfãos.

## 5. Regras de negócio transversais

1. Toda escrita relevante gera Activity — sem isso, histórico de
   forecast/funil fica impossível de reconstruir depois.
2. Soft delete generalizado (`deleted_at`) em Company/Opportunity — nunca
   DELETE físico.
3. Campos customizados via `jsonb` (`custom_fields`) em vez de EAV
   relacional — indexável via GIN, validado por schema na aplicação.
4. Unicidade sempre escopada a `workspace_id`, exceto `auth.users.email`
   (unicidade garantida pelo próprio Supabase Auth) e `Workspace.slug`.
5. Concorrência em mudança de stage: `updated_at`/versão otimista na
   Opportunity, para evitar sobrescrita silenciosa entre atualização manual
   (Kanban) e automações.
