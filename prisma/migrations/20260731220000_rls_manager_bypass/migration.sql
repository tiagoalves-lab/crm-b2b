-- SPEC-CRM-GAMA.md §7.5 é explícito: "Os papéis manager e readonly ficam
-- previstos no enum mas NÃO são usados nesta rodada (só Admin e
-- Operador)." Implementar a hierarquia de manager em RLS puro (SQL)
-- exigiria replicar PolicyService.getSubordinateUserIds() como subquery
-- recursiva — fora do escopo desta rodada por decisão explícita do spec.
--
-- Sem este ajuste, um Membership com role='manager' ficava mais restrito
-- no banco (RLS não sabe nada sobre subordinados) do que na aplicação
-- (PolicyService já resolve a hierarquia corretamente desde a Fase 2,
-- coberto por test/authz.e2e-spec.ts) — uma regressão real de RLS sendo
-- MAIS restritivo que o app, não menos, mas ainda assim quebra um papel
-- que já funcionava. Adicionar "manager" ao bypass de papel faz a RLS
-- voltar a ser um no-op pra esse papel (mesmo comportamento de antes
-- desta fatia), deixando o PolicyService como único ponto de decisão
-- pra manager — igual está documentado que deveria ficar por ora.
DROP POLICY IF EXISTS "ws_and_role_select" ON "companies";
CREATE POLICY "ws_and_role_select" ON "companies" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "id" IN (
        SELECT "company_id" FROM "opportunities"
        WHERE "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

DROP POLICY IF EXISTS "ws_and_role_select" ON "opportunities";
CREATE POLICY "ws_and_role_select" ON "opportunities" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS "ws_and_role_select" ON "tasks";
CREATE POLICY "ws_and_role_select" ON "tasks" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "created_by" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );
