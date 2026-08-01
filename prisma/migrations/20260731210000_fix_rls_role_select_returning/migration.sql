-- Corrige um bug real descoberto rodando a suíte e2e inteira depois de
-- 20260731200000_role_based_rls_policies: toda escrita via Prisma usa
-- RETURNING (é como .create()/.update() devolvem o objeto criado), e o
-- Postgres exige que a linha devolvida também satisfaça a policy de
-- SELECT da tabela — não só o WITH CHECK do INSERT/UPDATE. Se a policy
-- de SELECT não cobrir a linha recém-escrita, o comando inteiro falha
-- com "new row violates row-level security policy" (SQLSTATE 42501),
-- mesmo que o WITH CHECK tivesse aprovado a escrita.
--
-- companies: a policy anterior só considerava "empresa vinculada a uma
-- oportunidade do operador" (texto literal do spec §7.5). Mas Company
-- também tem seu próprio owner_user_id (usado pelo PolicyService da
-- Fase 2 desde sempre, companies/company.service.ts) e é perfeitamente
-- normal cadastrar uma empresa ANTES de qualquer oportunidade existir
-- (a tela Empresas inteira funciona assim). Sem essa OR, o INSERT de
-- CompanyController#create feito por um sales_rep falhava sempre.
DROP POLICY IF EXISTS "ws_and_role_select" ON "companies";
CREATE POLICY "ws_and_role_select" ON "companies" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "id" IN (
        SELECT "company_id" FROM "opportunities"
        WHERE "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

-- tasks: TaskService.create() aceita assigneeUserId explícito diferente
-- de quem está criando (ex.: reatribuir na tela de detalhe, ver
-- web/app/dashboard/tarefas/task-detail.tsx, campo "Responsável") — se
-- quem criou/editou não for o novo assignee nem admin/owner, o mesmo
-- problema de RETURNING acontece. Adiciona created_by como caminho
-- alternativo de visibilidade (quem criou sempre pode ver o que criou).
DROP POLICY IF EXISTS "ws_and_role_select" ON "tasks";
CREATE POLICY "ws_and_role_select" ON "tasks" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner')
      OR "assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "created_by" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- opportunities: NÃO alterada — OpportunityService.create() sempre fixa
-- ownerUserId = quem está criando por padrão (nenhum caminho do
-- frontend hoje permite setar dono diferente na criação), então o
-- owner_user_id da linha sempre bate com app.current_user_id de quem
-- fez o INSERT. Sem o mesmo problema de RETURNING.
