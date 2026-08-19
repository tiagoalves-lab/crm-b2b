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

-- Fase 3: soft delete em Opportunity, alinhando com Company/Contact
-- (docs/arquitetura-dados.md, seção 5, regra 2). Gap identificado ao
-- planejar a Fase 3 — este campo nunca tinha sido criado na Fase 1.
--
-- Sem impacto em RLS: a policy "workspace_isolation" de "opportunities"
-- filtra só por workspace_id (USING/WITH CHECK inalterados) — coluna nova
-- nullable não precisa de policy nova nem de ajuste na existente.

ALTER TABLE "opportunities" ADD COLUMN "deleted_at" TIMESTAMP(3);

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

-- SPEC-CRM-GAMA.md §7.5 — RLS por papel (Admin vê tudo do workspace,
-- Operador vê só o que é dele) em opportunities/tasks/companies. Camada
-- separada do isolamento por workspace_id (que já existia e continua) —
-- app.current_user_id/app.current_role já são injetados pelo
-- TenantContextService desde a migration anterior a esta (mesmo ponto
-- que injeta app.current_workspace_id).
--
-- Pré-requisito não-negociável (spec): as policies só entram DEPOIS do
-- app já injetar os dois settings — checado manualmente antes de aplicar
-- esta migration (rodar a suíte e2e inteira sem policy de papel primeiro).
--
-- DESVIO DELIBERADO do SQL literal do spec: o rascunho do §7.5 propõe
-- "ws_write ... FOR ALL" ao lado de "ws_and_role_select ... FOR SELECT".
-- Isso não funciona — policies permissivas do Postgres se combinam com
-- OR por comando, e FOR ALL cobre SELECT também. Um "ws_write FOR ALL"
-- que só verifica workspace_id (sem checar papel/posse) faria SELECT
-- enxergar o workspace inteiro de novo pra QUALQUER operador, anulando
-- a policy de leitura restrita. Corrigido aqui separando escrita em
-- INSERT/UPDATE/DELETE explícitos (sem cobrir SELECT), mantendo a
-- intenção do spec (escrita segue só workspace-scoped, leitura é que
-- ganha o filtro de papel).

-- ================= OPORTUNIDADES =================
DROP POLICY IF EXISTS "workspace_isolation" ON "opportunities";

CREATE POLICY "ws_and_role_select" ON "opportunities" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "opportunities" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "opportunities" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "opportunities" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ================= TAREFAS =================
DROP POLICY IF EXISTS "workspace_isolation" ON "tasks";

CREATE POLICY "ws_and_role_select" ON "tasks" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "tasks" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "tasks" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "tasks" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ================= EMPRESAS =================
-- Operador só vê company que tem ao menos uma opportunity dele — leads em
-- triagem (tag lead-triagem) não têm opportunity nenhuma ainda, então
-- ficam invisíveis pra operador por esta policy até virarem oportunidade;
-- a tela de Leads não passa por "companies", lê raw_leads direto (sem
-- policy de papel — área comum, ver nota no fim deste arquivo), então
-- não é afetada.
DROP POLICY IF EXISTS "workspace_isolation" ON "companies";

CREATE POLICY "ws_and_role_select" ON "companies" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "id" IN (
        SELECT "company_id" FROM "opportunities"
        WHERE "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

CREATE POLICY "ws_insert" ON "companies" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "companies" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "companies" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ================= LEADS (raw_leads) — SEM MUDANÇA =================
-- Confirmado explicitamente pelo spec (§7.5): raw_leads NÃO recebe
-- policy de papel — permanece com o workspace_isolation puro (todos do
-- workspace veem), a triagem é área comum. Nenhuma alteração aqui —
-- comentário só documenta a decisão de propósito, pra quem ler esta
-- migration não achar que foi esquecido.

-- Corrige um bug real descoberto rodando a suíte e2e inteira depois de
-- 20260731200000_role_based_rls_policies: toda escrita via Prisma usa
-- RETURNING (é como .create()/.update() devolvem o objeto criado), e o
-- Postgres exige que a linha devolvida também satisfaça a policy de
-- SELECT da tabela — não só o WITH CHECK do INSERT/UPDATE. Se a policy
-- de SELECT não cobrir a linha recém-escrita, o comando inteiro falha
-- com "new row violates row-level security policy" (SQLSTATE 42501),
-- mesmo que o WITH CHECK tivesse aprovado a escrita.
--
-- companies: a policy anterior só considerava "empresa vinculada a uma
-- oportunidade do operador" (texto literal do spec §7.5). Mas Company
-- também tem seu próprio owner_user_id (usado pelo PolicyService da
-- Fase 2 desde sempre, companies/company.service.ts) e é perfeitamente
-- normal cadastrar uma empresa ANTES de qualquer oportunidade existir
-- (a tela Empresas inteira funciona assim). Sem essa OR, o INSERT de
-- CompanyController#create feito por um sales_rep falhava sempre.
DROP POLICY IF EXISTS "ws_and_role_select" ON "companies";
CREATE POLICY "ws_and_role_select" ON "companies" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "id" IN (
        SELECT "company_id" FROM "opportunities"
        WHERE "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

-- tasks: TaskService.create() aceita assigneeUserId explícito diferente
-- de quem está criando (ex.: reatribuir na tela de detalhe, ver
-- web/app/dashboard/tarefas/task-detail.tsx, campo "Responsável") — se
-- quem criou/editou não for o novo assignee nem admin/owner, o mesmo
-- problema de RETURNING acontece. Adiciona created_by como caminho
-- alternativo de visibilidade (quem criou sempre pode ver o que criou).
DROP POLICY IF EXISTS "ws_and_role_select" ON "tasks";
CREATE POLICY "ws_and_role_select" ON "tasks" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "created_by" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- opportunities: NÃO alterada — OpportunityService.create() sempre fixa
-- ownerUserId = quem está criando por padrão (nenhum caminho do
-- frontend hoje permite setar dono diferente na criação), então o
-- owner_user_id da linha sempre bate com app.current_user_id de quem
-- fez o INSERT. Sem o mesmo problema de RETURNING.

-- SPEC-CRM-GAMA.md §7.5 é explícito: "Os papéis manager e readonly ficam
-- previstos no enum mas NÃO são usados nesta rodada (só Admin e
-- Operador)." Implementar a hierarquia de manager em RLS puro (SQL)
-- exigiria replicar PolicyService.getSubordinateUserIds() como subquery
-- recursiva — fora do escopo desta rodada por decisão explícita do spec.
--
-- Sem este ajuste, um Membership com role='manager' ficava mais restrito
-- no banco (RLS não sabe nada sobre subordinados) do que na aplicação
-- (PolicyService já resolve a hierarquia corretamente desde a Fase 2,
-- coberto por test/authz.e2e-spec.ts) — uma regressão real de RLS sendo
-- MAIS restritivo que o app, não menos, mas ainda assim quebra um papel
-- que já funcionava. Adicionar "manager" ao bypass de papel faz a RLS
-- voltar a ser um no-op pra esse papel (mesmo comportamento de antes
-- desta fatia), deixando o PolicyService como único ponto de decisão
-- pra manager — igual está documentado que deveria ficar por ora.
DROP POLICY IF EXISTS "ws_and_role_select" ON "companies";
CREATE POLICY "ws_and_role_select" ON "companies" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "id" IN (
        SELECT "company_id" FROM "opportunities"
        WHERE "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

DROP POLICY IF EXISTS "ws_and_role_select" ON "opportunities";
CREATE POLICY "ws_and_role_select" ON "opportunities" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS "ws_and_role_select" ON "tasks";
CREATE POLICY "ws_and_role_select" ON "tasks" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "created_by" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- Decisão do usuário (2026-08-01): "name" era o único campo obrigatório
-- de Company desde sempre, mas ficou redundante depois que razão
-- social/fantasia passaram a existir (2026-07-28) — toda empresa
-- cadastrada por CNPJ preenche razão social automaticamente, e o
-- formulário seguia exigindo "Nome" à parte, gerando erro de validação
-- depois de uma busca de CNPJ (nenhum desses dois campos preenche
-- "name"). Removido de vez: exibição em toda a UI passa a derivar de
-- fantasia/razão social/nome pra contato na hora (ver
-- web/lib/api/companies.ts#companyDisplayName), não é mais coluna
-- própria.

-- ── Preserva dado existente. Descoberto ao investigar antes de rodar
-- (query manual contra o workspace "gama" real): não são só as ~4
-- empresas de exemplo — o workspace tem 250+ empresas reais, e na
-- maioria delas "name" é um apelido/nome fantasia curto DIFERENTE da
-- razão social já preenchida (ex.: name="COFELMA", razao_social=
-- "METALURGICA COFELMA LTDA") — provavelmente uma carga em lote feita
-- direto no banco, sem passar pelo formulário/busca de CNPJ que
-- preencheria "fantasia". A ordem de prioridade de companyDisplayName é
-- fantasia > razão social > nome pra contato — sem este primeiro UPDATE,
-- "fantasia" ficaria NULL pra quase todas e a exibição trocaria o
-- apelido curto pela razão social inteira em toda tela (Empresas,
-- Pipeline, Tarefas, seletor de empresa) pra 250+ registros reais.
-- Preenche fantasia com o valor antigo de "name" sempre que fantasia
-- ainda está vazia — reproduz exatamente o texto que já era exibido,
-- mesmo quando name == razao_social (não faz mal duplicar).
UPDATE "companies" SET "fantasia" = "name" WHERE "fantasia" IS NULL;

-- Cobre o caso inverso, raro mas possível (registro só com "name",
-- razão social nunca preenchida) — não é o caso comum deste workspace,
-- mas mantém company.razaoSocial como fallback de exibição funcionando
-- em qualquer registro futuro nessa situação.
UPDATE "companies" SET "razao_social" = "name" WHERE "razao_social" IS NULL;

-- ── v_busca_empresa_lead depende da coluna "name" — precisa parar de
-- referenciá-la ANTES do DROP COLUMN, senão o Postgres recusa
-- ("cannot drop column name ... other objects depend on it"). Mesma
-- ordem de prioridade do helper companyDisplayName do frontend
-- (fantasia > razão social > nome pra contato), com um fallback final
-- literal só pra nunca devolver NULL na coluna "nome" da view.
CREATE OR REPLACE VIEW "v_busca_empresa_lead" AS
  SELECT
    c."id"                              AS "id",
    'empresa'::text                     AS "origem",
    COALESCE(c."fantasia", c."razao_social", c."nome_para_contato", 'Empresa sem nome') AS "nome",
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

ALTER TABLE "companies" DROP COLUMN "name";

-- SalesHistory (sales_history) — histórico de vendas importado de sistema
-- externo (eGestor), a pedido do usuário (2026-08-01): as 100 empresas
-- importadas anteriormente já tinham a tag "cliente" corretamente, mas o
-- selo Lead/Cliente e o LTV da tela Empresas são calculados só a partir de
-- Opportunity "ganha" — como o import anterior não criou Opportunity
-- nenhuma, todas apareciam como "Lead" mesmo sendo clientes reais.
--
-- Decisão do usuário: não fabricar Opportunity pra fechar essa conta —
-- oportunidades no pipeline continuam vindo só do funil de vendas de
-- verdade. Este histórico de vendas fica numa tabela própria, sem dono
-- (ownerUserId não se aplica), só pra alimentar LTV/última compra/selo
-- Cliente.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TABLE "sales_history" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id"   UUID NOT NULL,
    "cod_venda"    TEXT,
    "dt_venda"     DATE NOT NULL,
    "valor_total"  DECIMAL(14,2) NOT NULL,
    "situacao_os"  TEXT,
    "fonte"        TEXT NOT NULL DEFAULT 'egestor',
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_history_workspace_id_idx" ON "sales_history"("workspace_id");
CREATE INDEX "sales_history_company_id_idx" ON "sales_history"("company_id");

ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sem conceito de dono/papel (histórico só-leitura pro workspace inteiro,
-- mesmo padrão de raw_leads: "área comum", sem policy de papel).
ALTER TABLE "sales_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "sales_history"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

-- Feature nova, fora do SPEC-CRM-GAMA.md original (pedida à parte): chat
-- de comentários e anexos de arquivo no card de Oportunidade (Pipeline),
-- estilo Trello. Mirror direto de task_comments/task_attachments
-- (20260728000000_task_kanban_checklist_comments,
-- 20260729000000_leads_and_task_attachments) — mesma estrutura, mesmo
-- padrão de RLS por subquery.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

-- ── opportunity_comments ───────────────────────────────────────────────
CREATE TABLE "opportunity_comments" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body"           TEXT NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "opportunity_comments_opportunity_id_idx" ON "opportunity_comments"("opportunity_id");

ALTER TABLE "opportunity_comments" ADD CONSTRAINT "opportunity_comments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- opportunity_comments não carrega workspace_id (mesmo padrão de
-- task_comments) — isolamento via subquery em opportunity_id ->
-- opportunities.workspace_id. Não replica a policy por papel que
-- `opportunities` tem: visibilidade por papel já é garantida no service
-- layer via OpportunityService.mustBeVisible -> PolicyService.can, mesmo
-- raciocínio já documentado pra task_comments/task_attachments.
ALTER TABLE "opportunity_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "opportunity_comments"
  USING (
    "opportunity_id" IN (
      SELECT "id" FROM "opportunities"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  )
  WITH CHECK (
    "opportunity_id" IN (
      SELECT "id" FROM "opportunities"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  );

-- ── opportunity_attachments — metadados; binário fica no Storage ────────
-- Reaproveita o bucket privado "task-attachments" já existente, com
-- prefixo de path "opportunities/" — não precisa de bucket novo nem de
-- policy de storage.objects (a fronteira de segurança é o backend, ver
-- SupabaseStorageService).
CREATE TABLE "opportunity_attachments" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "storage_path"   TEXT NOT NULL,
    "file_name"      TEXT NOT NULL,
    "mime_type"      TEXT,
    "size_bytes"     BIGINT,
    "uploaded_by"    UUID NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "opportunity_attachments_opportunity_id_idx" ON "opportunity_attachments"("opportunity_id");

ALTER TABLE "opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opportunity_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "opportunity_attachments"
  USING (
    "opportunity_id" IN (
      SELECT "id" FROM "opportunities"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  )
  WITH CHECK (
    "opportunity_id" IN (
      SELECT "id" FROM "opportunities"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  );

-- Classificação manual de leads (Quente/Morno/Frio) — pedido direto do
-- usuário, fora do SPEC-CRM-GAMA.md original. `manual_tier` sobrepõe o
-- tier calculado por LeadScoringService#tier a partir do score quando
-- preenchido; NULL (default) mantém o comportamento automático de sempre.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores
-- deste projeto: `prisma migrate diff` exige --shadow-database-url, não
-- configurado aqui). Aplicado via `prisma migrate deploy`.

CREATE TYPE "LeadTier" AS ENUM ('quente', 'morno', 'frio');

ALTER TABLE "raw_leads" ADD COLUMN "manual_tier" "LeadTier";

-- Feature nova, fora do SPEC-CRM-GAMA.md original (pedida à parte): agenda
-- de contatos (pessoas) de uma empresa, editável na ficha de Empresas e
-- reaproveitada na ficha de Leads (todo RawLead já nasce com
-- promoted_company_id apontando pra uma Company — ver comentário em
-- RawLead no schema —, então a ficha de Leads só reusa companyId, sem FK
-- própria em raw_leads).
--
-- Não é o mesmo Contact removido em 20260728130000_drop_contacts_expand_company
-- (aquele era "dono do cadastro" PF/PJ, virou campos de Company); este é
-- uma lista de pessoas dentro da empresa, 0..N por company.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TABLE "contacts" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id"   UUID NOT NULL,
    "nome"         TEXT NOT NULL,
    "cargo"        TEXT,
    "email"        TEXT,
    "telefone"     TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contacts_workspace_id_company_id_idx" ON "contacts"("workspace_id", "company_id");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS por subquery em company_id -> companies.workspace_id, mesmo padrão
-- de opportunity_comments/opportunity_attachments
-- (20260802000000_opportunity_attachments_comments): não replica a policy
-- de papel de "companies" (ws_and_role_select, Fatia 9) explicitamente
-- aqui, mas herda o mesmo filtro por papel de qualquer jeito — o
-- subselect roda contra a própria tabela "companies", então o Postgres
-- aplica a RLS dela (incluindo o filtro por owner_user_id/role) antes de
-- devolver as linhas pro IN (...). Um operador que não enxerga a company
-- pela policy dela também não enxerga os contacts dela por tabela.
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "contacts"
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  )
  WITH CHECK (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  );

-- Pedido do usuário (2026-08-03), fora do SPEC-CRM-GAMA.md original:
-- checkbox "tomador de decisão" no cadastro de contato.
ALTER TABLE "contacts" ADD COLUMN "decisor" BOOLEAN NOT NULL DEFAULT false;

-- Coluna "Tipo" na tela de Tarefas (pedido direto do usuário, fora do
-- SPEC-CRM-GAMA.md original) — mesmos 5 tipos de openTaskForm() no
-- protótipo (gama-crm-mvp.html): ligação, e-mail, visita, proposta,
-- follow-up. Opcional (sem default) porque tarefas já existentes não têm
-- como inferir um tipo real — ficam com "—" na UI até serem editadas,
-- mesmo padrão já usado em Company.tipo (PessoaTipo?).
--
-- Escrita manual (sem shadow database configurado neste projeto).
-- Aplicado via `npm run prisma:migrate:deploy`.

CREATE TYPE "TaskType" AS ENUM ('ligacao', 'email', 'visita', 'proposta', 'followup');

ALTER TABLE "tasks" ADD COLUMN "tipo" "TaskType";

-- Combobox de contato obrigatório pra tarefas de Ligação/Reunião/Visita
-- (pedido direto do usuário) + novo tipo "Reunião" (o usuário citou esse
-- tipo de novo depois da sessão anterior ter fechado só nos 5 do
-- protótipo — confirmado via pergunta direta que agora é pra virar um
-- 6º valor de verdade, não um lapso).
--
-- ADD VALUE de enum não pode ser usado na mesma transação em que o valor
-- novo é referenciado, mas não é o caso aqui (só adiciona, não usa) —
-- seguro dentro da transação que `prisma migrate deploy` abre por
-- migration. Escrita manual (sem shadow database configurado neste
-- projeto). Aplicado via `npm run prisma:migrate:deploy`.

ALTER TYPE "TaskType" ADD VALUE 'reuniao';

ALTER TABLE "tasks" ADD COLUMN "contact_id" UUID REFERENCES "contacts"("id");

-- Remove o Kanban de Tarefas por completo (schema + dado) — pedido
-- direto do usuário: "isso não vai ser usado". A UI do Kanban já tinha
-- sido removida em 2026-08-01 (ver CLAUDE.md), mas a coluna
-- `tasks.list_id` (NOT NULL) e a tabela `task_lists` continuavam
-- existindo por baixo só pra Task sempre ter uma coluna válida — sem
-- nenhuma tela gerenciando isso, virou peso morto. `status`
-- (pending/done) já é controlado direto por completeTaskAction/
-- reopenTaskAction, nunca dependeu de list_id na prática de UI.
--
-- `position` (fractional indexing pra ordenar dentro de uma coluna)
-- também sai — sem list_id não existe mais "dentro de uma coluna" pra
-- ordenar.
--
-- Escrita manual (sem shadow database configurado neste projeto).
-- Aplicado via `npm run prisma:migrate:deploy`.

ALTER TABLE "tasks" DROP CONSTRAINT "tasks_list_id_fkey";
DROP INDEX "tasks_list_id_idx";
ALTER TABLE "tasks" DROP COLUMN "list_id";
ALTER TABLE "tasks" DROP COLUMN "position";

DROP TABLE "task_lists";

-- Tags livres na Prospecção (raw_leads) — pedido direto do usuário, fora
-- do SPEC-CRM-GAMA.md original. Texto livre (sem lista fixa), editável na
-- lista e na ficha do lead; também vira filtro na tela de Prospecção.
--
-- Coluna própria em raw_leads (não reaproveita companies.tags): aquela
-- coluna já carrega o marcador de sistema "lead-triagem" usado pra
-- esconder a company da tela de Empresas até o lead ser aprovado — se uma
-- tag de usuário fosse guardada ali, RawLeadService#approve (que só
-- remove "lead-triagem" de companies.tags) a preservaria de qualquer
-- jeito, mas misturar as duas coisas na mesma coluna exigiria filtrar
-- "lead-triagem" toda vez que a UI listasse/editasse tags de usuário — a
-- coluna própria evita essa armadilha e mantém as duas listas
-- independentes desde o início.
--
-- Escrita manual (mesmo motivo de sempre neste projeto: `prisma migrate
-- diff` exige --shadow-database-url, não configurado aqui). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "raw_leads" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- Segmento de negócio na Prospecção (raw_leads) — pedido direto do
-- usuário, fora do SPEC-CRM-GAMA.md original, mesmo dia da migration de
-- tags (20260805130000_raw_lead_tags). Diferente de tags: valor único por
-- lead (confirmado via pergunta direta ao usuário — "um segmento por
-- vez"), texto livre, sem lista pré-definida.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "raw_leads" ADD COLUMN "segmento" TEXT;

-- Contato vinculado ao registro manual da Timeline (activities) — pedido
-- direto do usuário, 2026-08-05, fora do SPEC-CRM-GAMA.md original.
-- Obrigatório (checado em ActivityService, não aqui) quando
-- payload->>'subtipo' é ligação/reunião/visita/e-mail — mesma regra já
-- aplicada em tasks.contact_id (task_contact_reuniao). Sem
-- ON DELETE CASCADE por padrão do Postgres: não é óbvio o que fazer com o
-- registro histórico se o contato for removido depois, então bloqueia em
-- vez de apagar/desvincular silenciosamente.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "activities" ADD COLUMN "contact_id" UUID REFERENCES "contacts"("id");

-- Indicativo "EM RECUPERAÇÃO JUDICIAL" da Receita Federal, extraído da
-- razão social pra um campo próprio (pedido direto do usuário,
-- 2026-08-05) — ver src/common/sanitize-razao-social.ts. Sem isso o
-- aviso passava despercebido dentro do texto corrido do nome da empresa
-- em qualquer tela/lista/proposta comercial.
--
-- Backfill: dado real já importado (149 empresas do crawler CNPJ, mais
-- qualquer empresa cadastrada por busca de CNPJ) pode já ter esse
-- indicativo dentro do razao_social/razaoSocial existente — a migration
-- também limpa quem já está no banco, não só o que entrar daqui pra
-- frente.

ALTER TABLE "companies" ADD COLUMN "em_recuperacao_judicial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "raw_leads" ADD COLUMN "em_recuperacao_judicial" BOOLEAN NOT NULL DEFAULT false;

UPDATE "companies"
SET "em_recuperacao_judicial" = true,
    "razao_social" = trim(regexp_replace(
      "razao_social",
      '[\s,;:()-]*EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL\)?[\s,;:()-]*$',
      '',
      'i'
    ))
WHERE "razao_social" ~* 'EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL';

UPDATE "raw_leads"
SET "em_recuperacao_judicial" = true,
    "razao_social" = trim(regexp_replace(
      "razao_social",
      '[\s,;:()-]*EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL\)?[\s,;:()-]*$',
      '',
      'i'
    ))
WHERE "razao_social" ~* 'EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL';

-- "Carteira" por representante na Prospecção (pedido direto do usuário,
-- 2026-08-06, reportado como bug real: um sales_rep — Lauro — estava
-- enxergando leads/empresas importadas por outro membro — Arlei, gerente).
-- Reverte a decisão explícita do SPEC-CRM-GAMA.md §7.5 de que raw_leads é
-- "área comum" sem policy de papel (ver comentário no fim de
-- 20260731200000_role_based_rls_policies/migration.sql) — o usuário quer
-- exatamente o oposto agora: cada representante só vê o que ele mesmo
-- importou/cadastrou; gerente vê o próprio + o dos subordinados (mesma
-- hierarquia já usada em companies/opportunities/tasks); admin/owner veem
-- tudo.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "raw_leads" ADD COLUMN "owner_user_id" UUID;
CREATE INDEX "raw_leads_workspace_id_owner_user_id_idx" ON "raw_leads"("workspace_id", "owner_user_id");

-- Troca a policy única "workspace_isolation" (FOR ALL) por leitura
-- restrita + escrita workspace-scoped — mesmo padrão exato de
-- companies/opportunities/tasks (20260731200000 + 20260731220000
-- combinadas aqui numa só, já incluindo manager no bypass desde o
-- início, sem precisar de uma segunda migration de correção depois).
DROP POLICY IF EXISTS "workspace_isolation" ON "raw_leads";

CREATE POLICY "ws_and_role_select" ON "raw_leads" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "raw_leads" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "raw_leads" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "raw_leads" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- Empresa cadastrada em duplicidade por dois representantes diferentes
-- (pedido direto do usuário, 2026-08-06 — exemplo dado: Lauro cadastra
-- "Empresa Modelo", depois Darlã também cadastra a mesma empresa).
-- Decisão confirmada com o usuário: NÃO duplica o registro — reaproveita
-- a mesma Company — e o PERFIL da empresa (razão social/CNPJ/endereço)
-- passa a ser visível pros dois; histórico (activities), tarefas e
-- oportunidades continuam privados de quem os criou (já eram, por
-- ownerUserId/assigneeUserId/actorUserId — nenhuma mudança necessária
-- nessas 3 tabelas). Contatos também ficam vinculados a quem os
-- cadastrou (2ª rodada da mesma pergunta) — antes eram "livres" pra
-- qualquer um que visse a empresa.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

-- ═══════════════════ contacts — dono do registro ═══════════════════
ALTER TABLE "contacts" ADD COLUMN "owner_user_id" UUID;
CREATE INDEX "contacts_workspace_id_owner_user_id_idx" ON "contacts"("workspace_id", "owner_user_id");

DROP POLICY IF EXISTS "workspace_isolation" ON "contacts";

CREATE POLICY "ws_and_role_select" ON "contacts" FOR SELECT
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "contacts" FOR INSERT
  WITH CHECK (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_update" ON "contacts" FOR UPDATE
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_delete" ON "contacts" FOR DELETE
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

-- ═══════════════════ company_access — 2º+ representante ═══════════════════
-- Uma linha por (company, user) que também "trabalha" essa empresa além
-- do owner_user_id original — nunca exposta como endpoint próprio, só
-- lida internamente por CompanyService pra decidir visibilidade (ver
-- policy abaixo em companies e o app-layer em company.service.ts).
CREATE TABLE "company_access" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id"   UUID NOT NULL,
    "user_id"      UUID NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_access_company_id_user_id_key" ON "company_access"("company_id", "user_id");
CREATE INDEX "company_access_workspace_id_idx" ON "company_access"("workspace_id");

ALTER TABLE "company_access" ADD CONSTRAINT "company_access_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sem dado sensível na linha em si (só 3 uuids) — workspace_isolation
-- simples basta, mesmo padrão pré-Fatia9 usado nas outras tabelas antes
-- de ganharem RLS por papel.
ALTER TABLE "company_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_access" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "company_access"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ═══════════════════ companies — estende a policy de leitura ═══════════════════
DROP POLICY IF EXISTS "ws_and_role_select" ON "companies";
CREATE POLICY "ws_and_role_select" ON "companies" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "id" IN (
        SELECT "company_id" FROM "opportunities"
        WHERE "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
      OR "id" IN (
        SELECT "company_id" FROM "company_access"
        WHERE "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

-- ═══════════════════ find_company_id_by_cnpj — checagem de duplicidade ═══════════════════
-- CompanyService#create precisa saber se um CNPJ já existe no workspace
-- ANTES de decidir se insere ou reaproveita — mas a RLS acima (de
-- propósito) impede um representante de enxergar company de outro dono
-- via SELECT normal, então uma query comum sob a sessão dele sempre
-- voltaria vazia mesmo quando o registro existe (falso negativo, geraria
-- duplicata). Função SECURITY DEFINER criada por quem roda a migration
-- (role privilegiado do Supabase, não app_runtime) bypassa RLS só pra
-- essa checagem pontual — devolve só o id (nunca razão social/endereço/
-- dono), workspace_id continua obrigatório no filtro (não é uma busca
-- cross-tenant). REVOKE FROM PUBLIC + GRANT explícito só pra app_runtime,
-- mesmo cuidado de menor privilégio de sempre.
CREATE OR REPLACE FUNCTION public.find_company_id_by_cnpj(
  p_workspace_id uuid,
  p_cnpj_digits text
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT "id" FROM "companies"
  WHERE "workspace_id" = p_workspace_id
    AND "deleted_at" IS NULL
    AND regexp_replace(COALESCE("cpf_cnpj", ''), '\D', '', 'g') = p_cnpj_digits
    AND p_cnpj_digits <> ''
  ORDER BY "created_at" ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_company_id_by_cnpj(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_company_id_by_cnpj(uuid, text) TO app_runtime;

-- Tabela espelho consolidada do eGestor (Matriz + Filial), pedido direto
-- do usuário (2026-08-07) — ver docs/plano-integracao-egestor.md, decisão
-- 2.1/2.2. Objetivo: nunca gravar dado bruto do eGestor direto em
-- `companies` — o pull do eGestor escreve aqui primeiro (uma linha por
-- CNPJ, consolidando Matriz e Filial), e a promoção pra uma Company de
-- verdade é sempre um passo posterior explícito ("sanitização", ainda não
-- implementada nesta migration).
--
-- Mesmo formato do relatório que a Gama já gera fora do CRM (planilha
-- Scrip_AtualizarContatos / script Integrar-bases-egestor.txt, ambos em
-- docs/) — status so_matriz/so_filial/ambos_iguais/ambos_diferentes,
-- dados crus de cada lado em JSON, campos divergentes listados à parte.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TYPE "EgestorContatoStatus" AS ENUM ('so_matriz', 'so_filial', 'ambos_iguais', 'ambos_diferentes');

CREATE TABLE "egestor_contatos_consolidado" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"      UUID NOT NULL,
    "cpf_cnpj"          TEXT NOT NULL,
    "status"            "EgestorContatoStatus" NOT NULL,
    "codigo_matriz"     TEXT,
    "codigo_filial"     TEXT,
    "nome_matriz"       TEXT,
    "nome_filial"       TEXT,
    "dados_matriz"      JSONB,
    "dados_filial"      JSONB,
    "campos_diferentes" TEXT[] NOT NULL DEFAULT '{}',
    "company_id"        UUID,
    "last_synced_at"    TIMESTAMP(3) NOT NULL,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "egestor_contatos_consolidado_pkey" PRIMARY KEY ("id")
);

-- Chave de consolidação: um CNPJ nunca aparece duas vezes nesta tabela
-- (Matriz e Filial dividem a mesma linha).
CREATE UNIQUE INDEX "egestor_contatos_consolidado_workspace_id_cpf_cnpj_key" ON "egestor_contatos_consolidado"("workspace_id", "cpf_cnpj");
-- 1:1 com Company quando promovido (fase de sanitização) — nunca duas
-- linhas do espelho apontando pra mesma Company.
CREATE UNIQUE INDEX "egestor_contatos_consolidado_company_id_key" ON "egestor_contatos_consolidado"("company_id");
CREATE INDEX "egestor_contatos_consolidado_workspace_id_status_idx" ON "egestor_contatos_consolidado"("workspace_id", "status");

ALTER TABLE "egestor_contatos_consolidado" ADD CONSTRAINT "egestor_contatos_consolidado_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL (não RESTRICT): se a Company promovida for removida, a linha
-- do espelho só volta a ficar "não promovida" — não trava a exclusão da
-- Company por causa de uma referência de auditoria.
ALTER TABLE "egestor_contatos_consolidado" ADD CONSTRAINT "egestor_contatos_consolidado_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: mesmo padrão simples de sales_history (workspace-scoped, sem
-- policy de papel) — visibilidade por papel fica pra decidir quando a
-- tela de auditoria (Sprint 2) for desenhada, ver
-- docs/plano-integracao-egestor.md.
ALTER TABLE "egestor_contatos_consolidado" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "egestor_contatos_consolidado" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "egestor_contatos_consolidado"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

-- Fecha o achado do advisor de segurança do Supabase: "workspaces" era a
-- única tabela do schema public sem RLS. Documentado desde a Fase 1
-- (ver bloco perto da linha 377 de prisma/schema.sql) que ela ficou de
-- fora de propósito porque não se encaixa no padrão
-- "workspace_id = variável de sessão" usado nas outras tabelas — ela não
-- tem coluna workspace_id, ela É o tenant.
--
-- O motivo real de nunca ter policy aqui: TenantMembershipGuard resolve
-- o workspace (upsert por slug fixo, ver
-- src/tenancy/tenant-membership.guard.ts#resolveDefaultWorkspace) ANTES
-- de abrir a transação que seta app.current_workspace_id — é o próprio
-- upsert que descobre o id que viraria essa variável. Uma policy no
-- padrão "id = current_setting(...)" quebraria esse upsert (galinha e
-- ovo: sem variável setada, current_setting(...) volta NULL, e
-- NULL = qualquer coisa nunca é verdadeiro → fail-closed bloqueando o
-- próprio login).
--
-- O que o advisor está de fato sinalizando é outro: sem RLS, as roles
-- anon/authenticated do Supabase (as que o cliente JS usa com a anon
-- key, pública por design — ver docs/seguranca.md) enxergam a tabela
-- inteira por padrão. O app nunca fala com o Postgres usando essas
-- roles (só o backend, pela role app_runtime, e só pra Auth do lado do
-- Supabase), mas a defesa tem que estar no banco, não em "o frontend
-- não faz isso hoje".
--
-- Fix: RLS ligado, mas com uma única policy liberando tudo pra
-- app_runtime (a role de execução do backend — já tem os GRANTs de
-- SELECT/INSERT/UPDATE/DELETE aplicados desde a Fase 1) e nada pra mais
-- ninguém. Não usa o padrão workspace_id = sessão porque não se aplica
-- aqui; quem decide QUAL workspace um usuário vê continua sendo
-- Membership + PolicyService, na camada de aplicação (só existe 1
-- workspace de verdade em uso, "gama").
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;

CREATE POLICY "app_runtime_only" ON "workspaces"
  FOR ALL
  TO "app_runtime"
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
-- Correção de vazamento de dados encontrado na auditoria de 2026-08-12
-- (docs/seguranca.md, decisões 3.4.1 e 3.4.2).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. v_busca_empresa_lead atravessava o RLS ──────────────────────
--
-- A view foi criada em 20260729000000_leads_and_task_attachments sem a
-- opção `security_invoker`. Em Postgres, view sem essa opção executa com
-- os privilégios do DONO dela — aqui `postgres`, que ignora RLS. Ou seja:
-- toda consulta à view lia companies/raw_leads SEM nenhuma policy
-- aplicada, independente de quem perguntasse.
--
-- Isso não era teórico. Medido em 2026-08-12, antes desta migration:
--   - papel `anon`   → 0 linhas em raw_leads (RLS negou corretamente),
--                      mas 1176 linhas na view (razão social + CNPJ de
--                      toda empresa e todo lead da base);
--   - papel `authenticated` → idêntico.
--
-- Agravante: o comentário em src/search/search.service.ts afirmava que a
-- view "já herda RLS das tabelas-base" e por isso dispensava filtro de
-- workspace. A premissa era falsa — o filtro nunca existiu de fato.
--
-- `security_invoker = true` faz a view rodar com o privilégio de QUEM
-- consulta, então as policies de companies/raw_leads voltam a valer.
-- Requer Postgres 15+ (este projeto roda 17.6).
ALTER VIEW public."v_busca_empresa_lead" SET (security_invoker = true);

-- ── 2. Nada em `public` precisa ser alcançável por anon/authenticated ─
--
-- O Supabase concede, por padrão, privilégio amplo em `public` pros
-- papéis `anon` e `authenticated` — são eles que o PostgREST (a API REST
-- automática, acessível do navegador com a chave pública) assume. Faz
-- sentido num app que fala direto com o Supabase pelo navegador.
--
-- **Não é o caso deste projeto.** Verificado em 2026-08-12: nenhum
-- componente instancia o client de navegador do Supabase
-- (web/lib/supabase/client.ts não é importado por ninguém), o login usa
-- Server Action, e todo acesso a dado passa pelo NestJS conectado como
-- `app_runtime`. Ou seja, o PostgREST é superfície de ataque 100%
-- desnecessária aqui — e era exatamente por onde a view vazava.
--
-- Seguro porque `app_runtime` NÃO é membro de `anon`/`authenticated`
-- (checado em pg_auth_members) e tem grants próprios nas 20 tabelas.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Sem isto, a próxima tabela criada nasceria exposta de novo — o REVOKE
-- acima só alcança o que já existe.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ── 3. find_company_id_by_cnpj: o REVOKE original não pegou ─────────
--
-- A migration 20260806190000 já fazia `REVOKE ALL ... FROM PUBLIC` e
-- concedia EXECUTE só pra app_runtime — a intenção estava certa. Mas o
-- privilégio de `anon`/`authenticated` não vem de PUBLIC: vem dos grants
-- default do Supabase, que são concedidos aos papéis nominalmente. O
-- REVOKE de PUBLIC não os alcançava, e a auditoria encontrou
-- `anon=X/postgres` no ACL da função.
--
-- Como ela é SECURITY DEFINER (atravessa RLS de propósito), anon poder
-- executá-la permitia testar se um CNPJ existe na base — enumeração.
-- O REVOKE ON ALL FUNCTIONS acima já resolve; o GRANT abaixo é só pra
-- deixar explícito e à prova de ordem de execução que app_runtime
-- mantém o acesso de que o CompanyService depende.
GRANT EXECUTE ON FUNCTION public.find_company_id_by_cnpj(uuid, text) TO app_runtime;

-- EgestorWebhookEvent (egestor_webhook_events) — log cru dos eventos
-- recebidos via push do eGestor (docs/webhook-egestor.md). Escopo desta
-- primeira versão (decisão do usuário, 2026-08-12): só registrar, sem
-- processar automaticamente — o re-fetch/atualização do espelho continua
-- manual (botão "Sincronizar" já existente).
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TABLE "egestor_webhook_events" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"     UUID NOT NULL,
    "estabelecimento"  TEXT NOT NULL,
    "module"           TEXT NOT NULL,
    "action"           TEXT NOT NULL,
    "codigo_externo"   TEXT NOT NULL,
    "data_egestor"     TIMESTAMP(3) NOT NULL,
    "raw_payload"      JSONB NOT NULL,
    "received_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "egestor_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Dedupe: o eGestor tenta até 5x se não responder a tempo (3s de
-- timeout) — mesmo evento pode chegar mais de uma vez. Insert usa
-- ON CONFLICT DO NOTHING contra esta chave (EgestorWebhookService).
CREATE UNIQUE INDEX "egestor_webhook_events_dedupe_key" ON "egestor_webhook_events"("workspace_id", "estabelecimento", "module", "codigo_externo", "action", "data_egestor");
CREATE INDEX "egestor_webhook_events_workspace_id_received_at_idx" ON "egestor_webhook_events"("workspace_id", "received_at");

ALTER TABLE "egestor_webhook_events" ADD CONSTRAINT "egestor_webhook_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão simples de sales_history/egestor_contatos_consolidado
-- (workspace-scoped, sem policy de papel) — visibilidade por papel fica
-- pra decidir quando a tela de auditoria for desenhada. A rota pública
-- que grava aqui (POST /integrations/egestor/webhook/:estabelecimento)
-- não passa por membership nenhum (não tem usuário Supabase por trás,
-- é o eGestor chamando) — ver EgestorWebhookService pro ator "sistema"
-- usado em `app.current_user_id`.
ALTER TABLE "egestor_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "egestor_webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "egestor_webhook_events"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);


-- Membership.permissions — matriz granular de permissões (módulo ×
-- ver/criar/editar/excluir), pedido direto do usuário (2026-08-12):
-- substitui o binário fixo que PolicyService tinha antes (sales_rep nunca
-- exclui, readonly só lê) por checkbox real por membro, editável na
-- subpágina de Permissões do cadastro/edição de membro. Ver
-- src/policy/permission-catalog.ts pro catálogo completo e presets, e
-- PolicyService pro consumo (canModule/can/assertCanDelete).
--
-- Nullable, sem default: null = "sem matriz própria", PolicyService cai
-- pro preset padrão do papel (DEFAULT_PERMISSIONS) — todo membro já
-- existente continua funcionando exatamente como antes desta migration,
-- sem precisar de backfill.
--
-- NÃO mexe em `role` nem em nenhuma policy de RLS — o RLS de
-- companies/opportunities/tasks/raw_leads/contacts continua lendo
-- app.current_role pra decidir ESCOPO (próprio/equipe/todos), dimensão
-- separada de CAPACIDADE que esta coluna decide agora.

ALTER TABLE "memberships" ADD COLUMN "permissions" JSONB;

-- EgestorInteractionLog (egestor_interaction_log) — histórico legível por
-- humano de TODA interação da integração eGestor (docs/roadmap.md, "Criar
-- log das interações de requisições de API", 2026-08-13). Complementar a
-- egestor_webhook_events (que já existia): aquele é o log CRU de cada
-- evento recebido, pensado pra dedupe/reprocessamento; este é o log DE
-- NEGÓCIO, uma linha por efeito colateral real (campo corrigido, Company
-- criada, contato promovido...), cobrindo também as ações manuais da tela
-- (Sincronizar/Promover/Corrigir/Consolidar/Corrigir com SEFAZ/Completar),
-- que egestor_webhook_events nunca viu por não passarem pelo webhook.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TYPE "EgestorInteractionOrigin" AS ENUM ('crm', 'egestor_matriz', 'egestor_filial');

CREATE TABLE "egestor_interaction_log" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "occurred_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin"       "EgestorInteractionOrigin" NOT NULL,
    "action"       TEXT NOT NULL,
    "summary"      TEXT NOT NULL,

    CONSTRAINT "egestor_interaction_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "egestor_interaction_log_workspace_id_occurred_at_idx" ON "egestor_interaction_log"("workspace_id", "occurred_at");

ALTER TABLE "egestor_interaction_log" ADD CONSTRAINT "egestor_interaction_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão workspace-scoped simples já usado em
-- egestor_webhook_events/egestor_write_echo/sales_history/
-- egestor_contatos_consolidado — sem policy de papel (a restrição de
-- owner/admin fica no controller, mesmo critério do resto do módulo).
ALTER TABLE "egestor_interaction_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "egestor_interaction_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "egestor_interaction_log"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
-- MetaLeadsWebhookEvent (meta_leads_webhook_events) — log cru + dedupe do
-- webhook `leadgen` da Central de Leads do Meta Business Suite (Lead Ads
-- Facebook/Instagram do Portfólio da Gama, ver docs/roadmap.md e
-- docs/webhook-meta-leads.md). Mesmo espírito de egestor_webhook_events:
-- registra o evento cru, dedupe por chave natural, marca processado só
-- depois do RawLead de fato criado — erro em qualquer fase propaga (500),
-- deixando o retry nativo da Meta reprocessar.
--
-- `meta_leads` novo em LeadFonte — fonte do lead pra RawLead.fonte, nunca
-- escolhido pelo usuário num form manual (só o MetaLeadsWebhookService
-- grava com esse valor).
--
-- ADD VALUE de enum não pode ser usada e referenciada na MESMA transação
-- (não é o caso aqui, só adiciona — mesmo padrão já usado na migration
-- 20260804130000_task_contact_reuniao). Escrita manual (sem shadow
-- database configurado neste projeto). Aplicado via
-- `prisma migrate deploy`.

ALTER TYPE "LeadFonte" ADD VALUE 'meta_leads';

CREATE TABLE "meta_leads_webhook_events" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"      UUID NOT NULL,
    "page_id"           TEXT NOT NULL,
    "form_id"           TEXT,
    "ad_id"             TEXT,
    "leadgen_id"        TEXT NOT NULL,
    "created_time_meta" TIMESTAMP(3),
    "raw_payload"       JSONB NOT NULL,
    -- Resposta completa do GET /{leadgen_id} (field_data inteiro), gravada
    -- no processamento — enquanto o DE-PARA das perguntas customizadas dos
    -- formulários da Gama não estiver fechado (docs/roadmap.md, dúvida
    -- 1.4), é aqui que nenhum dado se perde.
    "lead_payload"      JSONB,
    "received_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at"      TIMESTAMP(3),
    "process_result"    TEXT,
    "raw_lead_id"       UUID,

    CONSTRAINT "meta_leads_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Dedupe: a Meta reenvia o mesmo evento em retry se a resposta não vier a
-- tempo/vier erro — leadgenId é o identificador natural do lead capturado.
CREATE UNIQUE INDEX "meta_leads_webhook_events_dedupe_key" ON "meta_leads_webhook_events"("workspace_id", "leadgen_id");
CREATE INDEX "meta_leads_webhook_events_workspace_id_received_at_idx" ON "meta_leads_webhook_events"("workspace_id", "received_at");

ALTER TABLE "meta_leads_webhook_events" ADD CONSTRAINT "meta_leads_webhook_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão workspace-scoped simples de egestor_webhook_events —
-- sem policy de papel, a rota pública que grava aqui (POST
-- /integrations/meta-leads/webhook) não tem membership real por trás (é a
-- Meta chamando), ver MetaLeadsWebhookService pro ator "sistema" usado em
-- `app.current_user_id`.
ALTER TABLE "meta_leads_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meta_leads_webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "meta_leads_webhook_events"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

