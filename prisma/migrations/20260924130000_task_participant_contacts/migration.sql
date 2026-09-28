-- Pessoas envolvidas na reunião (2026-09-24).
--
-- Pedido do usuário: tarefa do tipo Reunião precisa registrar quem mais
-- participa, além do contato principal (`contact_id`, que segue
-- obrigatório pra ligação/reunião/visita/e-mail).
--
-- Lista de ids na própria tarefa em vez de tabela de ligação: o vínculo
-- não carrega nenhum dado próprio (papel, confirmação de presença) e só é
-- lido junto da tarefa — mesma decisão já tomada pra `tags`. Uma tabela
-- nova exigiria policy de RLS própria sem ganhar nada.
--
-- Vazio em tudo que já existe. Sem policy nova: coluna em tabela que já
-- tem RLS por workspace.
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "participant_contact_ids" uuid[] NOT NULL DEFAULT '{}';
