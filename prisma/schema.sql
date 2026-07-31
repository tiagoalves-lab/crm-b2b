-- schema.sql — snapshot completo do schema do Postgres (Supabase)
-- Gerado por concatenação das migrations do Prisma, na ordem em que
-- foram aplicadas contra o banco real (projeto rrhcibsutyralogpwkxe).
-- NAO editar este arquivo a mao — ele reflete prisma/migrations/*.
-- Para regenerar depois de uma nova migration, rode:
--   cat prisma/migrations/*/migration.sql > prisma/schema.sql
-- (a ordem lexicográfica das pastas == ordem cronológica, pelo
-- timestamp no nome de cada uma).
--
-- Gerado em: 2026-07-31T17:02:22Z

-- ═══════════════════════════════════════════════════════════════
-- Migration: 20260724120000_init_core_schema
-- ═══════════════════════════════════════════════════════════════
-- Extensão necessária para gen_random_uuid() em versões do Postgres onde
-- não é built-in no core (Supabase geralmente já tem habilitada;
-- IF NOT EXISTS torna isso idempotente e seguro de rodar de novo).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('active', 'suspended', 'trial');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'manager', 'sales_rep', 'readonly');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'invited', 'suspended');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('open', 'won', 'lost');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'done');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('note', 'call', 'email', 'stage_change', 'field_update');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'trial',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'invited',
    "manager_id" UUID,
    "invited_by" UUID,
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "owner_user_id" UUID,
    "parent_company_id" UUID,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "owner_user_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "applies_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL,
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "primary_contact_id" UUID,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expected_close_date" DATE,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'open',
    "lost_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "assignee_user_id" UUID NOT NULL,
    "company_id" UUID,
    "contact_id" UUID,
    "opportunity_id" UUID,
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "company_id" UUID,
    "contact_id" UUID,
    "opportunity_id" UUID,
    "type" "ActivityType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "memberships_workspace_id_idx" ON "memberships"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_workspace_id_user_id_key" ON "memberships"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "companies_workspace_id_idx" ON "companies"("workspace_id");

-- CreateIndex
CREATE INDEX "contacts_workspace_id_idx" ON "contacts"("workspace_id");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspace_id_email_key" ON "contacts"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "pipelines_workspace_id_idx" ON "pipelines"("workspace_id");

-- CreateIndex
CREATE INDEX "stages_pipeline_id_idx" ON "stages"("pipeline_id");

-- CreateIndex
CREATE INDEX "opportunities_workspace_id_idx" ON "opportunities"("workspace_id");

-- CreateIndex
CREATE INDEX "opportunities_company_id_idx" ON "opportunities"("company_id");

-- CreateIndex
CREATE INDEX "opportunities_stage_id_idx" ON "opportunities"("stage_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_idx" ON "tasks"("workspace_id");

-- CreateIndex
CREATE INDEX "activities_workspace_id_idx" ON "activities"("workspace_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_parent_company_id_fkey" FOREIGN KEY ("parent_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- CHECK constraints — Prisma não modela CHECK nesta versão, adicionadas
-- como SQL raw (mesmo padrão já decidido pra RLS na Fase 0).
-- ─────────────────────────────────────────────────────────────────────────

-- Task: exatamente um de company_id/contact_id/opportunity_id preenchido
-- (docs/arquitetura-dados.md, nota de design da seção "Task").
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_exactly_one_relation" CHECK (
  (CASE WHEN "company_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "contact_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "opportunity_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- Activity: mesmo padrão polimórfico do Task.
ALTER TABLE "activities" ADD CONSTRAINT "activities_exactly_one_relation" CHECK (
  (CASE WHEN "company_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "contact_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "opportunity_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- Opportunity: status = 'lost' exige lost_reason preenchido.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lost_requires_reason" CHECK (
  "status" <> 'lost' OR "lost_reason" IS NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- Row-Level Security — isolamento entre workspaces
-- (docs/arquitetura-dados.md, seção 1). `app.current_workspace_id` é
-- setado por request/transação pela aplicação (Fase 2/3) — aqui só a
-- fronteira no banco é criada. O teste crítico que prova isolamento entre
-- dois workspaces fica em test/rls-isolation.e2e-spec.ts.
--
-- `current_setting(..., true)` com missing_ok=true retorna NULL se a
-- variável de sessão não foi setada — e NULL = qualquer coisa nunca é
-- verdadeiro em SQL. Ou seja: fail-closed por padrão. Sem a variável
-- setada, nenhuma linha fica visível, em vez de vazar tudo ou lançar erro.
--
-- FORCE ROW LEVEL SECURITY garante que a policy vale até para o dono da
-- tabela (a role usada pela aplicação) — sem isso, RLS não se aplica a
-- quem criou/possui a tabela, o que na prática desativaria a proteção
-- pra qualquer conexão feita com essa role.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "memberships"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "companies"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "contacts"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "pipelines"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

-- Stage não carrega workspace_id direto (ver schema.prisma) — isolamento
-- via subquery em pipeline_id.
ALTER TABLE "stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "stages"
  USING (
    "pipeline_id" IN (
      SELECT "id" FROM "pipelines"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    "pipeline_id" IN (
      SELECT "id" FROM "pipelines"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  );

ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "opportunities"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "tasks"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "activities"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

-- "workspaces" propositalmente SEM RLS aqui: qual workspace um usuário
-- pode ver/listar é regra de aplicação (Membership + módulo de policy —
-- Fase 2/3), não um caso do padrão "workspace_id = variável de sessão"
-- usado acima — a tabela workspaces não tem workspace_id próprio, ela É
-- o tenant.


-- ═══════════════════════════════════════════════════════════════
-- Migration: 20260724120001_app_runtime_role
-- ═══════════════════════════════════════════════════════════════
-- Papel de execução da aplicação — SEM superuser e SEM BYPASSRLS.
--
-- RLS não protege nada se a conexão usar um papel que ignora RLS: todo
-- superusuário do Postgres ignora RLS por padrão, e ignora até
-- FORCE ROW LEVEL SECURITY. A connection string padrão que o Supabase
-- fornece no painel normalmente usa o papel `postgres` (superuser) —
-- perfeita para rodar migrations, mas NUNCA deve ser o que a aplicação
-- usa em runtime. Ver docs/seguranca.md.
--
-- Este migration cria o papel e concede os privilégios necessários, mas
-- PROPOSITALMENTE não define senha nem faz LOGIN — isso é feito fora do
-- controle de versão, depois de aplicar este migration:
--
--   ALTER ROLE app_runtime WITH LOGIN PASSWORD '<senha forte gerada por você>';
--
-- A connection string resultante (com esse papel, não `postgres`) vai em
-- DATABASE_URL. DIRECT_URL continua com a connection string privilegiada
-- do Supabase, usada só por `prisma migrate`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Tabelas criadas por migrations futuras também concedem automaticamente
-- pra esse papel, sem precisar lembrar de repetir o GRANT toda vez.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- ═══════════════════════════════════════════════════════════════
-- Migration: 20260724160000_add_opportunity_deleted_at
-- ═══════════════════════════════════════════════════════════════
-- Fase 3: soft delete em Opportunity, alinhando com Company/Contact
-- (docs/arquitetura-dados.md, seção 5, regra 2). Gap identificado ao
-- planejar a Fase 3 — este campo nunca tinha sido criado na Fase 1.
--
-- Sem impacto em RLS: a policy "workspace_isolation" de "opportunities"
-- filtra só por workspace_id (USING/WITH CHECK inalterados) — coluna nova
-- nullable não precisa de policy nova nem de ajuste na existente.

ALTER TABLE "opportunities" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- ═══════════════════════════════════════════════════════════════
-- Migration: 20260724170000_fix_rls_empty_string_guc
-- ═══════════════════════════════════════════════════════════════
-- Corrige um fail-closed que quebrava com erro em vez de devolver zero
-- linhas. `current_setting('app.current_workspace_id', true)` retorna
-- NULL só na primeira vez que o GUC placeholder é referenciado numa
-- conexão física; depois que qualquer transação já fez SET LOCAL nele
-- (mesmo em outra sessão lógica, sob connection pooling), o placeholder
-- passa a existir nessa conexão com reset state '' (string vazia) em vez
-- de NULL. `''::uuid` dá erro de sintaxe — a query inteira falha (500) em
-- vez de simplesmente não achar nenhuma linha.
--
-- Na aplicação real isso nunca é alcançado (TenantContextService sempre
-- seta a variável antes de qualquer query de negócio) — só afeta o teste
-- de defesa-em-profundidade (test/rls-isolation.e2e-spec.ts) e qualquer
-- código futuro que abrisse uma query sem passar pelo TenantContextService.
-- Descoberto ao crescer a suíte de testes da Fase 3 (mais transações
-- tocando a mesma pool de conexões aumentou a chance de pegar uma conexão
-- "já usada").
--
-- NULLIF(valor, '') converte string vazia em NULL antes do cast — nunca
-- erra, e workspace_id = NULL continua sempre falso (fail-closed
-- preservado).

ALTER POLICY "workspace_isolation" ON "memberships"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "companies"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "contacts"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "pipelines"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "stages"
  USING (
    "pipeline_id" IN (
      SELECT "id" FROM "pipelines"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    "pipeline_id" IN (
      SELECT "id" FROM "pipelines"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

ALTER POLICY "workspace_isolation" ON "opportunities"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "tasks"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "activities"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════
-- Migration: 20260728000000_task_kanban_checklist_comments
-- ═══════════════════════════════════════════════════════════════
-- Kanban de tarefas (colunas configuráveis, drag-and-drop) + cartão
-- completo (descrição, checklist, comentários) — pedido do usuário
-- 2026-07-28. Mesma forma de RLS que Pipeline/Stage: task_lists carrega
-- workspace_id direto (como pipelines); task_checklist_items e
-- task_comments não carregam workspace_id (como stages), isolamento via
-- subquery em task_id -> tasks.workspace_id.
--
-- Escrita manual (não gerada por `prisma migrate dev`): o shadow-database
-- diffing do Prisma pediu reset completo do banco real ao rodar
-- --create-only contra o Supabase de produção (provável falso positivo por
-- causa do RLS/CHECK adicionados via SQL raw em migrations anteriores,
-- fora do que o Prisma rastreia nativamente) — reset está fora de
-- cogitação com dado real em produção. Aplicado via `prisma migrate
-- deploy`, que não usa shadow database.

-- CreateTable
CREATE TABLE "task_lists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "is_done_list" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_lists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_lists_workspace_id_idx" ON "task_lists"("workspace_id");

ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "task_lists"
  USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);

-- AlterTable: tasks ganha list_id (coluna do Kanban), position (ordem
-- dentro da coluna) e description (corpo do cartão). list_id começa
-- nullable pra permitir o backfill abaixo antes do NOT NULL final.
ALTER TABLE "tasks" ADD COLUMN "list_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "description" TEXT;

-- Backfill: cria 3 colunas padrão ("A fazer" / "Em andamento" /
-- "Concluída", a última com is_done_list=true) pra cada workspace que já
-- tem alguma task, e associa cada task existente pelo status atual
-- (pending -> "A fazer", done -> "Concluída"). Workspaces sem task
-- nenhuma ainda não ganham lista aqui — o backend faz bootstrap
-- preguiçoso (mesmo padrão do TenantMembershipGuard) na primeira leitura
-- do Kanban.
INSERT INTO "task_lists" ("id", "workspace_id", "name", "order", "is_done_list")
SELECT gen_random_uuid(), w."workspace_id", l."name", l."order", l."is_done_list"
FROM (SELECT DISTINCT "workspace_id" FROM "tasks") w
CROSS JOIN (VALUES
  ('A fazer', 0, false),
  ('Em andamento', 1, false),
  ('Concluída', 2, true)
) AS l("name", "order", "is_done_list");

UPDATE "tasks" t
SET "list_id" = tl."id"
FROM "task_lists" tl
WHERE tl."workspace_id" = t."workspace_id"
  AND (
    (t."status" = 'done' AND tl."is_done_list" = true)
    OR (t."status" = 'pending' AND tl."order" = 0)
  );

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "list_id" ORDER BY "created_at") - 1 AS rn
  FROM "tasks"
)
UPDATE "tasks" t SET "position" = ranked.rn
FROM ranked WHERE ranked."id" = t."id";

ALTER TABLE "tasks" ALTER COLUMN "list_id" SET NOT NULL;

CREATE INDEX "tasks_list_id_idx" ON "tasks"("list_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "task_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_checklist_items_task_id_idx" ON "task_checklist_items"("task_id");

ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- task_checklist_items não carrega workspace_id (como stages) —
-- isolamento via subquery em task_id -> tasks.workspace_id.
ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_checklist_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "task_checklist_items"
  USING (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  );

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_comments_task_id_idx" ON "task_comments"("task_id");

ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "task_comments"
  USING (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- Migration: 20260728130000_drop_contacts_expand_company
-- ═══════════════════════════════════════════════════════════════
-- Decisão do usuário (2026-07-28): Contact deixa de ser entidade própria —
-- "contato" agora é atributo de Company (nome_para_contato), não uma
-- tabela separada. Task/Opportunity/Activity perdem o vínculo com uma
-- pessoa específica (só Company/Opportunity permanecem como alvo
-- polimórfico de Task/Activity). Confirmado antes desta migration: 0 linhas
-- em contacts, 0 tasks/activities com só contact_id preenchido, 0
-- opportunities com primary_contact_id — nenhuma perda de dado real.

-- ── Remover CHECK constraints que contam contact_id ─────────────────────
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_exactly_one_relation";
ALTER TABLE "activities" DROP CONSTRAINT "activities_exactly_one_relation";

-- ── Remover FKs que apontam pra contacts ─────────────────────────────────
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_primary_contact_id_fkey";
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_contact_id_fkey";
ALTER TABLE "activities" DROP CONSTRAINT "activities_contact_id_fkey";
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_company_id_fkey";
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_workspace_id_fkey";

-- ── Remover colunas que referenciavam contacts ───────────────────────────
ALTER TABLE "opportunities" DROP COLUMN "primary_contact_id";
ALTER TABLE "tasks" DROP COLUMN "contact_id";
ALTER TABLE "activities" DROP COLUMN "contact_id";

-- ── Remover a tabela contacts (RLS/policy/índices somem junto) ──────────
DROP TABLE "contacts";

-- ── Recriar os CHECK constraints sem contact_id ──────────────────────────
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_exactly_one_relation" CHECK (
  (CASE WHEN "company_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "opportunity_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

ALTER TABLE "activities" ADD CONSTRAINT "activities_exactly_one_relation" CHECK (
  (CASE WHEN "company_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "opportunity_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- ── Expandir Company: cadastro completo (PF/PJ, fiscal, endereço) ───────
-- Todos opcionais — "name" continua o único campo obrigatório na criação;
-- estes se preenchem depois, inclusive via busca por CNPJ.
CREATE TYPE "PessoaTipo" AS ENUM ('PF', 'PJ');

ALTER TABLE "companies"
  ADD COLUMN "razao_social" TEXT,
  ADD COLUMN "fantasia" TEXT,
  ADD COLUMN "nome_para_contato" TEXT,
  ADD COLUMN "cpf_cnpj" TEXT,
  ADD COLUMN "tipo" "PessoaTipo",
  ADD COLUMN "dt_nasc" DATE,
  ADD COLUMN "dt_cad" DATE,
  ADD COLUMN "emails" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "fones" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "logradouro" TEXT,
  ADD COLUMN "numero" TEXT,
  ADD COLUMN "complemento" TEXT,
  ADD COLUMN "bairro" TEXT,
  ADD COLUMN "cep" TEXT,
  ADD COLUMN "cidade" TEXT,
  ADD COLUMN "uf" CHAR(2),
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════════
-- Migration: 20260729000000_leads_and_task_attachments
-- ═══════════════════════════════════════════════════════════════
-- SPEC-CRM-GAMA.md, Fatia 1 (§3.1, §3.2, §3.5) — módulo de Leads/Triagem
-- (raw_leads) e a tabela de anexos de tarefa (task_attachments), mais a
-- view de busca unificada empresas+leads usada no seletor de oportunidade.
--
-- Escrita manual (mesmo motivo já documentado na migration
-- 20260728000000_task_kanban_checklist_comments): `prisma migrate diff`
-- pede --shadow-database-url, que este projeto não configura (mesmo
-- motivo de `migrate dev` pedir reset contra produção — RLS/CHECK raw SQL
-- fora do que o Prisma rastreia nativamente). Aplicado via `prisma migrate
-- deploy`, que não precisa de shadow database.
--
-- Nomes de FK/índice seguem a convenção que o próprio Prisma gera (não a
-- convenção `fk_*`/`idx_*` do rascunho do spec) — consistência com as 6
-- migrations anteriores deste projeto.

-- ── Enums ────────────────────────────────────────────────────────────────
CREATE TYPE "RawLeadStatus" AS ENUM ('novo', 'aprovado', 'descartado');
CREATE TYPE "LeadFonte" AS ENUM ('econodata', 'apify', 'comexstat', 'manual');

-- ── raw_leads — staging de leads brutos do crawler/import ─────────────────
CREATE TABLE "raw_leads" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"         UUID NOT NULL,
    "razao_social"         TEXT NOT NULL,
    "cnpj"                 TEXT,
    "cnae_principal"       TEXT,
    "cnae_descricao"       TEXT,
    "porte"                TEXT,
    "uf"                   CHAR(2),
    "municipio"            TEXT,
    "situacao"             TEXT,
    "importador"           BOOLEAN NOT NULL DEFAULT false,
    "fonte"                "LeadFonte" NOT NULL DEFAULT 'manual',
    "score"                INTEGER NOT NULL DEFAULT 0,
    "status"               "RawLeadStatus" NOT NULL DEFAULT 'novo',
    "promoted_company_id"  UUID,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "raw_leads_workspace_id_status_idx" ON "raw_leads"("workspace_id", "status");

ALTER TABLE "raw_leads" ADD CONSTRAINT "raw_leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "raw_leads" ADD CONSTRAINT "raw_leads_promoted_company_id_fkey" FOREIGN KEY ("promoted_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "raw_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "raw_leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "raw_leads"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

-- ── task_attachments — metadados de anexo; binário fica no Storage ───────
-- (bucket privado "task-attachments" criado fora de SQL de tabela — ver
-- fatia de anexos no frontend, §3.2 da spec).
CREATE TABLE "task_attachments" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id"       UUID NOT NULL,
    "storage_path"  TEXT NOT NULL,
    "file_name"     TEXT NOT NULL,
    "mime_type"     TEXT,
    "size_bytes"    BIGINT,
    "uploaded_by"   UUID NOT NULL,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_attachments_task_id_idx" ON "task_attachments"("task_id");

ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- task_attachments não carrega workspace_id (mesmo padrão de
-- task_checklist_items/task_comments) — isolamento via subquery em
-- task_id -> tasks.workspace_id.
ALTER TABLE "task_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "task_attachments"
  USING (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  )
  WITH CHECK (
    "task_id" IN (
      SELECT "id" FROM "tasks"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  );

-- ── v_busca_empresa_lead — busca unificada pro seletor de oportunidade ───
-- (§3.5 e §4.2.1 da spec). Herda RLS das tabelas-base (companies e
-- raw_leads já têm workspace_isolation) — a view não precisa de policy
-- própria porque nunca dá acesso a linha que a policy de base já não
-- permitiria.
CREATE OR REPLACE VIEW "v_busca_empresa_lead" AS
  SELECT
    c."id"                              AS "id",
    'empresa'::text                     AS "origem",
    COALESCE(c."razao_social", c."name") AS "nome",
    c."cpf_cnpj"                        AS "cnpj",
    c."workspace_id"                    AS "workspace_id"
  FROM "companies" c
  WHERE c."deleted_at" IS NULL
    AND NOT (c."tags" @> ARRAY['lead-triagem'])
  UNION ALL
  SELECT
    r."id"            AS "id",
    'lead'::text       AS "origem",
    r."razao_social"   AS "nome",
    r."cnpj"           AS "cnpj",
    r."workspace_id"   AS "workspace_id"
  FROM "raw_leads" r
  WHERE r."status" = 'novo';

