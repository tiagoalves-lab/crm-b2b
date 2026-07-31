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
