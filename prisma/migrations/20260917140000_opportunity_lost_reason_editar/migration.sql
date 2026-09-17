-- Motivos de perda editáveis (pedido do usuário, 2026-09-17): a aba
-- "Motivos de perda" da Administração renomeia e exclui motivos. A
-- migration anterior só liberava SELECT/INSERT; aqui entram UPDATE e
-- DELETE, com o mesmo isolamento por workspace. Quem pode (owner/admin) e
-- o bloqueio de excluir motivo já usado ficam no backend.
--
-- Escrita manual, mesmo motivo das migrations anteriores.

CREATE POLICY "workspace_isolation_update" ON "opportunity_lost_reason" FOR UPDATE
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_delete" ON "opportunity_lost_reason" FOR DELETE
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
