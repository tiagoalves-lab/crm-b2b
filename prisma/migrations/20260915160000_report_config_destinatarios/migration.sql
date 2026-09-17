-- Lista de destinatários por report (pedido do usuário, 2026-09-15): a
-- tela "E-mail automático" passa a ter "Quem recebe" dentro de cada
-- relatório, em vez de uma regra única para os dois.
--
-- Coluna nova com default vazio de propósito: lista vazia significa
-- "todos os elegíveis", que é exatamente o comportamento que já valia —
-- quem não mexer em nada continua recebendo igual.

ALTER TABLE "report_config"
  ADD COLUMN "destinatarios" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
