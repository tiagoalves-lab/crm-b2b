-- MetaLeadsWebhookEvent (meta_leads_webhook_events) — log cru + dedupe do
-- webhook `leadgen` da Central de Leads do Meta Business Suite (Lead Ads
-- Facebook/Instagram do Portfólio da Gama, ver docs/roadmap.md e
-- docs/webhook-meta-leads.md). Mesmo espírito de egestor_webhook_events:
-- registra o evento cru, dedupe por chave natural, marca processado só
-- depois do RawLead de fato criado — erro em qualquer fase propaga (500),
-- deixando o retry nativo da Meta reprocessar.
--
-- `meta_leads` novo em LeadFonte — fonte do lead pra RawLead.fonte, nunca
-- escolhido pelo usuário num form manual (só o MetaLeadsWebhookService
-- grava com esse valor).
--
-- ADD VALUE de enum não pode ser usada e referenciada na MESMA transação
-- (não é o caso aqui, só adiciona — mesmo padrão já usado na migration
-- 20260804130000_task_contact_reuniao). Escrita manual (sem shadow
-- database configurado neste projeto). Aplicado via
-- `prisma migrate deploy`.

ALTER TYPE "LeadFonte" ADD VALUE 'meta_leads';

CREATE TABLE "meta_leads_webhook_events" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"      UUID NOT NULL,
    "page_id"           TEXT NOT NULL,
    "form_id"           TEXT,
    "ad_id"             TEXT,
    "leadgen_id"        TEXT NOT NULL,
    "created_time_meta" TIMESTAMP(3),
    "raw_payload"       JSONB NOT NULL,
    -- Resposta completa do GET /{leadgen_id} (field_data inteiro), gravada
    -- no processamento — enquanto o DE-PARA das perguntas customizadas dos
    -- formulários da Gama não estiver fechado (docs/roadmap.md, dúvida
    -- 1.4), é aqui que nenhum dado se perde.
    "lead_payload"      JSONB,
    "received_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at"      TIMESTAMP(3),
    "process_result"    TEXT,
    "raw_lead_id"       UUID,

    CONSTRAINT "meta_leads_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Dedupe: a Meta reenvia o mesmo evento em retry se a resposta não vier a
-- tempo/vier erro — leadgenId é o identificador natural do lead capturado.
CREATE UNIQUE INDEX "meta_leads_webhook_events_dedupe_key" ON "meta_leads_webhook_events"("workspace_id", "leadgen_id");
CREATE INDEX "meta_leads_webhook_events_workspace_id_received_at_idx" ON "meta_leads_webhook_events"("workspace_id", "received_at");

ALTER TABLE "meta_leads_webhook_events" ADD CONSTRAINT "meta_leads_webhook_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão workspace-scoped simples de egestor_webhook_events —
-- sem policy de papel, a rota pública que grava aqui (POST
-- /integrations/meta-leads/webhook) não tem membership real por trás (é a
-- Meta chamando), ver MetaLeadsWebhookService pro ator "sistema" usado em
-- `app.current_user_id`.
ALTER TABLE "meta_leads_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meta_leads_webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "meta_leads_webhook_events"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
