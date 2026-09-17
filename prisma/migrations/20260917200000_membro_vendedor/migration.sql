-- Marcação "Vendedor" no cadastro de membros (pedido do usuário,
-- 2026-09-17): só membro marcado aparece na lista "Representante" do card
-- de oportunidade. Independe do papel — um proprietário que vende pode ser
-- marcado, um administrador que não vende fica de fora.
--
-- Escrita manual (mesmo motivo das migrations anteriores).
--
-- Ponto de partida: quem hoje é Gerente ou Representante ATIVO nasce
-- marcado — senão a lista do card ficaria vazia até alguém editar cada
-- membro. O resto começa desmarcado.
--
-- RLS: nenhuma tabela nova — `memberships` já tem as policies dela.

ALTER TABLE "memberships"
  ADD COLUMN "vendedor" BOOLEAN NOT NULL DEFAULT false;

UPDATE "memberships"
   SET "vendedor" = true
 WHERE "role" IN ('manager', 'sales_rep')
   AND "status" = 'active';
