-- Vínculo cartão do Trello -> Oportunidade (pedido do usuário, 2026-09-04):
-- a tela "Trello | Solicitação de Propostas" do app de cotações passa a
-- criar a oportunidade no Funil Padrão e a espelhar os comentários do
-- cartão no chat do card. Fase 3 do plano mestre
-- (gama-webapp/planejamento/integracao-crm.md, seção 6).
--
-- Escrita manual (mesmo motivo das migrations anteriores: `prisma migrate
-- diff` pede --shadow-database-url, não configurado neste projeto).
-- Aplicado via `prisma migrate deploy`. Aditiva: só colunas novas
-- nullable e índices — o código em produção que ainda não conhece essas
-- colunas continua funcionando sem alteração.

-- ── opportunities: de que cartão do Trello a oportunidade nasceu ───────
ALTER TABLE "opportunities" ADD COLUMN "trello_card_id"  TEXT;
ALTER TABLE "opportunities" ADD COLUMN "trello_card_url" TEXT;
-- Última vez que os comentários do cartão foram espelhados no card.
ALTER TABLE "opportunities" ADD COLUMN "trello_sync_em"  TIMESTAMP(3);

-- Um cartão = uma oportunidade viva. Parcial: cartão cujo card foi
-- apagado (soft delete) pode ser cadastrado de novo, e as oportunidades
-- que não vieram do Trello (a maioria) não disputam o índice.
CREATE UNIQUE INDEX "opportunities_workspace_trello_card_key"
  ON "opportunities" ("workspace_id", "trello_card_id")
  WHERE "trello_card_id" IS NOT NULL AND "deleted_at" IS NULL;

-- ── opportunity_comments: idempotência do espelho ─────────────────────
-- Guarda o id do comentário na origem (action id do Trello). É o que faz
-- o botão "Sincronizar" poder ser apertado quantas vezes quiser sem
-- duplicar mensagem. NULL em todo comentário escrito por gente no CRM.
ALTER TABLE "opportunity_comments" ADD COLUMN "external_ref" TEXT;

CREATE UNIQUE INDEX "opportunity_comments_external_ref_key"
  ON "opportunity_comments" ("opportunity_id", "external_ref")
  WHERE "external_ref" IS NOT NULL;
