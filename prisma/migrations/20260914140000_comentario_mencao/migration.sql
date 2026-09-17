-- Destacar um membro dentro do comentário do card de Oportunidade
-- (pedido do usuário, 2026-09-14): quem é destacado passa a ter uma
-- PENDÊNCIA naquele card, sinalizada com triângulo amarelo no quadro do
-- Pipeline até dar baixa.
--
-- Duas listas na mesma linha em vez de tabela nova: quem foi destacado e
-- quem já deu baixa. A pendência de uma pessoa existe enquanto o id dela
-- estiver na primeira e não estiver na segunda.
--
-- Escrita manual (mesmo motivo das migrations anteriores). Aditiva:
-- colunas com default vazio, sem backfill.
--
-- RLS: nenhuma tabela nova — `opportunity_comments` já tem a policy
-- `workspace_isolation` (20260802000000), que vale pras colunas novas.

ALTER TABLE "opportunity_comments"
  ADD COLUMN "mentioned_user_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE "opportunity_comments"
  ADD COLUMN "mentions_done_user_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- O quadro pergunta "este usuário tem pendência em algum destes cards?"
-- a cada carregamento do Pipeline — índice GIN resolve sem varrer a
-- tabela de comentários inteira.
CREATE INDEX "opportunity_comments_mentioned_user_ids_idx"
  ON "opportunity_comments" USING GIN ("mentioned_user_ids");
