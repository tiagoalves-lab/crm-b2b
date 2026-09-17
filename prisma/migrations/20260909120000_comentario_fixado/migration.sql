-- Comentário fixado no card de Oportunidade (pedido do usuário,
-- 2026-09-09): o comentário marcado sobe pro topo do histórico de
-- anotações do Pipeline (GET /opportunity-comments), que abre pelo ícone
-- da barra da tela Pipeline.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aditiva: colunas nulas, sem default, sem backfill.
--
-- RLS: nenhuma tabela nova — `opportunity_comments` já tem a policy
-- `workspace_isolation` (20260802000000), que vale pras colunas novas.

ALTER TABLE "opportunity_comments" ADD COLUMN "pinned_at" TIMESTAMP(3);
ALTER TABLE "opportunity_comments" ADD COLUMN "pinned_by_user_id" UUID;

-- Índice PARCIAL (fixado é minoria): o histórico lê os fixados primeiro,
-- de todas as oportunidades visíveis, sem varrer a tabela inteira.
CREATE INDEX "opportunity_comments_pinned_at_idx"
  ON "opportunity_comments" ("pinned_at" DESC)
  WHERE "pinned_at" IS NOT NULL;
