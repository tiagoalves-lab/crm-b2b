-- ReportConfig (report_config) — configuração dos reports por e-mail
-- editável na tela "E-mail automático" (Administração), 2026-09-15. Ver o
-- comentário do model em prisma/schema.prisma pro motivo de sair da
-- variável de ambiente e vir pro banco.
--
-- Escrita manual, mesmo motivo das migrations anteriores (`prisma migrate
-- diff` pede --shadow-database-url, não configurado aqui).

CREATE TABLE "report_config" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"   UUID NOT NULL,
    "tipo"           TEXT NOT NULL,
    "ativo"          BOOLEAN NOT NULL DEFAULT true,
    "horarios"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "dias_uteis"     BOOLEAN NOT NULL DEFAULT true,
    "etapas"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "atualizado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_por" UUID,

    CONSTRAINT "report_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "report_config_workspace_id_tipo_key"
  ON "report_config"("workspace_id", "tipo");

ALTER TABLE "report_config" ADD CONSTRAINT "report_config_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão workspace-scoped das outras tabelas de operação
-- (report_log, egestor_interaction_log). Quem pode EDITAR pela API é
-- restrito a owner/admin no controller.
ALTER TABLE "report_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_config" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "report_config"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
