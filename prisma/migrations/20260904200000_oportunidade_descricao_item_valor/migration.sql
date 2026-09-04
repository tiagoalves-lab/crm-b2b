-- Descrição longa da oportunidade (molde da descrição do cartão do Trello)
-- e valor por item da lista lateral, cuja soma vira o valor do card.
-- Aditiva: colunas nulas, nenhum default, nenhum backfill.
ALTER TABLE "opportunities" ADD COLUMN "description" TEXT;
ALTER TABLE "opportunity_items" ADD COLUMN "amount" DECIMAL(14,2);
