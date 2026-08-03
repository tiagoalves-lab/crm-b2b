-- SalesHistory (sales_history) — histórico de vendas importado de sistema
-- externo (eGestor), a pedido do usuário (2026-08-01): as 100 empresas
-- importadas anteriormente já tinham a tag "cliente" corretamente, mas o
-- selo Lead/Cliente e o LTV da tela Empresas são calculados só a partir de
-- Opportunity "ganha" — como o import anterior não criou Opportunity
-- nenhuma, todas apareciam como "Lead" mesmo sendo clientes reais.
--
-- Decisão do usuário: não fabricar Opportunity pra fechar essa conta —
-- oportunidades no pipeline continuam vindo só do funil de vendas de
-- verdade. Este histórico de vendas fica numa tabela própria, sem dono
-- (ownerUserId não se aplica), só pra alimentar LTV/última compra/selo
-- Cliente.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TABLE "sales_history" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "company_id"   UUID NOT NULL,
    "cod_venda"    TEXT,
    "dt_venda"     DATE NOT NULL,
    "valor_total"  DECIMAL(14,2) NOT NULL,
    "situacao_os"  TEXT,
    "fonte"        TEXT NOT NULL DEFAULT 'egestor',
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_history_workspace_id_idx" ON "sales_history"("workspace_id");
CREATE INDEX "sales_history_company_id_idx" ON "sales_history"("company_id");

ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sem conceito de dono/papel (histórico só-leitura pro workspace inteiro,
-- mesmo padrão de raw_leads: "área comum", sem policy de papel).
ALTER TABLE "sales_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "sales_history"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
