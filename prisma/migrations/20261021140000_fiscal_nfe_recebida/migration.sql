-- Console fiscal (2026-10-21) — NF-e RECEBIDAS (emitidas por terceiros
-- contra a Gama, Matriz e Filial), vindas de GET /v1/nfe/recebidas do
-- eGestor. Mesmo molde de fiscal_nfe_emitida/_item, mais fornecedor,
-- manifestação e "lançada como compra". Detalhe em docs/console-fiscal.md.
--
-- Gerado com `prisma migrate diff --from-schema-datasource`, recortado só
-- nos objetos `fiscal_nfe_recebida*`.

-- CreateTable
CREATE TABLE "fiscal_nfe_recebida" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "estabelecimento" "Estabelecimento" NOT NULL,
    "cod_egestor" INTEGER,
    "origem" TEXT NOT NULL DEFAULT 'egestor:/v1/nfe/recebidas',
    "chave" TEXT NOT NULL,
    "numero" INTEGER,
    "serie" INTEGER,
    "modelo" INTEGER,
    "dh_emissao" TIMESTAMP(3),
    "data_emissao" DATE,
    "situacao" TEXT NOT NULL,
    "situacao_egestor" INTEGER,
    "sentido" TEXT,
    "natureza_operacao" TEXT,
    "finalidade" INTEGER,
    "emit_cpf_cnpj" TEXT,
    "emit_nome" TEXT,
    "emit_uf" TEXT,
    "dest_cpf_cnpj" TEXT,
    "manifesto" TEXT,
    "lancada_compra" BOOLEAN NOT NULL DEFAULT false,
    "nsu" TEXT,
    "v_bc" DECIMAL(15,2),
    "v_icms" DECIMAL(15,2),
    "v_icms_deson" DECIMAL(15,2),
    "v_fcp" DECIMAL(15,2),
    "v_bc_st" DECIMAL(15,2),
    "v_st" DECIMAL(15,2),
    "v_fcp_st" DECIMAL(15,2),
    "v_fcp_st_ret" DECIMAL(15,2),
    "v_icms_uf_dest" DECIMAL(15,2),
    "v_fcp_uf_dest" DECIMAL(15,2),
    "v_icms_uf_remet" DECIMAL(15,2),
    "v_prod" DECIMAL(15,2),
    "v_frete" DECIMAL(15,2),
    "v_seg" DECIMAL(15,2),
    "v_desc" DECIMAL(15,2),
    "v_ii" DECIMAL(15,2),
    "v_ipi" DECIMAL(15,2),
    "v_ipi_devol" DECIMAL(15,2),
    "v_pis" DECIMAL(15,2),
    "v_cofins" DECIMAL(15,2),
    "v_outro" DECIMAL(15,2),
    "v_nf" DECIMAL(15,2),
    "v_tot_trib" DECIMAL(15,2),
    "v_bc_ibs_cbs" DECIMAL(15,2),
    "v_ibs" DECIMAL(15,2),
    "v_cbs" DECIMAL(15,2),
    "ref_chaves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inf_cpl" TEXT,
    "xml" TEXT,
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_nfe_recebida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_nfe_recebida_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "nfe_id" UUID NOT NULL,
    "n_item" INTEGER NOT NULL,
    "c_prod" TEXT,
    "x_prod" TEXT,
    "ncm" TEXT,
    "cest" TEXT,
    "cfop" TEXT,
    "u_com" TEXT,
    "q_com" DECIMAL(15,4),
    "v_un_com" DECIMAL(21,10),
    "v_prod" DECIMAL(15,2),
    "v_frete" DECIMAL(15,2),
    "v_seg" DECIMAL(15,2),
    "v_desc" DECIMAL(15,2),
    "v_outro" DECIMAL(15,2),
    "orig_icms" TEXT,
    "cst_icms" TEXT,
    "v_bc_icms" DECIMAL(15,2),
    "p_red_bc" DECIMAL(7,4),
    "p_icms" DECIMAL(7,4),
    "v_icms" DECIMAL(15,2),
    "v_icms_deson" DECIMAL(15,2),
    "v_fcp" DECIMAL(15,2),
    "v_bc_st" DECIMAL(15,2),
    "p_mva_st" DECIMAL(7,4),
    "p_icms_st" DECIMAL(7,4),
    "v_icms_st" DECIMAL(15,2),
    "v_icms_uf_dest" DECIMAL(15,2),
    "v_fcp_uf_dest" DECIMAL(15,2),
    "v_icms_uf_remet" DECIMAL(15,2),
    "cst_ipi" TEXT,
    "c_enq_ipi" TEXT,
    "v_bc_ipi" DECIMAL(15,2),
    "p_ipi" DECIMAL(7,4),
    "v_ipi" DECIMAL(15,2),
    "v_ii" DECIMAL(15,2),
    "cst_pis" TEXT,
    "v_bc_pis" DECIMAL(15,2),
    "p_pis" DECIMAL(7,4),
    "v_pis" DECIMAL(15,2),
    "cst_cofins" TEXT,
    "v_bc_cofins" DECIMAL(15,2),
    "p_cofins" DECIMAL(7,4),
    "v_cofins" DECIMAL(15,2),
    "cst_ibs_cbs" TEXT,
    "c_class_trib" TEXT,
    "v_bc_ibs_cbs" DECIMAL(15,2),
    "p_ibs_uf" DECIMAL(7,4),
    "v_ibs_uf" DECIMAL(15,2),
    "p_ibs_mun" DECIMAL(7,4),
    "v_ibs_mun" DECIMAL(15,2),
    "v_ibs" DECIMAL(15,2),
    "p_cbs" DECIMAL(7,4),
    "v_cbs" DECIMAL(15,2),
    "v_tot_trib" DECIMAL(15,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_nfe_recebida_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_nfe_recebida_workspace_id_data_emissao_idx" ON "fiscal_nfe_recebida"("workspace_id", "data_emissao");

-- CreateIndex
CREATE INDEX "fiscal_nfe_recebida_workspace_id_emit_cpf_cnpj_idx" ON "fiscal_nfe_recebida"("workspace_id", "emit_cpf_cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_nfe_recebida_workspace_id_estabelecimento_chave_key" ON "fiscal_nfe_recebida"("workspace_id", "estabelecimento", "chave");

-- CreateIndex
CREATE INDEX "fiscal_nfe_recebida_item_workspace_id_cfop_idx" ON "fiscal_nfe_recebida_item"("workspace_id", "cfop");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_nfe_recebida_item_nfe_id_n_item_key" ON "fiscal_nfe_recebida_item"("nfe_id", "n_item");

-- AddForeignKey
ALTER TABLE "fiscal_nfe_recebida" ADD CONSTRAINT "fiscal_nfe_recebida_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_nfe_recebida_item" ADD CONSTRAINT "fiscal_nfe_recebida_item_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_nfe_recebida_item" ADD CONSTRAINT "fiscal_nfe_recebida_item_nfe_id_fkey" FOREIGN KEY ("nfe_id") REFERENCES "fiscal_nfe_recebida"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS na mesma migration (docs/seguranca.md, decisão 3.1).
ALTER TABLE "fiscal_nfe_recebida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_nfe_recebida" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "fiscal_nfe_recebida"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

ALTER TABLE "fiscal_nfe_recebida_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_nfe_recebida_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "fiscal_nfe_recebida_item"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
