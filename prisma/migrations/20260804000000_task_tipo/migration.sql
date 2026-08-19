-- Coluna "Tipo" na tela de Tarefas (pedido direto do usuário, fora do
-- SPEC-CRM-GAMA.md original) — mesmos 5 tipos de openTaskForm() no
-- protótipo (gama-crm-mvp.html): ligação, e-mail, visita, proposta,
-- follow-up. Opcional (sem default) porque tarefas já existentes não têm
-- como inferir um tipo real — ficam com "—" na UI até serem editadas,
-- mesmo padrão já usado em Company.tipo (PessoaTipo?).
--
-- Escrita manual (sem shadow database configurado neste projeto).
-- Aplicado via `npm run prisma:migrate:deploy`.

CREATE TYPE "TaskType" AS ENUM ('ligacao', 'email', 'visita', 'proposta', 'followup');

ALTER TABLE "tasks" ADD COLUMN "tipo" "TaskType";
