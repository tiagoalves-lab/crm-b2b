-- Autor externo do comentário espelhado (pedido do usuário, 2026-09-04).
--
-- A mensagem trazida do Trello nasce com `author_user_id` = sentinela de
-- sistema (quem escreveu lá não é usuário do CRM), e a tela mostrava o id
-- cru: "00000000…". O nome do autor ficava embutido no texto, como
-- prefixo "Trello · Fulano:".
--
-- Passa a ter coluna própria: a tela mostra o nome de quem escreveu, o
-- texto fica só com a mensagem, e continua explícito que veio de fora
-- (o autor não é um membro do CRM).
--
-- Escrita manual (mesmo motivo das migrations anteriores). Aditiva.

ALTER TABLE "opportunity_comments" ADD COLUMN "external_author" TEXT;

-- Backfill das mensagens já espelhadas: tira o prefixo do texto e joga o
-- nome na coluna nova. Só mexe em linha espelhada (external_ref não nulo)
-- que tenha o prefixo — comentário escrito por gente no CRM fica intacto.
UPDATE "opportunity_comments"
   SET "external_author" = split_part(substring("body" from 11), E':\n', 1),
       "body"            = substring(
                             "body"
                             from position(E':\n' in "body") + 2
                           )
 WHERE "external_ref" IS NOT NULL
   AND "body" LIKE E'Trello · %:\n%';

-- Mensagem espelhada sem autor identificado no Trello: só tira o prefixo.
UPDATE "opportunity_comments"
   SET "body" = substring("body" from 9)
 WHERE "external_ref" IS NOT NULL
   AND "body" LIKE E'Trello:\n%';
