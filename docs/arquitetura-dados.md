# CRM B2B Multi-tenant — Arquitetura de Dados

> Documento de contexto de arquitetura. Cobre modelo de dados, relacionamentos,
> permissões e regras de negócio. Decisões de API/interface ficam para depois
> (ver `roadmap.md`).

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

- **User** (identidade global): `id`, `email` (unique global),
  `password_hash`/auth provider, `name`, `mfa_enabled`.
- **Membership** (participação + papel): `workspace_id`, `user_id`, `role`,
  `status` (`active`, `invited`, `suspended`), `invited_by`, `joined_at`.

### Company (Account)
Organização cliente.

- Campos: `id`, `workspace_id`, `name`, `domain`, `industry`, `size`,
  `owner_user_id`, `parent_company_id` (hierarquia matriz/filial),
  `custom_fields` (jsonb).
- Regra: `owner_user_id` deve ser um Membership ativo do mesmo workspace
  (checagem de aplicação/trigger).

### Contact
Pessoa dentro de uma empresa.

- Campos: `id`, `workspace_id`, `company_id` (nullable), `name`, `email`,
  `phone`, `title`, `owner_user_id`.
- Regra: e-mail único por `workspace_id`, não globalmente. Merge de
  duplicados é operação de negócio explícita, não constraint de banco.

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

- Campos: `id`, `workspace_id`, `company_id`, `primary_contact_id`,
  `pipeline_id`, `stage_id`, `owner_user_id`, `amount`, `currency`,
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
  `contact_id` / `opportunity_id` (nullable, exatamente um preenchido via
  CHECK constraint), `title`, `due_at`, `status` (`pending`, `done`),
  `created_by`.
- Regra: "overdue" é calculado (`due_at < now() AND status = pending`), não
  persistido.

### Activity
Log de interação e trilha de auditoria — o que já aconteceu, diferente de
Task (o que precisa acontecer).

- Campos: `id`, `workspace_id`, `actor_user_id` (nullable para eventos de
  sistema/integração), `company_id` / `contact_id` / `opportunity_id`
  (mesmo padrão de Task), `type` (`note`, `call`, `email`, `stage_change`,
  `field_update`...), `payload` (jsonb), `occurred_at`.
- Regra: **append-only**. Nunca UPDATE/DELETE em fluxo normal — é a fonte de
  verdade de "quem fez o quê e quando".

> Nota de design: para as relações polimórficas de Task/Activity, preferir
> `company_id`/`contact_id`/`opportunity_id` nullable lado a lado (com CHECK
> garantindo exatamente um preenchido) em vez de `related_to_type` +
> `related_to_id` genérico. Mantém FK real do Postgres e permite índice
> parcial por tipo.

## 3. Relacionamentos

```
Workspace 1──N Membership N──1 User
Workspace 1──N Company
Workspace 1──N Pipeline 1──N Stage
Company  1──N Contact
Company  1──N Opportunity
Contact  1──N Opportunity (primary_contact, opcional)
Pipeline 1──N Opportunity
Stage    1──N Opportunity
Opportunity/Company/Contact 1──N Task
Opportunity/Company/Contact 1──N Activity
Membership(user) 1──N Company/Contact/Opportunity (owner)
```

## 4. Modelo de permissões

Duas camadas que resolvem problemas diferentes.

### a) RBAC por papel (`Membership.role`)
Papéis: `owner`, `admin`, `manager`, `sales_rep`, `readonly`. Define classes
de ação (editar pipeline, ver relatório financeiro, remover usuário, etc.).

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
2. Soft delete generalizado (`deleted_at`) em Company/Contact/Opportunity —
   nunca DELETE físico.
3. Campos customizados via `jsonb` (`custom_fields`) em vez de EAV
   relacional — indexável via GIN, validado por schema na aplicação.
4. Unicidade sempre escopada a `workspace_id`, exceto `User.email` e
   `Workspace.slug`.
5. Concorrência em mudança de stage: `updated_at`/versão otimista na
   Opportunity, para evitar sobrescrita silenciosa entre atualização manual
   (Kanban) e automações.
