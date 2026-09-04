-- Lista de itens do card de Oportunidade + tags em comentários e tarefas
-- (pedido do usuário, 2026-09-04): a lateral do card ganha uma lista de
-- itens (o que está sendo negociado); cada item vira uma tag que pode ser
-- carimbada num comentário do card ou numa tarefa gerada a partir dele.
--
-- A tag é gravada como TEXTO (nome do item no momento do carimbo), não
-- como FK: remover um item da lista não apaga o carimbo dos registros
-- antigos — eles são histórico. A validação "tag precisa estar na lista"
-- acontece no service (src/opportunities/opportunity-tags.ts), na hora de
-- gravar.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

-- ── opportunity_items ──────────────────────────────────────────────────
CREATE TABLE "opportunity_items" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "name"           TEXT NOT NULL,
    "position"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "opportunity_items_opportunity_id_idx" ON "opportunity_items"("opportunity_id");

ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mesmo padrão de opportunity_comments/opportunity_attachments: sem
-- workspace_id próprio, isolamento por subquery em opportunity_id ->
-- opportunities.workspace_id. Visibilidade por papel fica no service
-- (OpportunityService.mustBeVisible -> PolicyService.can).
ALTER TABLE "opportunity_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "opportunity_items"
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

-- ── tags (carimbo) em comentários do card e em tarefas ─────────────────
ALTER TABLE "opportunity_comments" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tasks" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
