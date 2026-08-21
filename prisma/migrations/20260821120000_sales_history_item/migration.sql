-- Itens da venda (produto/serviço) — base das abas "ABC de Produtos" e
-- "Serviços" da ficha da empresa (pedido do usuário, 2026-08-21).
--
-- Por que tabela nova e não coluna em `sales_history`: uma venda tem N
-- itens, e a pergunta que as abas respondem ("quais produtos esta empresa
-- compra, em que volume") é por ITEM, não por venda.
--
-- Fonte do dado: POST /v1/relatorios/vendasDetalhadas (carga completa) e
-- o array `produtos` de GET /v1/vendas/{codigo} (webhook, uma venda por
-- vez). Os dois trazem os mesmos números — conferido contra a API real em
-- 2026-08-21: no relatório, `venda` e `custo` do item já são TOTAIS
-- (quantidade × unitário); no detalhe vêm unitários (`preco`, `custo`) e
-- são multiplicados aqui.
--
-- `ON DELETE CASCADE` no vínculo com a venda é o que mantém as duas
-- tabelas coerentes: a sincronização apaga e regrava as vendas do lado
-- que respondeu, e os itens vão junto sem passo extra.
--
-- Escrita manual (mesmo motivo das anteriores: `prisma migrate diff` pede
-- --shadow-database-url, não configurado). Aplicada via `prisma migrate deploy`.

CREATE TYPE "TipoItemVenda" AS ENUM ('produto', 'servico');

CREATE TABLE "sales_history_item" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"     UUID NOT NULL,
    "sales_history_id" UUID NOT NULL,
    -- Desnormalizado da venda de propósito: toda consulta das abas novas é
    -- "itens desta empresa", e sem isto cada uma viraria um join.
    "company_id"       UUID NOT NULL,
    "tipo"             "TipoItemVenda" NOT NULL,
    "cod_produto"      TEXT,
    "descricao"        TEXT NOT NULL,
    "quantidade"       DECIMAL(14,4) NOT NULL,
    "valor_total"      DECIMAL(14,2) NOT NULL,
    "custo_total"      DECIMAL(14,2),
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_history_item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_history_item_workspace_id_idx" ON "sales_history_item"("workspace_id");
CREATE INDEX "sales_history_item_company_id_tipo_idx" ON "sales_history_item"("company_id", "tipo");
CREATE INDEX "sales_history_item_sales_history_id_idx" ON "sales_history_item"("sales_history_id");

ALTER TABLE "sales_history_item" ADD CONSTRAINT "sales_history_item_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_history_item" ADD CONSTRAINT "sales_history_item_sales_history_id_fkey" FOREIGN KEY ("sales_history_id") REFERENCES "sales_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_history_item" ADD CONSTRAINT "sales_history_item_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mesma policy de `sales_history`: área comum do workspace, sem dono e
-- sem papel (quem restringe é a permissão do módulo, não a RLS).
ALTER TABLE "sales_history_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_history_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "sales_history_item"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
