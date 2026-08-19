-- Empresa cadastrada em duplicidade por dois representantes diferentes
-- (pedido direto do usuário, 2026-08-06 — exemplo dado: Lauro cadastra
-- "Empresa Modelo", depois Darlã também cadastra a mesma empresa).
-- Decisão confirmada com o usuário: NÃO duplica o registro — reaproveita
-- a mesma Company — e o PERFIL da empresa (razão social/CNPJ/endereço)
-- passa a ser visível pros dois; histórico (activities), tarefas e
-- oportunidades continuam privados de quem os criou (já eram, por
-- ownerUserId/assigneeUserId/actorUserId — nenhuma mudança necessária
-- nessas 3 tabelas). Contatos também ficam vinculados a quem os
-- cadastrou (2ª rodada da mesma pergunta) — antes eram "livres" pra
-- qualquer um que visse a empresa.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

-- ═══════════════════ contacts — dono do registro ═══════════════════
ALTER TABLE "contacts" ADD COLUMN "owner_user_id" UUID;
CREATE INDEX "contacts_workspace_id_owner_user_id_idx" ON "contacts"("workspace_id", "owner_user_id");

DROP POLICY IF EXISTS "workspace_isolation" ON "contacts";

CREATE POLICY "ws_and_role_select" ON "contacts" FOR SELECT
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
    AND (
      NULLIF(current_setting('app.current_role', true), '') IN ('admin', 'owner', 'manager')
      OR "owner_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_insert" ON "contacts" FOR INSERT
  WITH CHECK (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_update" ON "contacts" FOR UPDATE
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

CREATE POLICY "ws_delete" ON "contacts" FOR DELETE
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

-- ═══════════════════ company_access — 2º+ representante ═══════════════════
-- Uma linha por (company, user) que também "trabalha" essa empresa além
-- do owner_user_id original — nunca exposta como endpoint próprio, só
-- lida internamente por CompanyService pra decidir visibilidade (ver
-- policy abaixo em companies e o app-layer em company.service.ts).
CREATE TABLE "company_access" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id"   UUID NOT NULL,
    "user_id"      UUID NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_access_company_id_user_id_key" ON "company_access"("company_id", "user_id");
CREATE INDEX "company_access_workspace_id_idx" ON "company_access"("workspace_id");

ALTER TABLE "company_access" ADD CONSTRAINT "company_access_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sem dado sensível na linha em si (só 3 uuids) — workspace_isolation
-- simples basta, mesmo padrão pré-Fatia9 usado nas outras tabelas antes
-- de ganharem RLS por papel.
ALTER TABLE "company_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_access" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "company_access"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

-- ═══════════════════ companies — estende a policy de leitura ═══════════════════
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
      OR "id" IN (
        SELECT "company_id" FROM "company_access"
        WHERE "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

-- ═══════════════════ find_company_id_by_cnpj — checagem de duplicidade ═══════════════════
-- CompanyService#create precisa saber se um CNPJ já existe no workspace
-- ANTES de decidir se insere ou reaproveita — mas a RLS acima (de
-- propósito) impede um representante de enxergar company de outro dono
-- via SELECT normal, então uma query comum sob a sessão dele sempre
-- voltaria vazia mesmo quando o registro existe (falso negativo, geraria
-- duplicata). Função SECURITY DEFINER criada por quem roda a migration
-- (role privilegiado do Supabase, não app_runtime) bypassa RLS só pra
-- essa checagem pontual — devolve só o id (nunca razão social/endereço/
-- dono), workspace_id continua obrigatório no filtro (não é uma busca
-- cross-tenant). REVOKE FROM PUBLIC + GRANT explícito só pra app_runtime,
-- mesmo cuidado de menor privilégio de sempre.
CREATE OR REPLACE FUNCTION public.find_company_id_by_cnpj(
  p_workspace_id uuid,
  p_cnpj_digits text
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT "id" FROM "companies"
  WHERE "workspace_id" = p_workspace_id
    AND "deleted_at" IS NULL
    AND regexp_replace(COALESCE("cpf_cnpj", ''), '\D', '', 'g') = p_cnpj_digits
    AND p_cnpj_digits <> ''
  ORDER BY "created_at" ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_company_id_by_cnpj(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_company_id_by_cnpj(uuid, text) TO app_runtime;
