-- Fase 3: soft delete em Opportunity, alinhando com Company/Contact
-- (docs/arquitetura-dados.md, seção 5, regra 2). Gap identificado ao
-- planejar a Fase 3 — este campo nunca tinha sido criado na Fase 1.
--
-- Sem impacto em RLS: a policy "workspace_isolation" de "opportunities"
-- filtra só por workspace_id (USING/WITH CHECK inalterados) — coluna nova
-- nullable não precisa de policy nova nem de ajuste na existente.

ALTER TABLE "opportunities" ADD COLUMN "deleted_at" TIMESTAMP(3);
