-- OpportunityLostReason (opportunity_lost_reason) — lista de motivos de
-- perda de oportunidade (pedido do usuário, 2026-09-17, depois de uma
-- proposta recusada por demora no envio). A lista existe pra alimentar um
-- Pareto das perdas: motivo digitado livre a cada vez viraria "Preço",
-- "preço alto", "Preco" em três barras diferentes. Ver o comentário do
-- model em prisma/schema.prisma.
--
-- Escrita manual, mesmo motivo das migrations anteriores (`prisma migrate
-- diff` pede --shadow-database-url, não configurado aqui).

CREATE TABLE "opportunity_lost_reason" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "nome"         TEXT NOT NULL,
    "criado_por"   UUID,
    "criado_em"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_lost_reason_pkey" PRIMARY KEY ("id")
);

-- Sem repetir motivo com outra caixa ("Preço" x "preço").
CREATE UNIQUE INDEX "opportunity_lost_reason_workspace_id_nome_key"
  ON "opportunity_lost_reason"("workspace_id", lower("nome"));

-- CASCADE só pro caso dos testes automáticos, que criam e apagam um
-- workspace próprio a cada execução.
ALTER TABLE "opportunity_lost_reason" ADD CONSTRAINT "opportunity_lost_reason_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Motivos iniciais: os da lista fixa que existia na tela, sem o "Outro"
-- (agora quem não acha o motivo cadastra um novo), mais o caso que
-- originou o pedido. Antes de ligar o RLS, pra inserção não depender da
-- sessão de workspace.
INSERT INTO "opportunity_lost_reason" ("workspace_id", "nome")
SELECT w."id", m."nome"
FROM "workspaces" w
CROSS JOIN (VALUES
  ('Preço / concorrente'),
  ('Demora no envio da proposta'),
  ('Sem orçamento no momento'),
  ('Prazo de entrega'),
  ('Optou por terceirizar'),
  ('Sem retorno / esfriou')
) AS m("nome");

-- RLS na mesma migration (regra do projeto). Só SELECT e INSERT: a tela
-- não edita nem apaga motivo — apagar um motivo já usado deixaria o
-- Pareto com barra órfã.
ALTER TABLE "opportunity_lost_reason" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_lost_reason" FORCE ROW LEVEL SECURITY;

CREATE POLICY "workspace_isolation_select" ON "opportunity_lost_reason" FOR SELECT
  USING ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);

CREATE POLICY "workspace_isolation_insert" ON "opportunity_lost_reason" FOR INSERT
  WITH CHECK ("workspace_id" = (NULLIF(current_setting('app.current_workspace_id', true), ''))::uuid);
