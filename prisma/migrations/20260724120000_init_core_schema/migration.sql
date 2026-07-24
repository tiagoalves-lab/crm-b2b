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

