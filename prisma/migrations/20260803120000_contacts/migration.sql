-- Feature nova, fora do SPEC-CRM-GAMA.md original (pedida à parte): agenda
-- de contatos (pessoas) de uma empresa, editável na ficha de Empresas e
-- reaproveitada na ficha de Leads (todo RawLead já nasce com
-- promoted_company_id apontando pra uma Company — ver comentário em
-- RawLead no schema —, então a ficha de Leads só reusa companyId, sem FK
-- própria em raw_leads).
--
-- Não é o mesmo Contact removido em 20260728130000_drop_contacts_expand_company
-- (aquele era "dono do cadastro" PF/PJ, virou campos de Company); este é
-- uma lista de pessoas dentro da empresa, 0..N por company.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TABLE "contacts" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id"   UUID NOT NULL,
    "nome"         TEXT NOT NULL,
    "cargo"        TEXT,
    "email"        TEXT,
    "telefone"     TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contacts_workspace_id_company_id_idx" ON "contacts"("workspace_id", "company_id");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS por subquery em company_id -> companies.workspace_id, mesmo padrão
-- de opportunity_comments/opportunity_attachments
-- (20260802000000_opportunity_attachments_comments): não replica a policy
-- de papel de "companies" (ws_and_role_select, Fatia 9) explicitamente
-- aqui, mas herda o mesmo filtro por papel de qualquer jeito — o
-- subselect roda contra a própria tabela "companies", então o Postgres
-- aplica a RLS dela (incluindo o filtro por owner_user_id/role) antes de
-- devolver as linhas pro IN (...). Um operador que não enxerga a company
-- pela policy dela também não enxerga os contacts dela por tabela.
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "contacts"
  USING (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  )
  WITH CHECK (
    "company_id" IN (
      SELECT "id" FROM "companies"
      WHERE "workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid
    )
  );
