-- Console fiscal (2026-10-20) — primeiras tabelas do módulo: CFOP com a
-- classificação da Gama, NF-e emitida (cabeçalho + itens) e NFS-e emitida,
-- Matriz e Filial juntas. Origem das notas: API do eGestor. Detalhe em
-- docs/console-fiscal.md.
--
-- Gerado com `prisma migrate diff --from-schema-datasource` e recortado só
-- nos objetos `fiscal_*` (o diff traz drift antigo de outras tabelas, que
-- não é desta mudança). `updated_at` ganhou DEFAULT no banco pra linha
-- inserida/editada direto no Supabase (a tabela de CFOP é editável pelo
-- usuário) não falhar no NOT NULL.

-- CreateTable
CREATE TABLE "fiscal_cfop" (
    "workspace_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT,
    "receita" BOOLEAN NOT NULL DEFAULT false,
    "devolucao" BOOLEAN NOT NULL DEFAULT false,
    "remessa" BOOLEAN NOT NULL DEFAULT false,
    "importacao" BOOLEAN NOT NULL DEFAULT false,
    "transferencia" BOOLEAN NOT NULL DEFAULT false,
    "dev_venda" BOOLEAN NOT NULL DEFAULT false,
    "dev_compra" BOOLEAN NOT NULL DEFAULT false,
    "retorno" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_cfop_pkey" PRIMARY KEY ("workspace_id","codigo")
);

-- CreateTable
CREATE TABLE "fiscal_nfe_emitida" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "estabelecimento" "Estabelecimento" NOT NULL,
    "cod_egestor" INTEGER NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'egestor_api',
    "chave" TEXT,
    "numero" INTEGER,
    "serie" INTEGER,
    "modelo" INTEGER,
    "dh_emissao" TIMESTAMP(3),
    "data_emissao" DATE,
    "situacao" TEXT NOT NULL,
    "situacao_egestor" INTEGER NOT NULL,
    "sentido" TEXT,
    "natureza_operacao" TEXT,
    "finalidade" INTEGER,
    "dest_cpf_cnpj" TEXT,
    "dest_nome" TEXT,
    "dest_uf" TEXT,
    "dest_ind_ie" INTEGER,
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

    CONSTRAINT "fiscal_nfe_emitida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_nfe_emitida_item" (
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

    CONSTRAINT "fiscal_nfe_emitida_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_nfse_emitida" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "estabelecimento" "Estabelecimento" NOT NULL,
    "cod_egestor" INTEGER NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'egestor_api',
    "numero_nfse" INTEGER,
    "numero_rps" INTEGER,
    "serie" TEXT,
    "dh_emissao" TIMESTAMP(3),
    "data_emissao" DATE,
    "situacao" TEXT NOT NULL,
    "situacao_egestor" INTEGER NOT NULL,
    "cod_venda" TEXT,
    "tomador_cpf_cnpj" TEXT,
    "tomador_nome" TEXT,
    "cod_lista_servico" TEXT,
    "valor_bruto" DECIMAL(15,2),
    "valor_liquido" DECIMAL(15,2),
    "v_iss" DECIMAL(15,2),
    "v_inss" DECIMAL(15,2),
    "v_pis" DECIMAL(15,2),
    "v_cofins" DECIMAL(15,2),
    "v_csll" DECIMAL(15,2),
    "v_irrf" DECIMAL(15,2),
    "itens" JSONB NOT NULL DEFAULT '[]',
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_nfse_emitida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_nfe_emitida_workspace_id_data_emissao_idx" ON "fiscal_nfe_emitida"("workspace_id", "data_emissao");

-- CreateIndex
CREATE INDEX "fiscal_nfe_emitida_workspace_id_chave_idx" ON "fiscal_nfe_emitida"("workspace_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_nfe_emitida_workspace_id_estabelecimento_cod_egestor_key" ON "fiscal_nfe_emitida"("workspace_id", "estabelecimento", "cod_egestor");

-- CreateIndex
CREATE INDEX "fiscal_nfe_emitida_item_workspace_id_cfop_idx" ON "fiscal_nfe_emitida_item"("workspace_id", "cfop");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_nfe_emitida_item_nfe_id_n_item_key" ON "fiscal_nfe_emitida_item"("nfe_id", "n_item");

-- CreateIndex
CREATE INDEX "fiscal_nfse_emitida_workspace_id_data_emissao_idx" ON "fiscal_nfse_emitida"("workspace_id", "data_emissao");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_nfse_emitida_workspace_id_estabelecimento_cod_egesto_key" ON "fiscal_nfse_emitida"("workspace_id", "estabelecimento", "cod_egestor");

-- AddForeignKey
ALTER TABLE "fiscal_cfop" ADD CONSTRAINT "fiscal_cfop_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_nfe_emitida" ADD CONSTRAINT "fiscal_nfe_emitida_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_nfe_emitida_item" ADD CONSTRAINT "fiscal_nfe_emitida_item_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_nfe_emitida_item" ADD CONSTRAINT "fiscal_nfe_emitida_item_nfe_id_fkey" FOREIGN KEY ("nfe_id") REFERENCES "fiscal_nfe_emitida"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_nfse_emitida" ADD CONSTRAINT "fiscal_nfse_emitida_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS na mesma migration (docs/seguranca.md, decisão 3.1). Dado fiscal é
-- do workspace inteiro — quem enxerga a TELA é decidido pela permissão do
-- módulo no backend, não por dono da linha.
ALTER TABLE "fiscal_cfop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_cfop" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "fiscal_cfop"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

ALTER TABLE "fiscal_nfe_emitida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_nfe_emitida" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "fiscal_nfe_emitida"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

ALTER TABLE "fiscal_nfe_emitida_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_nfe_emitida_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "fiscal_nfe_emitida_item"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

ALTER TABLE "fiscal_nfse_emitida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_nfse_emitida" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_isolation" ON "fiscal_nfse_emitida"
  USING      ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
