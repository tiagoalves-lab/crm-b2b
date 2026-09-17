-- Prazo SLA da proposta (pedido do usuário, 2026-09-16): data própria pra
-- monitorar o SLA, separada da previsão de fechamento — que passa a ser só
-- do representante, pra organizar a negociação com o cliente.
--
-- Sem RLS nova: coluna em tabela que já tem a policy de isolamento por
-- workspace.
--
-- Escrita manual (mesmo motivo das anteriores: `prisma migrate diff`
-- pede --shadow-database-url, não configurado aqui). Aplicada via
-- `prisma migrate deploy`.

ALTER TABLE "opportunities" ADD COLUMN "sla_due_date" DATE;

-- Pedido do usuário: nas propostas que já existem, o prazo SLA começa
-- igual à previsão de fechamento.
UPDATE "opportunities" SET "sla_due_date" = "expected_close_date";
