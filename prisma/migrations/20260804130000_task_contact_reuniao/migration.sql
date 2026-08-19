-- Combobox de contato obrigatório pra tarefas de Ligação/Reunião/Visita
-- (pedido direto do usuário) + novo tipo "Reunião" (o usuário citou esse
-- tipo de novo depois da sessão anterior ter fechado só nos 5 do
-- protótipo — confirmado via pergunta direta que agora é pra virar um
-- 6º valor de verdade, não um lapso).
--
-- ADD VALUE de enum não pode ser usado na mesma transação em que o valor
-- novo é referenciado, mas não é o caso aqui (só adiciona, não usa) —
-- seguro dentro da transação que `prisma migrate deploy` abre por
-- migration. Escrita manual (sem shadow database configurado neste
-- projeto). Aplicado via `npm run prisma:migrate:deploy`.

ALTER TYPE "TaskType" ADD VALUE 'reuniao';

ALTER TABLE "tasks" ADD COLUMN "contact_id" UUID REFERENCES "contacts"("id");
