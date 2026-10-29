-- Membros da tarefa (2026-09-29).
--
-- Pedido do usuário: poder incluir outros membros da equipe numa tarefa,
-- e eles passam a ver e trabalhar a tarefa (abrir, comentar, anexar,
-- concluir) como o responsável. Excluir continua com quem já podia.
--
-- Lista de ids na própria tarefa, mesma decisão de
-- `participant_contact_ids`: o vínculo não carrega dado próprio e só é
-- lido junto da tarefa. Sem tabela nova, sem policy nova — só a policy de
-- leitura de `tasks` ganha o ramo "sou membro".
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "member_user_ids" uuid[] NOT NULL DEFAULT '{}';

-- "Tarefas em que sou membro" é a pergunta de toda lista do representante.
CREATE INDEX IF NOT EXISTS "tasks_member_user_ids_idx"
  ON "tasks" USING GIN ("member_user_ids");

-- Mesma policy de 20260731220000_rls_manager_bypass, mais o membro.
DROP POLICY IF EXISTS "ws_and_role_select" ON "tasks";
CREATE POLICY "ws_and_role_select" ON "tasks" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "created_by" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR NULLIF(current_setting('app.current_user_id', true), '')::uuid = ANY ("member_user_ids")
    )
  );
