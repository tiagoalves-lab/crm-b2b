-- Segmento de negócio na Prospecção (raw_leads) — pedido direto do
-- usuário, fora do SPEC-CRM-GAMA.md original, mesmo dia da migration de
-- tags (20260805130000_raw_lead_tags). Diferente de tags: valor único por
-- lead (confirmado via pergunta direta ao usuário — "um segmento por
-- vez"), texto livre, sem lista pré-definida.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "raw_leads" ADD COLUMN "segmento" TEXT;
