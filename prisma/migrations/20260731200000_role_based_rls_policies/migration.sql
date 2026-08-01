-- SPEC-CRM-GAMA.md §7.5 — RLS por papel (Admin vê tudo do workspace,
-- Operador vê só o que é dele) em opportunities/tasks/companies. Camada
-- separada do isolamento por workspace_id (que já existia e continua) —
-- app.current_user_id/app.current_role já são injetados pelo
-- TenantContextService desde a migration anterior a esta (mesmo ponto
-- que injeta app.current_workspace_id).
--
-- Pré-requisito não-negociável (spec): as policies só entram DEPOIS do
-- app já injetar os dois settings — checado manualmente antes de aplicar
-- esta migration (rodar a suíte e2e inteira sem policy de papel primeiro).
--
-- DESVIO DELIBERADO do SQL literal do spec: o rascunho do §7.5 propõe
-- "ws_write ... FOR ALL" ao lado de "ws_and_role_select ... FOR SELECT".
-- Isso não funciona — policies permissivas do Postgres se combinam com
-- OR por comando, e FOR ALL cobre SELECT também. Um "ws_write FOR ALL"
-- que só verifica workspace_id (sem checar papel/posse) faria SELECT
-- enxergar o workspace inteiro de novo pra QUALQUER operador, anulando
-- a policy de leitura restrita. Corrigido aqui separando escrita em
-- INSERT/UPDATE/DELETE explícitos (sem cobrir SELECT), mantendo a
-- intenção do spec (escrita segue só workspace-scoped, leitura é que
-- ganha o filtro de papel).

-- ================= OPORTUNIDADES =================
DROP POLICY IF EXISTS "workspace_isolation" ON "opportunities";

CREATE POLICY "ws_and_role_select" ON "opportunities" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "opportunities" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "opportunities" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "opportunities" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ================= TAREFAS =================
DROP POLICY IF EXISTS "workspace_isolation" ON "tasks";

CREATE POLICY "ws_and_role_select" ON "tasks" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "tasks" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "tasks" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "tasks" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ================= EMPRESAS =================
-- Operador só vê company que tem ao menos uma opportunity dele — leads em
-- triagem (tag lead-triagem) não têm opportunity nenhuma ainda, então
-- ficam invisíveis pra operador por esta policy até virarem oportunidade;
-- a tela de Leads não passa por "companies", lê raw_leads direto (sem
-- policy de papel — área comum, ver nota no fim deste arquivo), então
-- não é afetada.
DROP POLICY IF EXISTS "workspace_isolation" ON "companies";

CREATE POLICY "ws_and_role_select" ON "companies" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "id" IN (
        SELECT "company_id" FROM "opportunities"
        WHERE "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

CREATE POLICY "ws_insert" ON "companies" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "companies" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "companies" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ================= LEADS (raw_leads) — SEM MUDANÇA =================
-- Confirmado explicitamente pelo spec (§7.5): raw_leads NÃO recebe
-- policy de papel — permanece com o workspace_isolation puro (todos do
-- workspace veem), a triagem é área comum. Nenhuma alteração aqui —
-- comentário só documenta a decisão de propósito, pra quem ler esta
-- migration não achar que foi esquecido.
