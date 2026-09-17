-- Publicação de anexo do card de Oportunidade (pedido do usuário,
-- 2026-09-15): arquivo enviado por owner/admin nasce RESERVADO — só
-- owner/admin enxergam — e só passa a valer pra gerente e representante
-- quando alguém de owner/admin publica. Arquivo enviado por gerente ou
-- representante já nasce publicado (não há nada a esconder de quem já
-- enxerga tudo acima dele). Publicar não tem volta: pra tirar da vista
-- de novo, exclui-se o anexo e envia-se outro.
--
-- NULL = reservado; data = publicado (e quando). Guardar a data em vez
-- de um booleano deixa o "quando virou público" auditável sem tabela
-- nova.
--
-- Sem RLS nova: a tabela já tem a policy "workspace_isolation"
-- (20260802000000_opportunity_attachments_comments) e a regra por papel
-- mora no service (OpportunityAttachmentService), mesmo padrão do resto
-- do módulo.
--
-- Escrita manual (mesmo motivo das anteriores: `prisma migrate diff`
-- pede --shadow-database-url, não configurado aqui). Aplicada via
-- `prisma migrate deploy`.

ALTER TABLE "opportunity_attachments" ADD COLUMN "published_at" TIMESTAMP(3);

-- Todo anexo que já existe hoje está visível pra todo mundo que enxerga
-- a oportunidade. Sem este backfill, a mudança esconderia arquivo antigo
-- de gerente e representante do nada.
UPDATE "opportunity_attachments" SET "published_at" = "created_at";
