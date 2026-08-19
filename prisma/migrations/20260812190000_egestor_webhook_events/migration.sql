-- EgestorWebhookEvent (egestor_webhook_events) — log cru dos eventos
-- recebidos via push do eGestor (docs/webhook-egestor.md). Escopo desta
-- primeira versão (decisão do usuário, 2026-08-12): só registrar, sem
-- processar automaticamente — o re-fetch/atualização do espelho continua
-- manual (botão "Sincronizar" já existente).
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TABLE "egestor_webhook_events" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"     UUID NOT NULL,
    "estabelecimento"  TEXT NOT NULL,
    "module"           TEXT NOT NULL,
    "action"           TEXT NOT NULL,
    "codigo_externo"   TEXT NOT NULL,
    "data_egestor"     TIMESTAMP(3) NOT NULL,
    "raw_payload"      JSONB NOT NULL,
    "received_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "egestor_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Dedupe: o eGestor tenta até 5x se não responder a tempo (3s de
-- timeout) — mesmo evento pode chegar mais de uma vez. Insert usa
-- ON CONFLICT DO NOTHING contra esta chave (EgestorWebhookService).
CREATE UNIQUE INDEX "egestor_webhook_events_dedupe_key" ON "egestor_webhook_events"("workspace_id", "estabelecimento", "module", "codigo_externo", "action", "data_egestor");
CREATE INDEX "egestor_webhook_events_workspace_id_received_at_idx" ON "egestor_webhook_events"("workspace_id", "received_at");

ALTER TABLE "egestor_webhook_events" ADD CONSTRAINT "egestor_webhook_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão simples de sales_history/egestor_contatos_consolidado
-- (workspace-scoped, sem policy de papel) — visibilidade por papel fica
-- pra decidir quando a tela de auditoria for desenhada. A rota pública
-- que grava aqui (POST /integrations/egestor/webhook/:estabelecimento)
-- não passa por membership nenhum (não tem usuário Supabase por trás,
-- é o eGestor chamando) — ver EgestorWebhookService pro ator "sistema"
-- usado em `app.current_user_id`.
ALTER TABLE "egestor_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "egestor_webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "egestor_webhook_events"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
