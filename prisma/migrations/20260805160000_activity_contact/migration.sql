-- Contato vinculado ao registro manual da Timeline (activities) — pedido
-- direto do usuário, 2026-08-05, fora do SPEC-CRM-GAMA.md original.
-- Obrigatório (checado em ActivityService, não aqui) quando
-- payload->>'subtipo' é ligação/reunião/visita/e-mail — mesma regra já
-- aplicada em tasks.contact_id (task_contact_reuniao). Sem
-- ON DELETE CASCADE por padrão do Postgres: não é óbvio o que fazer com o
-- registro histórico se o contato for removido depois, então bloqueia em
-- vez de apagar/desvincular silenciosamente.
--
-- Escrita manual (mesmo motivo de sempre: `prisma migrate diff` exige
-- --shadow-database-url, não configurado neste projeto). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "activities" ADD COLUMN "contact_id" UUID REFERENCES "contacts"("id");
