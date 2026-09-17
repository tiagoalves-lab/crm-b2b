-- DeletionLog (deletion_log) — registro de exclusões (pedido do usuário,
-- 2026-09-16): duas tarefas foram excluídas e não havia como saber quem
-- excluiu nem o que havia nelas. Ver o comentário do model em
-- prisma/schema.prisma.
--
-- Escrita manual, mesmo motivo das anteriores: `prisma migrate diff` pede
-- --shadow-database-url, não configurado neste projeto. Aplicada via
-- `prisma migrate deploy`.

CREATE TABLE "deletion_log" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"  UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "entidade"      TEXT NOT NULL,
    "registro_id"   UUID NOT NULL,
    "titulo"        TEXT NOT NULL,
    "contexto"      TEXT,
    "snapshot"      JSONB NOT NULL DEFAULT '{}',
    "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deletion_log_workspace_id_criado_em_idx"
  ON "deletion_log"("workspace_id", "criado_em");
CREATE INDEX "deletion_log_workspace_id_entidade_criado_em_idx"
  ON "deletion_log"("workspace_id", "entidade", "criado_em");

-- CASCADE só pro caso dos testes automáticos, que criam e apagam um
-- workspace próprio a cada execução. O workspace real nunca é apagado.
ALTER TABLE "deletion_log" ADD CONSTRAINT "deletion_log_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS na mesma migration (regra do projeto). Isolamento por workspace,
-- como os outros logs; quem pode LER é restrito no controller
-- (owner/admin). Diferença proposital: só existem policies de SELECT e
-- INSERT. Sem policy de UPDATE/DELETE, com FORCE, nem o backend consegue
-- alterar ou apagar um registro — um rastro de exclusão que pode ser
-- excluído não serve de rastro.
ALTER TABLE "deletion_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deletion_log" FORCE ROW LEVEL SECURITY;

CREATE POLICY "workspace_isolation_select" ON "deletion_log" FOR SELECT
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_insert" ON "deletion_log" FOR INSERT
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
