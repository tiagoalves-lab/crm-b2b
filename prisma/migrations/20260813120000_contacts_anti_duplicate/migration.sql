-- Contato duplicado por clique duplo (relatado pelo usuário, 2026-08-13:
-- "clico para inserir um contato, demora para responder, clico de novo e
-- aparece o registro duplicado").
--
-- A correção principal é de interface (o botão passa a desabilitar
-- enquanto a ação corre — web/app/_components/submit-button.tsx). Este
-- índice é a defesa em profundidade: cobre o que a UI não cobre — duas
-- abas abertas, rede instável reenviando o POST, ou dois usuários
-- gravando o mesmo contato ao mesmo tempo.
--
-- ─── Por que a chave é o registro INTEIRO, e não (empresa, nome) ───
--
-- A primeira ideia era "um nome por empresa". O dado real de produção
-- desmentiu: existe um caso de duas pessoas com o mesmo nome, na mesma
-- empresa, cadastradas pelo mesmo representante com QUATRO DIAS de
-- intervalo e com e-mail e telefone diferentes. São homônimos legítimos
-- (nada raro no Brasil), não duplicata — um índice por nome passaria a
-- recusar cadastro de gente que existe.
--
-- Então a chave é: mesma empresa + mesmo dono + mesmo nome + mesmo e-mail
-- + mesmo telefone + mesmo cargo. Dois registros idênticos em tudo isso
-- são necessariamente o mesmo clique contado duas vezes; qualquer campo
-- diferente é tratado como pessoa diferente e passa. Verificado em
-- 2026-08-13 contra a base de produção: 0 conflitos com os 2.158 contatos
-- existentes.
--
-- Normalizações embutidas na chave, pra "duplicata com maquiagem" também
-- cair: caixa e espaço em nome/e-mail/cargo, e pontuação no telefone
-- ((11) 99999-9999 e 11999999999 contam como o mesmo número).
--
-- `owner_user_id` entra na chave porque contato é escopado por
-- representante (ver Contact.ownerUserId em schema.prisma): dois
-- representantes que atendem a mesma empresa não enxergam os contatos um
-- do outro, então bloquear entre eles produziria um erro impossível de
-- entender ("já existe" para um registro invisível). COALESCE porque a
-- coluna é nullable e NULL nunca colide consigo mesmo em índice único.
--
-- Nome vazio NÃO é excluído do índice: 491 contatos importados do eGestor
-- estão sem nome mas COM e-mail/telefone (dado real, não lixo) — a chave
-- completa dá conta deles pelos outros campos.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

CREATE UNIQUE INDEX "contacts_no_exact_duplicate"
  ON "contacts" (
    "company_id",
    COALESCE("owner_user_id", '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(COALESCE("nome", ''))),
    lower(btrim(COALESCE("email", ''))),
    regexp_replace(COALESCE("telefone", ''), '\D', '', 'g'),
    lower(btrim(COALESCE("cargo", '')))
  );
