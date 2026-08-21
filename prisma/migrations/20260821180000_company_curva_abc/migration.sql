-- Curva ABC de clientes (pedido do usuário, 2026-08-21): classifica cada
-- empresa em A/B/C pelo peso dela no faturamento acumulado.
--
-- Por que a classe é GRAVADA e não calculada na hora: o usuário pediu um
-- botão que "calcula e atribui". Classe recalculada a cada abertura de
-- tela mudaria sozinha a cada venda nova — e classe de cliente é coisa que
-- se usa para decidir atendimento e prioridade, então precisa ser estável
-- entre revisões conscientes. `curva_abc_calculada_em` é o que deixa
-- explícito na tela de quando é aquela foto.
--
-- Nulo = empresa sem compra nenhuma no período (não é classe D; é "fora da
-- curva"), e é também o estado de todo mundo antes do primeiro cálculo.
--
-- Escrita manual (mesmo motivo das migrations anteriores: `prisma migrate
-- diff` pede --shadow-database-url, não configurado). Aplicada via
-- `prisma migrate deploy`.

CREATE TYPE "CurvaAbc" AS ENUM ('A', 'B', 'C');

ALTER TABLE "companies"
  ADD COLUMN "curva_abc"             "CurvaAbc",
  ADD COLUMN "curva_abc_calculada_em" TIMESTAMP(3);

-- Sem policy nova: `companies` já tem RLS ("ws_and_role_select" e as de
-- escrita, migration 20260806190000_company_access_contact_owner). Coluna
-- nova em tabela existente herda tudo.
