-- Corrige um fail-closed que quebrava com erro em vez de devolver zero
-- linhas. `current_setting('app.current_workspace_id', true)` retorna
-- NULL só na primeira vez que o GUC placeholder é referenciado numa
-- conexão física; depois que qualquer transação já fez SET LOCAL nele
-- (mesmo em outra sessão lógica, sob connection pooling), o placeholder
-- passa a existir nessa conexão com reset state '' (string vazia) em vez
-- de NULL. `''::uuid` dá erro de sintaxe — a query inteira falha (500) em
-- vez de simplesmente não achar nenhuma linha.
--
-- Na aplicação real isso nunca é alcançado (TenantContextService sempre
-- seta a variável antes de qualquer query de negócio) — só afeta o teste
-- de defesa-em-profundidade (test/rls-isolation.e2e-spec.ts) e qualquer
-- código futuro que abrisse uma query sem passar pelo TenantContextService.
-- Descoberto ao crescer a suíte de testes da Fase 3 (mais transações
-- tocando a mesma pool de conexões aumentou a chance de pegar uma conexão
-- "já usada").
--
-- NULLIF(valor, '') converte string vazia em NULL antes do cast — nunca
-- erra, e workspace_id = NULL continua sempre falso (fail-closed
-- preservado).

ALTER POLICY "workspace_isolation" ON "memberships"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "companies"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "contacts"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "pipelines"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "stages"
  USING (
    "pipeline_id" IN (
      SELECT "id" FROM "pipelines"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    "pipeline_id" IN (
      SELECT "id" FROM "pipelines"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

ALTER POLICY "workspace_isolation" ON "opportunities"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "tasks"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER POLICY "workspace_isolation" ON "activities"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
