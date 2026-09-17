-- ReportLog (report_log) — registro de cada report recorrente enviado por
-- e-mail (resumo diário do Pipeline, 2026-09-15). Ver o comentário do
-- model em prisma/schema.prisma pros dois motivos de existir
-- (idempotência do envio + detecção de falha silenciosa).
--
-- Escrita manual, mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto. Aplicado via `prisma migrate deploy`.

CREATE TABLE "report_log" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"  UUID NOT NULL,
    "tipo"          TEXT NOT NULL,
    "ref_dia"       TEXT NOT NULL,
    "status"        TEXT NOT NULL,
    "message_id"    TEXT,
    "destinatarios" INTEGER NOT NULL DEFAULT 0,
    "erro"          TEXT,
    "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_log_pkey" PRIMARY KEY ("id")
);

-- A trava de "um e-mail por dia por report". É ela, e não o if no código,
-- que segura duas execuções simultâneas (redeploy no horário do disparo,
-- disparo manual junto com o agendado): a segunda gravação estoura
-- violação de unicidade em vez de gerar um segundo e-mail.
CREATE UNIQUE INDEX "report_log_workspace_id_tipo_ref_dia_key"
  ON "report_log"("workspace_id", "tipo", "ref_dia");

CREATE INDEX "report_log_workspace_id_criado_em_idx"
  ON "report_log"("workspace_id", "criado_em");

ALTER TABLE "report_log" ADD CONSTRAINT "report_log_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão workspace-scoped simples de egestor_interaction_log /
-- egestor_webhook_events / sales_history — sem policy de papel, porque a
-- tabela não é de nenhum representante (é registro de operação do
-- sistema); quem pode LER pela API é restrito no controller (owner/admin),
-- mesmo critério dos outros logs de integração.
ALTER TABLE "report_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "report_log"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
