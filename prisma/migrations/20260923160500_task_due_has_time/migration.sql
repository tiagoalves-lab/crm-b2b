-- Prazo de tarefa com HORA (2026-09-23).
--
-- Pedido do usuário: ao agendar uma reunião na Timeline do lead, informar
-- data E hora, e a reunião aparecer no menu de Tarefas com esse horário.
--
-- Até aqui `due_at` era sempre "um dia sem hora": vinha de um
-- <input type="date">, virava meia-noite UTC e a tela formatava em UTC
-- (formatDateOnlyBR) justamente pra não cair no dia anterior ao converter
-- pra Brasília. Com hora de verdade os dois casos passam a conviver, e
-- esta coluna é o que os separa — sem ela, "00:00" seria indistinguível
-- de "sem horário".
--
-- Falso em tudo que já existe: nenhuma tarefa da base foi marcada com
-- hora, e inventar horário mudaria o que a tela mostra hoje.
--
-- Sem policy nova: coluna em tabela que já tem RLS por workspace.
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "due_has_time" boolean NOT NULL DEFAULT false;
