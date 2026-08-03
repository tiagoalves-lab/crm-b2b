-- Classificação manual de leads (Quente/Morno/Frio) — pedido direto do
-- usuário, fora do SPEC-CRM-GAMA.md original. `manual_tier` sobrepõe o
-- tier calculado por LeadScoringService#tier a partir do score quando
-- preenchido; NULL (default) mantém o comportamento automático de sempre.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores
-- deste projeto: `prisma migrate diff` exige --shadow-database-url, não
-- configurado aqui). Aplicado via `prisma migrate deploy`.

CREATE TYPE "LeadTier" AS ENUM ('quente', 'morno', 'frio');

ALTER TABLE "raw_leads" ADD COLUMN "manual_tier" "LeadTier";
