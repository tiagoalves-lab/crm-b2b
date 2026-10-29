-- Console fiscal (2026-10-26) — log dos alertas do Controle de remessas
-- (docs/console-fiscal.md, decisão 7.7): marcar um alerta como tratado ou
-- reabri-lo grava uma linha, com quem fez, quando e a observação. O log
-- não se edita nem se apaga: o app só tem policy de leitura e de inserção.

-- CreateTable
CREATE TABLE "fiscal_remessa_alerta_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "remessa_chave" TEXT NOT NULL,
    "regra" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "observacao" TEXT,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_remessa_alerta_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_remessa_alerta_log_acao_check" CHECK ("acao" IN ('tratar', 'reabrir')),
    CONSTRAINT "fiscal_remessa_alerta_log_chave_check" CHECK ("remessa_chave" ~ '^[0-9]{44}$'),
    CONSTRAINT "fiscal_remessa_alerta_log_regra_check" CHECK ("regra" ~ '^[a-z0-9-]{1,60}$'),
    CONSTRAINT "fiscal_remessa_alerta_log_observacao_check" CHECK (char_length("observacao") <= 1000)
);

-- CreateIndex
CREATE INDEX "fiscal_remessa_alerta_log_workspace_id_remessa_chave_created_at_idx" ON "fiscal_remessa_alerta_log"("workspace_id", "remessa_chave", "created_at");

-- AddForeignKey
ALTER TABLE "fiscal_remessa_alerta_log" ADD CONSTRAINT "fiscal_remessa_alerta_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (docs/seguranca.md, decisão 3.1): isolamento por workspace, como as
-- outras tabelas fiscal_*, forçado também pro dono da tabela. Só SELECT e
-- INSERT — sem policy de UPDATE/DELETE, o log fica imutável pro app.
ALTER TABLE "fiscal_remessa_alerta_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_remessa_alerta_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation_select" ON "fiscal_remessa_alerta_log" FOR SELECT
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
CREATE POLICY "workspace_isolation_insert" ON "fiscal_remessa_alerta_log" FOR INSERT
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
