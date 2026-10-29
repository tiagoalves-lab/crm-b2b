-- Console fiscal (2026-10-26) — classificação das notas de entrada
-- (docs/console-fiscal.md, decisão 7.8): cada item de NF-e de entrada
-- recebe uma classificação (revenda, uso e consumo, viagem...), porque no
-- eGestor essas notas não são lançadas ou são lançadas só em parte. Cada
-- mudança é uma linha nova, com quem fez e quando; vale o último registro
-- do item (chave + n_item). Classe nula = classificação retirada. O log
-- não se edita nem se apaga: o app só tem policy de leitura e de inserção.

-- CreateTable
CREATE TABLE "fiscal_entrada_classificacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "n_item" INTEGER NOT NULL,
    "classe" TEXT,
    "observacao" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'tela',
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_entrada_classificacao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_entrada_classificacao_chave_check" CHECK ("chave" ~ '^[0-9]{44}$'),
    CONSTRAINT "fiscal_entrada_classificacao_n_item_check" CHECK ("n_item" BETWEEN 1 AND 990),
    CONSTRAINT "fiscal_entrada_classificacao_classe_check" CHECK ("classe" IN (
      'revenda', 'industrializacao', 'mat-aplic-servico', 'imobilizado',
      'uso-consumo', 'viagem',
      'remessa', 'retorno', 'transferencia', 'devolucao', 'icms',
      'cancelada', 'desconhecimento')),
    CONSTRAINT "fiscal_entrada_classificacao_origem_check" CHECK ("origem" IN ('tela', 'planilha')),
    CONSTRAINT "fiscal_entrada_classificacao_observacao_check" CHECK (char_length("observacao") <= 1000)
);

-- CreateIndex
CREATE INDEX "fiscal_entrada_classificacao_workspace_id_chave_n_item_created_at_idx" ON "fiscal_entrada_classificacao"("workspace_id", "chave", "n_item", "created_at");

-- AddForeignKey
ALTER TABLE "fiscal_entrada_classificacao" ADD CONSTRAINT "fiscal_entrada_classificacao_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (docs/seguranca.md, decisão 3.1): isolamento por workspace, como as
-- outras tabelas fiscal_*, forçado também pro dono da tabela. Só SELECT e
-- INSERT — sem policy de UPDATE/DELETE, o histórico fica imutável pro app.
ALTER TABLE "fiscal_entrada_classificacao" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_entrada_classificacao" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation_select" ON "fiscal_entrada_classificacao" FOR SELECT
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
CREATE POLICY "workspace_isolation_insert" ON "fiscal_entrada_classificacao" FOR INSERT
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
