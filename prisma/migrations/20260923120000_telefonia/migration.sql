-- Telefonia (2026-09-23, docs/telefonia-crm.md) — chamadas do SDR pela
-- linha BR DID + credencial do computador que roda o script do MicroSIP.
-- Ver os comentários dos models em prisma/schema.prisma.
--
-- Escrita manual, mesmo motivo das anteriores: `prisma migrate diff` pede
-- --shadow-database-url, não configurado neste projeto. Aplicada via
-- `prisma migrate deploy`.

CREATE TYPE "CallDirecao" AS ENUM ('saida', 'entrada');
CREATE TYPE "CallResultado" AS ENUM ('atendida', 'nao_atendida', 'cancelada');

CREATE TABLE "calls" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"      UUID NOT NULL,
    "user_id"           UUID NOT NULL,
    "company_id"        UUID,
    "contact_id"        UUID,
    "raw_lead_id"       UUID,
    "task_id"           UUID,
    "telefone"          TEXT NOT NULL,
    "telefone_exibicao" TEXT,
    "direcao"           "CallDirecao" NOT NULL DEFAULT 'saida',
    "resultado"         "CallResultado",
    "iniciada_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atendida_em"       TIMESTAMP(3),
    "encerrada_em"      TIMESTAMP(3),
    "duracao_segundos"  INTEGER,
    "observacao"        TEXT,
    "activity_id"       UUID,
    "criada_em"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "calls_workspace_id_user_id_telefone_iniciada_em_idx"
  ON "calls"("workspace_id", "user_id", "telefone", "iniciada_em");
CREATE INDEX "calls_workspace_id_company_id_iniciada_em_idx"
  ON "calls"("workspace_id", "company_id", "iniciada_em");

ALTER TABLE "calls" ADD CONSTRAINT "calls_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Empresa/contato sem CASCADE, mesmo critério de Activity.contactId: não é
-- óbvio o que fazer com o histórico de ligação se o cadastro sumir, então o
-- Postgres bloqueia a exclusão em vez de decidir sozinho.
ALTER TABLE "calls" ADD CONSTRAINT "calls_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "telefonia_dispositivos" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"  UUID NOT NULL,
    "user_id"       UUID NOT NULL,
    "nome"          TEXT NOT NULL,
    "token_hash"    TEXT NOT NULL,
    "ultimo_uso_em" TIMESTAMP(3),
    "revogado_em"   TIMESTAMP(3),
    "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telefonia_dispositivos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telefonia_dispositivos_token_hash_key"
  ON "telefonia_dispositivos"("token_hash");
CREATE INDEX "telefonia_dispositivos_workspace_id_user_id_idx"
  ON "telefonia_dispositivos"("workspace_id", "user_id");

ALTER TABLE "telefonia_dispositivos" ADD CONSTRAINT "telefonia_dispositivos_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS na mesma migration (regra do projeto). Isolamento por workspace, como
-- o resto do sistema; o recorte "cada representante só vê as próprias
-- chamadas" é feito no service (CallService), mesmo padrão de Task/Company —
-- RLS isola workspace contra workspace, não usuário contra usuário.
ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calls" FORCE ROW LEVEL SECURITY;

CREATE POLICY "workspace_isolation_select" ON "calls" FOR SELECT
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_insert" ON "calls" FOR INSERT
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_update" ON "calls" FOR UPDATE
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_delete" ON "calls" FOR DELETE
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

-- Credencial de máquina: mesmo isolamento. Sem policy de UPDATE pra
-- token_hash mudar de dono — revogar é UPDATE em revogado_em, então UPDATE
-- existe, mas o service nunca reescreve o hash (gerar de novo cria linha
-- nova). Quem pode gerar/revogar é decidido no controller (owner/admin, ou
-- o próprio dono do token).
ALTER TABLE "telefonia_dispositivos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telefonia_dispositivos" FORCE ROW LEVEL SECURITY;

CREATE POLICY "workspace_isolation_select" ON "telefonia_dispositivos" FOR SELECT
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_insert" ON "telefonia_dispositivos" FOR INSERT
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_update" ON "telefonia_dispositivos" FOR UPDATE
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_delete" ON "telefonia_dispositivos" FOR DELETE
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
