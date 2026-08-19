-- Tags livres na Prospecção (raw_leads) — pedido direto do usuário, fora
-- do SPEC-CRM-GAMA.md original. Texto livre (sem lista fixa), editável na
-- lista e na ficha do lead; também vira filtro na tela de Prospecção.
--
-- Coluna própria em raw_leads (não reaproveita companies.tags): aquela
-- coluna já carrega o marcador de sistema "lead-triagem" usado pra
-- esconder a company da tela de Empresas até o lead ser aprovado — se uma
-- tag de usuário fosse guardada ali, RawLeadService#approve (que só
-- remove "lead-triagem" de companies.tags) a preservaria de qualquer
-- jeito, mas misturar as duas coisas na mesma coluna exigiria filtrar
-- "lead-triagem" toda vez que a UI listasse/editasse tags de usuário — a
-- coluna própria evita essa armadilha e mantém as duas listas
-- independentes desde o início.
--
-- Escrita manual (mesmo motivo de sempre neste projeto: `prisma migrate
-- diff` exige --shadow-database-url, não configurado aqui). Aplicado via
-- `npm run prisma:migrate:deploy`.

ALTER TABLE "raw_leads" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
