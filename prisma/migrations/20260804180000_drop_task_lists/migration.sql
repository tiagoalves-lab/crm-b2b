-- Remove o Kanban de Tarefas por completo (schema + dado) — pedido
-- direto do usuário: "isso não vai ser usado". A UI do Kanban já tinha
-- sido removida em 2026-08-01 (ver CLAUDE.md), mas a coluna
-- `tasks.list_id` (NOT NULL) e a tabela `task_lists` continuavam
-- existindo por baixo só pra Task sempre ter uma coluna válida — sem
-- nenhuma tela gerenciando isso, virou peso morto. `status`
-- (pending/done) já é controlado direto por completeTaskAction/
-- reopenTaskAction, nunca dependeu de list_id na prática de UI.
--
-- `position` (fractional indexing pra ordenar dentro de uma coluna)
-- também sai — sem list_id não existe mais "dentro de uma coluna" pra
-- ordenar.
--
-- Escrita manual (sem shadow database configurado neste projeto).
-- Aplicado via `npm run prisma:migrate:deploy`.

ALTER TABLE "tasks" DROP CONSTRAINT "tasks_list_id_fkey";
DROP INDEX "tasks_list_id_idx";
ALTER TABLE "tasks" DROP COLUMN "list_id";
ALTER TABLE "tasks" DROP COLUMN "position";

DROP TABLE "task_lists";
