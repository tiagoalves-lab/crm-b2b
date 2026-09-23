-- Aba "Equipe de vendas" da ficha do lead (pedido direto do usuário,
-- 2026-09-21): incluir um representante na equipe da empresa passa a
-- fazer o LEAD dela aparecer na Prospecção dele também — sem isto a aba
-- salvaria a equipe e a tela continuaria vazia pro incluído (a RLS de
-- raw_leads só conhece owner_user_id, ver 20260806180000).
--
-- Só AMPLIA a policy de SELECT (um OR a mais): nenhum papel perde
-- visibilidade do que já enxergava. Gerente segue no bypass por cargo,
-- como estava (decisão confirmada com o usuário nesta mesma data).
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

DROP POLICY IF EXISTS "ws_and_role_select" ON "raw_leads";

CREATE POLICY "ws_and_role_select" ON "raw_leads" FOR SELECT
  USING (
    "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "promoted_company_id" IN (
        SELECT "company_id" FROM "company_access"
        WHERE "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

-- A subquery acima filtra company_access por user_id em toda leitura de
-- lead — sem índice por user_id ela varre a tabela inteira (hoje o único
-- índice é por workspace_id + o unique (company_id, user_id), que não
-- serve pra busca só por user_id).
CREATE INDEX IF NOT EXISTS "company_access_user_id_idx" ON "company_access"("user_id");
