-- Telefonia (2026-10-26, docs/telefonia-crm.md, decisões 1.6 e 1.8) —
-- gravação das ligações da SDR. O MicroSIP grava a chamada atendida no PC,
-- o script da máquina envia o arquivo ao backend (POST /telefonia/gravacoes)
-- e o áudio vai para um bucket PRIVADO. Nenhuma tela lê esta tabela nem o
-- bucket: a gravação existe só no servidor.
--
-- Escrita manual, mesmo motivo das anteriores (sem shadow database).

-- CreateTable
CREATE TABLE "call_recordings" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"   UUID NOT NULL,
    "user_id"        UUID NOT NULL,
    "device_id"      UUID NOT NULL,
    "call_id"        UUID,
    "arquivo_nome"   TEXT NOT NULL,
    "telefone"       TEXT,
    "gravado_em"     TIMESTAMP(3) NOT NULL,
    "tamanho_bytes"  INTEGER NOT NULL,
    "formato"        TEXT NOT NULL,
    "storage_path"   TEXT NOT NULL,
    "criado_em"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "call_recordings_formato_check" CHECK ("formato" IN ('mp3', 'wav')),
    CONSTRAINT "call_recordings_arquivo_nome_check" CHECK ("arquivo_nome" ~ '^[A-Za-z0-9_+-]{1,200}\.(mp3|wav)$'),
    CONSTRAINT "call_recordings_tamanho_check" CHECK ("tamanho_bytes" > 0)
);

-- Reenvio do mesmo arquivo (o script apagou o local depois de enviar e
-- falhou, ou duas execuções pegaram o mesmo arquivo) não duplica: o nome
-- que o MicroSIP dá já traz data, hora e número.
CREATE UNIQUE INDEX "call_recordings_workspace_id_user_id_arquivo_nome_key"
  ON "call_recordings"("workspace_id", "user_id", "arquivo_nome");
CREATE INDEX "call_recordings_call_id_idx" ON "call_recordings"("call_id");

-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_call_id_fkey"
  FOREIGN KEY ("call_id") REFERENCES "calls"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS na mesma migration (docs/seguranca.md, decisão 3.1). SELECT, INSERT e
-- UPDATE (casar a gravação com a ligação depois); sem DELETE por enquanto —
-- a rotina de retenção entra junto com a transcrição.
ALTER TABLE "call_recordings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_recordings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "workspace_isolation_select" ON "call_recordings" FOR SELECT
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_insert" ON "call_recordings" FOR INSERT
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_update" ON "call_recordings" FOR UPDATE
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid)
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

-- Bucket privado dos áudios. Sem policy em storage.objects para ele: só a
-- service role do backend lê e escreve; anon/authenticated (a chave que o
-- navegador conhece) não alcançam nada. 50 MB por arquivo (~3 h de MP3).
INSERT INTO storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES ('gravacoes', 'gravacoes', false, 52428800, ARRAY['audio/mpeg', 'audio/wav'])
ON CONFLICT ("id") DO NOTHING;
