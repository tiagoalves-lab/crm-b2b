-- Edição de comentário do card de Oportunidade com histórico (pedido do
-- usuário, 2026-10-16): "habilite ferramenta para poder editar o
-- comentário (pode ocorrer erro de digitação), mas implemente recurso de
-- log a fim de manter o histórico".
--
-- O comentário guarda só a data da última edição; cada versão anterior
-- vira uma linha em opportunity_comment_edits (texto de antes e de
-- depois, quem editou, quando).
--
-- Escrita manual (mesmo motivo das migrations anteriores). Aditiva.

ALTER TABLE "opportunity_comments" ADD COLUMN "edited_at" TIMESTAMP(3);

CREATE TABLE "opportunity_comment_edits" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "comment_id"        UUID NOT NULL,
    "opportunity_id"    UUID NOT NULL,
    "body_before"       TEXT NOT NULL,
    "body_after"        TEXT NOT NULL,
    "edited_by_user_id" UUID NOT NULL,
    "edited_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_comment_edits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "opportunity_comment_edits_comment_id_idx" ON "opportunity_comment_edits"("comment_id");

ALTER TABLE "opportunity_comment_edits" ADD CONSTRAINT "opportunity_comment_edits_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "opportunity_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: mesmo isolamento de opportunity_comments (subquery em
-- opportunity_id -> opportunities.workspace_id). É um LOG: só SELECT e
-- INSERT — sem policy de UPDATE/DELETE, nem o backend reescreve ou apaga
-- uma versão. A remoção em cascata (comentário excluído) é ação de
-- integridade referencial e não passa por RLS; o texto vai antes pro
-- registro de exclusões (OpportunityCommentService#remove).
ALTER TABLE "opportunity_comment_edits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_comment_edits" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation_select" ON "opportunity_comment_edits" FOR SELECT
  USING (
    "opportunity_id" IN (
      SELECT "id" FROM "opportunities"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  );
CREATE POLICY "workspace_isolation_insert" ON "opportunity_comment_edits" FOR INSERT
  WITH CHECK (
    "opportunity_id" IN (
      SELECT "id" FROM "opportunities"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  );
