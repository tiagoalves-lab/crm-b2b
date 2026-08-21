-- Estabelecimento (enum) + origem/vendedor em `sales_history` — card
-- "Migration: Estabelecimento enum + SalesHistory.estabelecimento" da raia
-- Vendas histórico.
--
-- Problema que resolve: até aqui a tabela guardava a venda sem dizer de
-- QUAL conta do eGestor ela veio. O código da venda é numeração por conta
-- (ver docs/api-egestor-vendas.md) — sem a origem, a venda 447 da Matriz e
-- a 447 da Filial são indistinguíveis, e reimportar duplicaria tudo. A
-- chave única (workspace, estabelecimento, cod_venda) é o que torna a
-- carga e o webhook idempotentes.
--
-- Vendedor: o cadastro de contato do eGestor não diz quem atende o
-- cliente; essa informação só existe na venda (`codVendedor`), e o nome/
-- e-mail correspondente vem de `GET /v1/usuarios`. Fica gravado NA VENDA,
-- não em `companies.owner_user_id` — de propósito: quem enxerga qual
-- empresa é decisão de carteira (diretriz de acesso do representante), e
-- não pode ser efeito colateral de um import de histórico.
-- `vendedor_user_id` é nullable: vendedor do eGestor sem membro
-- correspondente no CRM (ex.: quem já saiu) mantém a venda com o nome
-- original em `vendedor_nome`, sem inventar dono.
--
-- Colunas nascem NOT NULL sem backfill porque a tabela está VAZIA em
-- produção nos dois workspaces (conferido antes de escrever esta
-- migration; o dado de 2026-08-01 foi zerado junto com o resto da base em
-- 2026-08-06 — ver regra 5.2 de docs/regras-de-negocio.md).
--
-- Escrita manual (mesmo motivo das migrations anteriores: `prisma migrate
-- diff` pede --shadow-database-url, não configurado neste projeto).
-- Aplicada via `prisma migrate deploy`.

CREATE TYPE "Estabelecimento" AS ENUM ('matriz', 'filial');

ALTER TABLE "sales_history"
  ADD COLUMN "estabelecimento"  "Estabelecimento" NOT NULL,
  ADD COLUMN "cod_vendedor"     TEXT,
  ADD COLUMN "vendedor_nome"    TEXT,
  ADD COLUMN "vendedor_user_id" UUID;

-- `cod_venda` nasceu nullable (import de planilha de 2026-08-01, que nem
-- sempre trazia o código). Agora é chave de idempotência: toda venda vem
-- da API e sempre tem código.
ALTER TABLE "sales_history" ALTER COLUMN "cod_venda" SET NOT NULL;

CREATE UNIQUE INDEX "sales_history_workspace_id_estabelecimento_cod_venda_key"
  ON "sales_history"("workspace_id", "estabelecimento", "cod_venda");

-- RLS já está ligada na tabela desde 20260801230000_sales_history
-- (policy "workspace_isolation", área comum do workspace). Coluna nova em
-- tabela existente não muda policy — quem restringe o representante é a
-- permissão "Pós-venda" (empresas_posvenda), não a RLS.
