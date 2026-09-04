-- Leads do Meta chegando pela planilha do gestor de tráfego (2026-09-04,
-- docs/webhook-meta-leads.md, seção "Canal em uso hoje: planilha"). O
-- webhook direto da Meta segue parado (App em modo desenvolvimento), e os
-- leads reais estão caindo numa planilha do Google Sheets — um script
-- instalado nela (scripts/planilha-meta-leads.gs) manda cada linha nova pro
-- CRM, que reaproveita a MESMA esteira (meta_leads_webhook_events pra
-- dedupe/auditoria, RawLeadService pro lead).
--
-- page_id vira opcional: a planilha não traz o id da Página. `origem`
-- distingue os dois canais no log ('webhook' | 'planilha').
--
-- Sem tabela nova, sem policy nova — a RLS de meta_leads_webhook_events
-- (migration 20260814100000) continua valendo. Escrita manual (sem shadow
-- database configurado neste projeto). Aplicado via `prisma migrate deploy`.

ALTER TABLE "meta_leads_webhook_events" ALTER COLUMN "page_id" DROP NOT NULL;
ALTER TABLE "meta_leads_webhook_events" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'webhook';
