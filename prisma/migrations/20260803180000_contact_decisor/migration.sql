-- Pedido do usuário (2026-08-03), fora do SPEC-CRM-GAMA.md original:
-- checkbox "tomador de decisão" no cadastro de contato.
ALTER TABLE "contacts" ADD COLUMN "decisor" BOOLEAN NOT NULL DEFAULT false;
