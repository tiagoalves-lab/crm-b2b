-- Telefonia (2026-10-27, docs/telefonia-crm.md, decisão 1.7) — transcrição
-- e resumo das gravações, feitos no servidor pelo Groq (Whisper para o
-- texto, gpt-oss para separar as falas e resumir). Colunas na própria
-- call_recordings: uma transcrição por gravação, e a tabela já tem RLS
-- (SELECT/INSERT/UPDATE por workspace, migration 20261026180000). Nenhuma
-- tela lê isto ainda — o lugar de leitura é decisão pendente do usuário.
--
-- Escrita manual, mesmo motivo das anteriores (sem shadow database).

ALTER TABLE "call_recordings"
  ADD COLUMN "transcricao_status"     TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN "transcricao_tentativas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transcricao_erro"       TEXT,
  ADD COLUMN "transcrita_em"          TIMESTAMP(3),
  ADD COLUMN "duracao_segundos"       INTEGER,
  ADD COLUMN "transcricao"            TEXT,
  ADD COLUMN "falas"                  JSONB,
  ADD COLUMN "resumo"                 JSONB;

ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_transcricao_status_check"
  CHECK ("transcricao_status" IN ('pendente', 'concluida', 'sem_fala', 'erro'));

-- A fila do agendador é "pendentes, da mais antiga para a mais nova".
CREATE INDEX "call_recordings_transcricao_pendente_idx"
  ON "call_recordings"("gravado_em")
  WHERE "transcricao_status" = 'pendente';
