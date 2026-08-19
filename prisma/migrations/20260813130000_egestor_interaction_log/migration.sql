-- EgestorInteractionLog (egestor_interaction_log) — histórico legível por
-- humano de TODA interação da integração eGestor (docs/roadmap.md, "Criar
-- log das interações de requisições de API", 2026-08-13). Complementar a
-- egestor_webhook_events (que já existia): aquele é o log CRU de cada
-- evento recebido, pensado pra dedupe/reprocessamento; este é o log DE
-- NEGÓCIO, uma linha por efeito colateral real (campo corrigido, Company
-- criada, contato promovido...), cobrindo também as ações manuais da tela
-- (Sincronizar/Promover/Corrigir/Consolidar/Corrigir com SEFAZ/Completar),
-- que egestor_webhook_events nunca viu por não passarem pelo webhook.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TYPE "EgestorInteractionOrigin" AS ENUM ('crm', 'egestor_matriz', 'egestor_filial');

CREATE TABLE "egestor_interaction_log" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "occurred_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin"       "EgestorInteractionOrigin" NOT NULL,
    "action"       TEXT NOT NULL,
    "summary"      TEXT NOT NULL,

    CONSTRAINT "egestor_interaction_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "egestor_interaction_log_workspace_id_occurred_at_idx" ON "egestor_interaction_log"("workspace_id", "occurred_at");

ALTER TABLE "egestor_interaction_log" ADD CONSTRAINT "egestor_interaction_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão workspace-scoped simples já usado em
-- egestor_webhook_events/egestor_write_echo/sales_history/
-- egestor_contatos_consolidado — sem policy de papel (a restrição de
-- owner/admin fica no controller, mesmo critério do resto do módulo).
ALTER TABLE "egestor_interaction_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "egestor_interaction_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "egestor_interaction_log"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
