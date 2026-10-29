-- Console fiscal (2026-10-22) — vínculo remessa × retorno feito à mão no
-- Controle de remessas (docs/console-fiscal.md, decisão 7.5). O eGestor
-- não guarda essa ligação; o vínculo automático (retorno que cita a
-- remessa no XML) continua lido da nota e não entra aqui.
--
-- Gerado com `prisma migrate diff --from-schema-datasource`, recortado só
-- nos objetos `fiscal_remessa_vinculo`.

-- CreateTable
CREATE TABLE "fiscal_remessa_vinculo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "remessa_chave" TEXT NOT NULL,
    "retorno_chave" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "alterado_por_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_remessa_vinculo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_remessa_vinculo_acao_check" CHECK ("acao" IN ('vincular', 'desvincular')),
    CONSTRAINT "fiscal_remessa_vinculo_chaves_check" CHECK (
      "remessa_chave" ~ '^[0-9]{44}$' AND "retorno_chave" ~ '^[0-9]{44}$' AND "remessa_chave" <> "retorno_chave"
    )
);

-- CreateIndex
CREATE INDEX "fiscal_remessa_vinculo_workspace_id_retorno_chave_idx" ON "fiscal_remessa_vinculo"("workspace_id", "retorno_chave");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_remessa_vinculo_workspace_id_remessa_chave_retorno_c_key" ON "fiscal_remessa_vinculo"("workspace_id", "remessa_chave", "retorno_chave");

-- AddForeignKey
ALTER TABLE "fiscal_remessa_vinculo" ADD CONSTRAINT "fiscal_remessa_vinculo_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (docs/seguranca.md, decisão 3.1): mesmo isolamento por workspace das
-- outras tabelas fiscal_*, forçado também pro dono da tabela.
ALTER TABLE "fiscal_remessa_vinculo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_remessa_vinculo" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "fiscal_remessa_vinculo"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
