-- "Marcar como lido" no histórico de anotações do Pipeline (pedido do
-- usuário, 2026-09-17, no molde das notificações do Trello): cada pessoa
-- marca a anotação como lida e pode filtrar só as não lidas.
--
-- Uma lista na própria linha (quem já leu), mesmo raciocínio de
-- mentioned_user_ids/mentions_done_user_ids (20260914140000): o workspace
-- tem poucas dezenas de membros, a lista nunca cresce muito.
--
-- Escrita manual (mesmo motivo das migrations anteriores). Aditiva:
-- default vazio, sem backfill — tudo que já existia nasce não lido, e o
-- "Marcar tudo como lido" limpa de uma vez.
--
-- RLS: nenhuma tabela nova — `opportunity_comments` já tem a policy
-- `workspace_isolation` (20260802000000), que vale pra coluna nova.

ALTER TABLE "opportunity_comments"
  ADD COLUMN "read_by_user_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
