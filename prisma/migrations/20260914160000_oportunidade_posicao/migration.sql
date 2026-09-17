-- Ordem dos cards dentro da coluna do Pipeline (pedido do usuário,
-- 2026-09-14): arrastar na vertical para organizar prioridade, não só
-- entre etapas.
--
-- NULL = card que nunca foi posicionado à mão; a listagem ordena
-- `position` ascendente com os nulos por último, caindo na ordem antiga
-- (mais recente primeiro) enquanto ninguém tiver arrastado nada.
--
-- Escrita manual (mesmo motivo das migrations anteriores). Aditiva.
-- Nenhuma tabela nova: `opportunities` já tem RLS.

ALTER TABLE "opportunities" ADD COLUMN "position" INTEGER;

CREATE INDEX "opportunities_stage_id_position_idx"
  ON "opportunities" ("stage_id", "position");
