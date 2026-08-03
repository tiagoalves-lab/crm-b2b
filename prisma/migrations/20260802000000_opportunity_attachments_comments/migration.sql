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
