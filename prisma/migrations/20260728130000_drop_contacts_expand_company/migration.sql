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
