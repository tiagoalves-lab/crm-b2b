-- "Carteira" por representante na Prospecção (pedido direto do usuário,
-- 2026-08-06, reportado como bug real: um sales_rep — Lauro — estava
-- enxergando leads/empresas importadas por outro membro — Arlei, gerente).
-- Reverte a decisão explícita do SPEC-CRM-GAMA.md §7.5 de que raw_leads é
-- "área comum" sem policy de papel (ver comentário no fim de
-- 20260731200000_role_based_rls_policies/migration.sql) — o usuário quer
-- exatamente o oposto agora: cada representante só vê o que ele mesmo
-- importou/cadastrou; gerente vê o próprio + o dos subordinados (mesma
-- hierarquia já usada em companies/opportunities/tasks); admin/owner veem
-- tudo.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "raw_leads" ADD COLUMN "owner_user_id" UUID;
CREATE INDEX "raw_leads_workspace_id_owner_user_id_idx" ON "raw_leads"("workspace_id", "owner_user_id");

-- Troca a policy única "workspace_isolation" (FOR ALL) por leitura
-- restrita + escrita workspace-scoped — mesmo padrão exato de
-- companies/opportunities/tasks (20260731200000 + 20260731220000
-- combinadas aqui numa só, já incluindo manager no bypass desde o
-- início, sem precisar de uma segunda migration de correção depois).
DROP POLICY IF EXISTS "workspace_isolation" ON "raw_leads";

CREATE POLICY "ws_and_role_select" ON "raw_leads" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "raw_leads" FOR INSERT
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_update" ON "raw_leads" FOR UPDATE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE POLICY "ws_delete" ON "raw_leads" FOR DELETE
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
