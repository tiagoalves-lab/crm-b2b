-- Tabela espelho consolidada do eGestor (Matriz + Filial), pedido direto
-- do usuário (2026-08-07) — ver docs/plano-integracao-egestor.md, decisão
-- 2.1/2.2. Objetivo: nunca gravar dado bruto do eGestor direto em
-- `companies` — o pull do eGestor escreve aqui primeiro (uma linha por
-- CNPJ, consolidando Matriz e Filial), e a promoção pra uma Company de
-- verdade é sempre um passo posterior explícito ("sanitização", ainda não
-- implementada nesta migration).
--
-- Mesmo formato do relatório que a Gama já gera fora do CRM (planilha
-- Scrip_AtualizarContatos / script Integrar-bases-egestor.txt, ambos em
-- docs/) — status so_matriz/so_filial/ambos_iguais/ambos_diferentes,
-- dados crus de cada lado em JSON, campos divergentes listados à parte.
--
-- Escrita manual (mesmo motivo já documentado nas migrations anteriores:
-- `prisma migrate diff` pede --shadow-database-url, não configurado neste
-- projeto). Aplicado via `prisma migrate deploy`.

CREATE TYPE "EgestorContatoStatus" AS ENUM ('so_matriz', 'so_filial', 'ambos_iguais', 'ambos_diferentes');

CREATE TABLE "egestor_contatos_consolidado" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"      UUID NOT NULL,
    "cpf_cnpj"          TEXT NOT NULL,
    "status"            "EgestorContatoStatus" NOT NULL,
    "codigo_matriz"     TEXT,
    "codigo_filial"     TEXT,
    "nome_matriz"       TEXT,
    "nome_filial"       TEXT,
    "dados_matriz"      JSONB,
    "dados_filial"      JSONB,
    "campos_diferentes" TEXT[] NOT NULL DEFAULT '{}',
    "company_id"        UUID,
    "last_synced_at"    TIMESTAMP(3) NOT NULL,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "egestor_contatos_consolidado_pkey" PRIMARY KEY ("id")
);

-- Chave de consolidação: um CNPJ nunca aparece duas vezes nesta tabela
-- (Matriz e Filial dividem a mesma linha).
CREATE UNIQUE INDEX "egestor_contatos_consolidado_workspace_id_cpf_cnpj_key" ON "egestor_contatos_consolidado"("workspace_id", "cpf_cnpj");
-- 1:1 com Company quando promovido (fase de sanitização) — nunca duas
-- linhas do espelho apontando pra mesma Company.
CREATE UNIQUE INDEX "egestor_contatos_consolidado_company_id_key" ON "egestor_contatos_consolidado"("company_id");
CREATE INDEX "egestor_contatos_consolidado_workspace_id_status_idx" ON "egestor_contatos_consolidado"("workspace_id", "status");

ALTER TABLE "egestor_contatos_consolidado" ADD CONSTRAINT "egestor_contatos_consolidado_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL (não RESTRICT): se a Company promovida for removida, a linha
-- do espelho só volta a ficar "não promovida" — não trava a exclusão da
-- Company por causa de uma referência de auditoria.
ALTER TABLE "egestor_contatos_consolidado" ADD CONSTRAINT "egestor_contatos_consolidado_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: mesmo padrão simples de sales_history (workspace-scoped, sem
-- policy de papel) — visibilidade por papel fica pra decidir quando a
-- tela de auditoria (Sprint 2) for desenhada, ver
-- docs/plano-integracao-egestor.md.
ALTER TABLE "egestor_contatos_consolidado" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "egestor_contatos_consolidado" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "egestor_contatos_consolidado"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
