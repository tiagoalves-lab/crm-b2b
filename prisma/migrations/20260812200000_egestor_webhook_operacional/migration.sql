-- Webhook operacional (2026-08-12) — dois adicionais:
-- 1. `egestor_webhook_events` ganha `processed_at`/`process_result` pra
--    controlar se um evento já foi processado (não só logado) — retry do
--    eGestor num evento não-processado deve reprocessar, não só re-logar.
-- 2. Tabela nova `egestor_write_echo` — marcador de curta duração pra
--    diferenciar "webhook por causa de uma escrita do próprio CRM" de
--    "webhook por causa de edição feita direto no eGestor" (confirmado
--    contra a API real que as duas disparam o mesmo evento, sem campo de
--    origem no payload). Ver docs/webhook-egestor.md.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

ALTER TABLE "egestor_webhook_events" ADD COLUMN "processed_at" TIMESTAMP(3);
ALTER TABLE "egestor_webhook_events" ADD COLUMN "process_result" TEXT;

CREATE TABLE "egestor_write_echo" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"    UUID NOT NULL,
    "estabelecimento" TEXT NOT NULL,
    "codigo"          TEXT NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "egestor_write_echo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "egestor_write_echo_workspace_id_estabelecimento_codigo_idx" ON "egestor_write_echo"("workspace_id", "estabelecimento", "codigo");

ALTER TABLE "egestor_write_echo" ADD CONSTRAINT "egestor_write_echo_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão workspace-scoped simples já usado em
-- egestor_webhook_events/sales_history/egestor_contatos_consolidado.
ALTER TABLE "egestor_write_echo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "egestor_write_echo" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "egestor_write_echo"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
