-- Preenche com a data de hoje o prazo (due_at) das tarefas que ainda
-- estão em branco — pedido do usuário, 2026-08-11, parte do pacote de
-- ajustes do menu Tarefas (Responsável na tabela, destaque de vínculo/
-- criador no modal, Prazo virou campo obrigatório dali pra frente; esta
-- query cobre o passivo criado antes disso).
--
-- Idempotente: WHERE só pega linha com due_at NULL, rodar de novo não
-- tem efeito colateral.

BEGIN;

UPDATE tasks
SET due_at = CURRENT_DATE
WHERE due_at IS NULL;

COMMIT;
